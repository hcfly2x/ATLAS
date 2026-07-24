import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { dashboardPage } from "./page.js";
import type { DashboardService } from "./service.js";

const loopback = new Set(["127.0.0.1", "::1"]);

export function registerDashboardRoutes(
  app: FastifyInstance,
  service: DashboardService,
  token: string,
): void {
  if (token.trim().length === 0) throw new Error("DASHBOARD_TOKEN must not be empty");
  const local = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!loopback.has(request.ip)) {
      await reply.code(403).send({ code: "DASHBOARD_LOOPBACK_ONLY" });
    }
  };
  const authorized = async (request: FastifyRequest, reply: FastifyReply) => {
    await local(request, reply);
    if (reply.sent) return;
    if (request.headers.authorization !== `Bearer ${token}`) {
      await reply.code(401).send({ code: "DASHBOARD_UNAUTHORIZED" });
    }
  };
  const filterSchema = z.object({
    periodDays: z.coerce.number().int().min(1).max(366).default(30),
    projectId: z.string().min(1).optional(),
  });
  const projectSchema = z.object({ projectId: z.string().min(1) });
  const taskSchema = z.object({ taskId: z.string().uuid() });

  app.get("/dashboard", { preHandler: local }, async (_request, reply) =>
    reply
      .header(
        "content-security-policy",
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      )
      .header("cache-control", "no-store")
      .header("x-frame-options", "DENY")
      .type("text/html; charset=utf-8")
      .send(dashboardPage),
  );
  app.get("/dashboard/api/overview", { preHandler: authorized }, async (request) => {
    const query = filterSchema.parse(request.query);
    return service.overview(query.projectId, query.periodDays);
  });
  app.get("/dashboard/api/tasks", { preHandler: authorized }, async (request) => {
    const query = filterSchema.pick({ projectId: true }).parse(request.query);
    return service.tasks(query.projectId);
  });
  app.get("/dashboard/api/tasks/:taskId", { preHandler: authorized }, async (request, reply) => {
    const result = await service.task(taskSchema.parse(request.params).taskId);
    return result === null ? reply.code(404).send({ code: "TASK_NOT_FOUND" }) : result;
  });
  app.get("/dashboard/api/audit", { preHandler: authorized }, async (request) =>
    service.audit(projectSchema.parse(request.query).projectId),
  );
  app.get("/dashboard/api/memory", { preHandler: authorized }, async (request) =>
    service.memory(projectSchema.parse(request.query).projectId),
  );
}
