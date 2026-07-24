import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  ProjectConfigConflictError,
  ProjectConfigValidationError,
  type ProjectConfigStore,
} from "./project-config.js";
import { registerSetupRoutes } from "./routes.js";

export function createSetupApp(
  store: ProjectConfigStore,
  options: { readonly logger?: boolean } = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  registerSetupRoutes(app, store);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "INVALID_PROJECT_CONFIG",
        correlationId: request.id,
        issues: error.issues,
        message: "Configuração de projeto inválida.",
      });
    }
    if (error instanceof ProjectConfigValidationError) {
      return reply.code(422).send({
        code: "PROJECT_NOT_READY_FOR_ACTIVATION",
        correlationId: request.id,
        issues: error.issues,
        message: error.message,
      });
    }
    if (error instanceof ProjectConfigConflictError) {
      return reply.code(409).send({
        code: "PROJECT_CONFIG_CONFLICT",
        correlationId: request.id,
        message: error.message,
      });
    }

    request.log.error({ correlationId: request.id, error }, "setup request failed");
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      correlationId: request.id,
      message: "Erro interno do configurador.",
    });
  });

  return app;
}
