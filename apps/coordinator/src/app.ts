import Fastify, { type FastifyInstance } from "fastify";

import { createStructuredLog } from "@atlas/shared";

export function createCoordinatorApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", (request) => {
    const correlationHeader = request.headers["x-correlation-id"];
    const correlationId =
      typeof correlationHeader === "string" && correlationHeader.length > 0
        ? correlationHeader
        : request.id;

    return {
      service: "coordinator",
      status: "ok",
      log: createStructuredLog({ correlationId, service: "coordinator" }, "info", "health check"),
    };
  });

  return app;
}
