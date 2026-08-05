import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import {
  approvalDecisionRequestSchema,
  cancelDashboardTaskRequestSchema,
  createDashboardDemandRequestSchema,
  pauseDashboardTaskRequestSchema,
  resumeDashboardTaskRequestSchema,
  setDashboardTaskPriorityRequestSchema,
} from "@atlas/contracts";

import {
  ApprovalDecisionIdempotencyConflictError,
  ApprovalDecisionNotFoundError,
  ApprovalDecisionNotHumanError,
  ApprovalDecisionNotPendingError,
  ApprovalDecisionVersionConflictError,
  ApprovalTargetHashMismatchError,
  PostExecutionReviewPendingError,
  SensitiveApprovalDashboardDeniedError,
} from "../approvals/service.js";
import type { DashboardAuthenticator, DashboardPermission } from "./auth.js";
import type { DashboardApprovalService } from "./approval-service.js";
import { dashboardLoginPage } from "./page.js";
import { ProjectConfigValidationError } from "../setup/project-config.js";
import {
  DashboardProjectConfigError,
  type DashboardProjectConfigService,
} from "./project-config-service.js";
import type { DashboardService } from "./service.js";
import {
  DashboardTaskCommandError,
  type DashboardTaskCommandService,
} from "./task-command-service.js";

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
  readonly dashboardDistPath?: string | undefined;
  readonly remoteAccessEnabled?: boolean | undefined;
  readonly projectConfigService?: DashboardProjectConfigService | undefined;
  readonly taskCommandService?: DashboardTaskCommandService | undefined;
}

async function projectConfigReply(
  reply: FastifyReply,
  operation: Promise<unknown>,
  acceptedStatus = 200,
): Promise<unknown> {
  try {
    const result = await operation;
    return await reply.code(acceptedStatus).send(result);
  } catch (error: unknown) {
    if (!(error instanceof DashboardProjectConfigError)) throw error;
    const status =
      error.code === "DASHBOARD_PROJECT_CONFIG_NOT_FOUND"
        ? 404
        : error.code === "DASHBOARD_PROJECT_CONFIG_INVALID"
          ? 422
          : 409;
    return reply.code(status).send({ code: error.code });
  }
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

function securityHeaders(reply: FastifyReply, page: "login" | "spa"): FastifyReply {
  return reply
    .header(
      "content-security-policy",
      page === "login"
        ? "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
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
  approvalService: DashboardApprovalService | undefined,
  options: DashboardRouteOptions = {},
): void {
  const remoteAccessEnabled = options.remoteAccessEnabled ?? false;
  const dashboardDistPath =
    options.dashboardDistPath ??
    [
      resolve(process.cwd(), "../dashboard/dist"),
      resolve(process.cwd(), "apps/dashboard/dist"),
    ].find((candidate) => existsSync(join(candidate, "index.html"))) ??
    resolve(process.cwd(), "../dashboard/dist");
  const dashboardShell = readFileSync(join(dashboardDistPath, "index.html"), "utf8");
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
  const projectConfigParamsSchema = z.object({
    projectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  });
  const taskSchema = z.object({ taskId: z.string().uuid() });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/dashboard")) return;
    if (!remoteAccessEnabled && !loopback.has(request.ip)) {
      await reply.code(403).send({ code: "DASHBOARD_LOOPBACK_ONLY" });
      return;
    }
    const config = request.routeOptions.config as DashboardRouteConfig;
    if (config.dashboardPublic === true) return;
    const requiredPermission = request.url.startsWith("/dashboard/assets/")
      ? "dashboard:shell:read"
      : config.dashboardPermission;
    let result;
    try {
      result = auth.authorize(request.headers.cookie, requiredPermission);
    } catch {
      await reply.code(401).send({ code: "DASHBOARD_UNAUTHORIZED" });
      return;
    }
    if (result.status === "allowed") {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        !auth.verifyCsrf(
          request.headers.cookie,
          typeof request.headers["x-atlas-csrf-token"] === "string"
            ? request.headers["x-atlas-csrf-token"]
            : undefined,
        )
      ) {
        await reply.code(403).send({ code: "DASHBOARD_CSRF_INVALID" });
      }
      return;
    }
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
      securityHeaders(reply, "login").type("text/html; charset=utf-8").send(dashboardLoginPage),
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
  app.post(
    "/dashboard/api/demands",
    {
      config: {
        dashboardPermission: "dashboard:demand:create",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.taskCommandService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_TASK_COMMANDS_UNAVAILABLE" });
      }
      const input = createDashboardDemandRequestSchema.parse(request.body);
      try {
        const result = await options.taskCommandService.createDemand(input, request.id);
        return await reply.code(result.idempotentReplay ? 200 : 201).send(result);
      } catch (error: unknown) {
        if (error instanceof DashboardTaskCommandError) {
          return reply
            .code(error.code === "DASHBOARD_PROJECT_NOT_ELIGIBLE" ? 404 : 409)
            .send({ code: error.code });
        }
        throw error;
      }
    },
  );
  app.post(
    "/dashboard/api/tasks/:taskId/cancel",
    {
      config: {
        dashboardPermission: "dashboard:task:cancel",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.taskCommandService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_TASK_COMMANDS_UNAVAILABLE" });
      }
      const taskId = taskSchema.parse(request.params).taskId;
      const input = cancelDashboardTaskRequestSchema.parse(request.body);
      try {
        return await options.taskCommandService.cancelTask(taskId, input, request.id);
      } catch (error: unknown) {
        if (error instanceof DashboardTaskCommandError) {
          return reply.code(error.code === "TASK_NOT_FOUND" ? 404 : 409).send({ code: error.code });
        }
        throw error;
      }
    },
  );
  app.post(
    "/dashboard/api/tasks/:taskId/pause",
    {
      config: {
        dashboardPermission: "dashboard:task:pause",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.taskCommandService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_TASK_COMMANDS_UNAVAILABLE" });
      }
      const taskId = taskSchema.parse(request.params).taskId;
      const input = pauseDashboardTaskRequestSchema.parse(request.body);
      try {
        return await options.taskCommandService.pauseTask(taskId, input, request.id);
      } catch (error: unknown) {
        if (error instanceof DashboardTaskCommandError) {
          return reply.code(error.code === "TASK_NOT_FOUND" ? 404 : 409).send({ code: error.code });
        }
        throw error;
      }
    },
  );
  app.post(
    "/dashboard/api/tasks/:taskId/resume",
    {
      config: {
        dashboardPermission: "dashboard:task:resume",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.taskCommandService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_TASK_COMMANDS_UNAVAILABLE" });
      }
      const taskId = taskSchema.parse(request.params).taskId;
      const input = resumeDashboardTaskRequestSchema.parse(request.body);
      try {
        return await options.taskCommandService.resumeTask(taskId, input, request.id);
      } catch (error: unknown) {
        if (error instanceof DashboardTaskCommandError) {
          return reply.code(error.code === "TASK_NOT_FOUND" ? 404 : 409).send({ code: error.code });
        }
        throw error;
      }
    },
  );
  app.post(
    "/dashboard/api/tasks/:taskId/priority",
    {
      config: {
        dashboardPermission: "dashboard:task:priority",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.taskCommandService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_TASK_COMMANDS_UNAVAILABLE" });
      }
      const taskId = taskSchema.parse(request.params).taskId;
      const input = setDashboardTaskPriorityRequestSchema.parse(request.body);
      try {
        return await options.taskCommandService.setTaskPriority(taskId, input, request.id);
      } catch (error: unknown) {
        if (error instanceof DashboardTaskCommandError) {
          return reply.code(error.code === "TASK_NOT_FOUND" ? 404 : 409).send({ code: error.code });
        }
        throw error;
      }
    },
  );

  app.get(
    "/dashboard/api/projects",
    {
      config: {
        dashboardPermission: "dashboard:projects:read",
      } satisfies DashboardRouteConfig,
    },
    async () => service.projects(),
  );
  app.get(
    "/dashboard/api/projects-board",
    {
      config: {
        dashboardPermission: "dashboard:projects:read",
      } satisfies DashboardRouteConfig,
    },
    async () => service.projectsBoard(),
  );
  app.get(
    "/dashboard/api/project-configs",
    {
      config: {
        dashboardPermission: "dashboard:project-config:read",
      } satisfies DashboardRouteConfig,
    },
    async (_request, reply) => {
      if (options.projectConfigService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_PROJECT_CONFIG_UNAVAILABLE" });
      }
      return options.projectConfigService.list();
    },
  );
  app.post(
    "/dashboard/api/project-configs/detect",
    {
      config: {
        dashboardPermission: "dashboard:project-config:write",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.projectConfigService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_PROJECT_CONFIG_UNAVAILABLE" });
      }
      try {
        return await options.projectConfigService.detect(request.body);
      } catch (error: unknown) {
        if (error instanceof ProjectConfigValidationError) {
          return reply.code(422).send({ code: "DASHBOARD_PROJECT_CONFIG_INVALID" });
        }
        throw error;
      }
    },
  );
  app.post(
    "/dashboard/api/project-configs",
    {
      config: {
        dashboardPermission: "dashboard:project-config:write",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.projectConfigService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_PROJECT_CONFIG_UNAVAILABLE" });
      }
      return projectConfigReply(
        reply,
        options.projectConfigService.create(request.body, request.id),
        201,
      );
    },
  );
  app.put(
    "/dashboard/api/project-configs/:projectId",
    {
      config: {
        dashboardPermission: "dashboard:project-config:write",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (options.projectConfigService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_PROJECT_CONFIG_UNAVAILABLE" });
      }
      const { projectId } = projectConfigParamsSchema.parse(request.params);
      return projectConfigReply(
        reply,
        options.projectConfigService.update(projectId, request.body, request.id),
      );
    },
  );
  for (const action of ["activate", "deactivate"] as const) {
    app.post(
      `/dashboard/api/project-configs/:projectId/${action}`,
      {
        config: {
          dashboardPermission: "dashboard:project-config:write",
        } satisfies DashboardRouteConfig,
      },
      async (request, reply) => {
        if (options.projectConfigService === undefined) {
          return reply.code(503).send({ code: "DASHBOARD_PROJECT_CONFIG_UNAVAILABLE" });
        }
        const { projectId } = projectConfigParamsSchema.parse(request.params);
        return projectConfigReply(
          reply,
          options.projectConfigService[action](projectId, request.body, request.id),
        );
      },
    );
  }
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
        csrfToken: auth.csrfToken(request.headers.cookie),
        expiresAt: new Date(authentication.principal.expiresAt).toISOString(),
        role: authentication.principal.role,
      };
    },
  );
  app.post(
    "/dashboard/api/approvals/:approvalId/decision",
    {
      config: {
        dashboardPermission: "dashboard:approval:decide",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      if (approvalService === undefined) {
        return reply.code(503).send({ code: "DASHBOARD_APPROVALS_UNAVAILABLE" });
      }
      const approvalId = z
        .string()
        .uuid()
        .parse((request.params as { approvalId?: unknown }).approvalId);
      const input = approvalDecisionRequestSchema.parse(request.body);
      try {
        return await approvalService.decide(approvalId, input, request.id);
      } catch (error: unknown) {
        if (error instanceof ApprovalDecisionNotFoundError) {
          return reply.code(404).send({ code: error.code });
        }
        if (
          error instanceof ApprovalDecisionVersionConflictError ||
          error instanceof ApprovalDecisionNotPendingError ||
          error instanceof ApprovalDecisionIdempotencyConflictError ||
          error instanceof ApprovalTargetHashMismatchError
        ) {
          return reply.code(409).send({ code: error.code });
        }
        if (
          error instanceof ApprovalDecisionNotHumanError ||
          error instanceof SensitiveApprovalDashboardDeniedError
        ) {
          return reply.code(403).send({ code: error.code });
        }
        if (error instanceof PostExecutionReviewPendingError) {
          return reply.code(422).send({ code: error.code });
        }
        throw error;
      }
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
      securityHeaders(reply, "spa").type("text/html; charset=utf-8").send(dashboardShell),
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

  void app.register(fastifyStatic, {
    cacheControl: true,
    decorateReply: false,
    immutable: true,
    maxAge: "1y",
    prefix: "/dashboard/assets/",
    root: join(dashboardDistPath, "assets"),
    setHeaders(reply) {
      void reply.header("cache-control", "public, max-age=31536000, immutable");
      void reply.header("referrer-policy", "no-referrer");
      void reply.header("x-content-type-options", "nosniff");
      void reply.header("x-frame-options", "DENY");
    },
  });

  app.get(
    "/dashboard/*",
    {
      config: {
        dashboardPermission: "dashboard:shell:read",
      } satisfies DashboardRouteConfig,
    },
    async (request, reply) => {
      const clientPath = (request.params as { "*": string })["*"];
      if (clientPath.startsWith("api/") || clientPath.startsWith("assets/")) {
        return reply.code(404).send({ code: "DASHBOARD_NOT_FOUND" });
      }
      return securityHeaders(reply, "spa").type("text/html; charset=utf-8").send(dashboardShell);
    },
  );
}
