import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DashboardAuthenticator, DashboardPermission } from "./auth.js";
import { dashboardLoginPage, dashboardPage } from "./page.js";
import type { DashboardService } from "./service.js";

const loopback = new Set(["127.0.0.1", "::1"]);

interface DashboardRouteConfig {
  readonly dashboardPermission?: DashboardPermission | undefined;
  readonly dashboardPublic?: boolean | undefined;
}

export interface DashboardAuthAuditEvent {
  readonly action:
    | "dashboard.auth.login_failed"
    | "dashboard.auth.login_succeeded"
    | "dashboard.auth.session_expired";
  readonly correlationId: string;
  readonly outcome: "allowed" | "denied";
  readonly reason: "expired" | "invalid_credential" | "session_issued";
}

export interface DashboardRouteOptions {
  readonly authAudit?: ((event: DashboardAuthAuditEvent) => void) | undefined;
  readonly remoteAccessEnabled?: boolean | undefined;
}

export function assertRemoteDashboardConfiguration(
  remoteAccessEnabled: boolean,
  credential: string | undefined,
): void {
  if (remoteAccessEnabled && (credential === undefined || credential.trim().length < 32)) {
    throw new Error(
      "DASHBOARD_OWNER_CREDENTIAL must contain at least 32 characters for remote access",
    );
  }
}

function securityHeaders(reply: FastifyReply): FastifyReply {
  return reply
    .header(
      "content-security-policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    )
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer")
    .header("x-content-type-options", "nosniff")
    .header("x-frame-options", "DENY");
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  service: DashboardService,
  auth: DashboardAuthenticator,
  options: DashboardRouteOptions = {},
): void {
  const remoteAccessEnabled = options.remoteAccessEnabled ?? false;
  const audit = (request: FastifyRequest, event: DashboardAuthAuditEvent): void => {
    try {
      if (options.authAudit === undefined) {
        request.log.info(event, "dashboard authentication event");
        return;
      }
      options.authAudit(event);
    } catch {
      request.log.error(
        { action: event.action, correlationId: request.id },
        "dashboard authentication audit sink failed",
      );
    }
  };
  const filterSchema = z.object({
    periodDays: z.coerce.number().int().min(1).max(366).default(30),
    projectId: z.string().min(1).optional(),
  });
  const loginSchema = z.object({ credential: z.string().min(1).max(1024) }).strict();
  const projectSchema = z.object({ projectId: z.string().min(1) });
  const taskSchema = z.object({ taskId: z.string().uuid() });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/dashboard")) return;
    if (!remoteAccessEnabled && !loopback.has(request.ip)) {
      await reply.code(403).send({ code: "DASHBOARD_LOOPBACK_ONLY" });
      return;
    }
    const config = request.routeOptions.config as DashboardRouteConfig;
    if (config.dashboardPublic === true) return;
    let result;
    try {
      result = auth.authorize(request.headers.cookie, config.dashboardPermission);
    } catch {
      await reply.code(401).send({ code: "DASHBOARD_UNAUTHORIZED" });
      return;
    }
    if (result.status === "allowed") return;
    if (result.status === "expired") {
      audit(request, {
        action: "dashboard.auth.session_expired",
        correlationId: request.id,
        outcome: "denied",
        reason: "expired",
      });
      await reply.code(401).send({ code: "DASHBOARD_SESSION_EXPIRED" });
      return;
    }
    if (result.status === "forbidden") {
      await reply.code(403).send({ code: "DASHBOARD_FORBIDDEN" });
      return;
    }
    await reply.code(401).send({ code: "DASHBOARD_UNAUTHORIZED" });
  });

  app.get(
    "/dashboard/login",
    { config: { dashboardPublic: true } satisfies DashboardRouteConfig },
    async (_request, reply) =>
      securityHeaders(reply).type("text/html; charset=utf-8").send(dashboardLoginPage),
  );

  app.post(
    "/dashboard/auth/session",
    { config: { dashboardPublic: true } satisfies DashboardRouteConfig },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success || !auth.authenticateCredential(parsed.data.credential)) {
        audit(request, {
          action: "dashboard.auth.login_failed",
          correlationId: request.id,
          outcome: "denied",
          reason: "invalid_credential",
        });
        return reply
          .header("cache-control", "no-store")
          .code(401)
          .send({ code: "DASHBOARD_UNAUTHORIZED" });
      }
      let session;
      try {
        session = auth.issueSession();
      } catch {
        return reply
          .header("cache-control", "no-store")
          .code(401)
          .send({ code: "DASHBOARD_UNAUTHORIZED" });
      }
      audit(request, {
        action: "dashboard.auth.login_succeeded",
        correlationId: request.id,
        outcome: "allowed",
        reason: "session_issued",
      });
      return reply
        .header("cache-control", "no-store")
        .header("set-cookie", auth.sessionCookie(session, remoteAccessEnabled))
        .code(204)
        .send();
    },
  );

  app.get(
    "/dashboard/auth/session",
    {
      config: {
        dashboardPermission: "dashboard:session:read",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      const authentication = auth.authenticate(request.headers.cookie);
      if (authentication.status !== "authenticated") {
        return reply.code(401).send({ code: "DASHBOARD_UNAUTHORIZED" });
      }
      return {
        expiresAt: new Date(authentication.principal.expiresAt).toISOString(),
        role: authentication.principal.role,
      };
    },
  );

  app.get(
    "/dashboard",
    {
      config: {
        dashboardPermission: "dashboard:shell:read",
      } satisfies DashboardRouteConfig,
    },
    async (_request, reply) =>
      securityHeaders(reply).type("text/html; charset=utf-8").send(dashboardPage),
  );
  app.get(
    "/dashboard/api/overview",
    {
      config: {
        dashboardPermission: "dashboard:overview:read",
      } satisfies DashboardRouteConfig,
    },
    async (request) => {
      const query = filterSchema.parse(request.query);
      return service.overview(query.projectId, query.periodDays);
    },
  );
  app.get(
    "/dashboard/api/mission-control",
    {
      config: {
        dashboardPermission: "dashboard:mission-control:read",
      } satisfies DashboardRouteConfig,
    },
    async (request) => {
      const query = filterSchema.pick({ projectId: true }).parse(request.query);
      return service.missionControl(query.projectId);
    },
  );
  app.get(
    "/dashboard/api/tasks",
    {
      config: {
        dashboardPermission: "dashboard:tasks:read",
      } satisfies DashboardRouteConfig,
    },
    async (request) => {
      const query = filterSchema.pick({ projectId: true }).parse(request.query);
      return service.tasks(query.projectId);
    },
  );
  app.get(
    "/dashboard/api/deliveries",
    {
      config: {
        dashboardPermission: "dashboard:deliveries:read",
      } satisfies DashboardRouteConfig,
    },
    async (request) => {
      const query = filterSchema.pick({ projectId: true }).parse(request.query);
      return service.deliveries(query.projectId);
    },
  );
  app.get(
    "/dashboard/api/demand/:taskId",
    {
      config: {
        dashboardPermission: "dashboard:demand:read",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      const result = await service.demandWorkspace(taskSchema.parse(request.params).taskId);
      return result ?? reply.code(404).send({ code: "DEMAND_NOT_FOUND" });
    },
  );
  app.get(
    "/dashboard/api/tasks/:taskId",
    {
      config: {
        dashboardPermission: "dashboard:tasks:read",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      const result = await service.task(taskSchema.parse(request.params).taskId);
      return result === null ? reply.code(404).send({ code: "TASK_NOT_FOUND" }) : result;
    },
  );
  app.get(
    "/dashboard/api/audit",
    {
      config: {
        dashboardPermission: "dashboard:audit:read",
      } satisfies DashboardRouteConfig,
    },
    async (request) => service.audit(projectSchema.parse(request.query).projectId),
  );
  app.get(
    "/dashboard/api/memory",
    {
      config: {
        dashboardPermission: "dashboard:memory:read",
      } satisfies DashboardRouteConfig,
    },
    async (request) => service.memory(projectSchema.parse(request.query).projectId),
  );
}
