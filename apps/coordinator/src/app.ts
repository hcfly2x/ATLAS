import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import {
  InvalidTaskTransitionError,
  TaskFailureStageRequiredError,
  TaskNotFoundError,
  TaskStateMachine,
  TaskVersionConflictError,
  type TaskCoreStore,
} from "@atlas/core";
import { taskTransitionCommandSchema } from "@atlas/shared";

const createTaskSchema = z.object({
  idempotencyKey: z.string().min(1).max(255),
  origin: z.string().min(1).max(64),
  originalMessage: z.string().min(1),
  projectId: z.string().min(1).max(128),
});

const taskParamsSchema = z.object({
  taskId: z.string().uuid(),
});

const transitionBodySchema = taskTransitionCommandSchema.omit({ correlationId: true });

export interface CoordinatorAppOptions {
  readonly logger?: boolean;
  readonly taskStore?: TaskCoreStore;
}

function headerCorrelationId(header: string | string[] | undefined): string | undefined {
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  return undefined;
}

export function createCoordinatorApp(options: CoordinatorAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
    genReqId: (request) => headerCorrelationId(request.headers["x-correlation-id"]) ?? randomUUID(),
  });

  app.addHook("onRequest", (request, _reply, done) => {
    request.log.info({ correlationId: request.id }, "request received");
    done();
  });

  app.get("/health", (request) => ({
    correlationId: request.id,
    service: "coordinator",
    status: "ok",
  }));

  if (options.taskStore !== undefined) {
    const taskStore = options.taskStore;
    const stateMachine = new TaskStateMachine(taskStore);

    app.post("/internal/tasks", async (request, reply) => {
      const input = createTaskSchema.parse(request.body);
      const result = await taskStore.createTask({
        ...input,
        correlationId: request.id,
      });
      return reply.code(result.idempotentReplay ? 200 : 201).send(result);
    });

    app.post("/internal/tasks/:taskId/transitions", async (request) => {
      const { taskId } = taskParamsSchema.parse(request.params);
      const input = transitionBodySchema.parse(request.body);
      const { failureStage, ...requiredInput } = input;
      return stateMachine.transition({
        ...requiredInput,
        correlationId: request.id,
        taskId,
        ...(failureStage === undefined ? {} : { failureStage }),
      });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        correlationId: request.id,
        issues: error.issues,
      });
    }
    if (error instanceof TaskNotFoundError) {
      return reply.code(404).send({
        code: "TASK_NOT_FOUND",
        correlationId: request.id,
      });
    }
    if (error instanceof TaskVersionConflictError) {
      request.log.warn({ correlationId: request.id }, "task version conflict");
      return reply.code(409).send({
        actualVersion: error.actualVersion,
        code: "TASK_VERSION_CONFLICT",
        correlationId: request.id,
        expectedVersion: error.expectedVersion,
      });
    }
    if (error instanceof InvalidTaskTransitionError) {
      request.log.warn({ correlationId: request.id }, "invalid task transition");
      return reply.code(422).send({
        code: "INVALID_TASK_TRANSITION",
        correlationId: request.id,
        fromState: error.fromState,
        toState: error.toState,
      });
    }
    if (error instanceof TaskFailureStageRequiredError) {
      request.log.warn({ correlationId: request.id }, "failure stage required");
      return reply.code(422).send({
        code: "FAILURE_STAGE_REQUIRED",
        correlationId: request.id,
      });
    }

    request.log.error({ correlationId: request.id, error }, "unhandled request error");
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      correlationId: request.id,
    });
  });

  return app;
}
