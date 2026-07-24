import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { editableProjectSchema, type ProjectConfigStore } from "./project-config.js";
import { setupPage } from "./page.js";

function loopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function requireLocal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!loopback(request.ip)) {
    await reply.code(403).send({
      code: "SETUP_LOCAL_ONLY",
      correlationId: request.id,
      message: "O configurador só pode ser acessado localmente.",
    });
  }
}

async function requireSetupWrite(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireLocal(request, reply);
  if (reply.sent) return;
  if (request.headers["x-atlas-setup"] !== "1") {
    await reply.code(403).send({
      code: "SETUP_WRITE_HEADER_REQUIRED",
      correlationId: request.id,
      message: "Cabeçalho de confirmação do configurador ausente.",
    });
  }
}

export function registerSetupRoutes(app: FastifyInstance, store: ProjectConfigStore): void {
  app.get("/setup", { preHandler: requireLocal }, async (_request, reply) => {
    return reply
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
      .header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff")
      .header("x-frame-options", "DENY")
      .type("text/html; charset=utf-8")
      .send(setupPage);
  });

  app.get("/setup/api/projects", { preHandler: requireLocal }, () => store.list());

  app.post("/setup/api/projects/validate", { preHandler: requireSetupWrite }, (request) =>
    store.validate(editableProjectSchema.parse(request.body)),
  );

  app.put("/setup/api/projects", { preHandler: requireSetupWrite }, (request) =>
    store.save(editableProjectSchema.parse(request.body)),
  );
}
