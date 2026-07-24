import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
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

import { dispatchTelegram, type TelegramClient } from "./telegram/client.js";
import { TelegramUnauthorizedError, type TelegramGateway } from "./telegram/service.js";

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
  readonly internalAuthToken?: string;
  readonly logger?: boolean;
  readonly taskStore?: TaskCoreStore;
  readonly telegramClient?: TelegramClient;
  readonly telegramGateway?: TelegramGateway;
  readonly telegramWebhookSecret?: string;
}

function headerCorrelationId(header: string | string[] | undefined): string | undefined {
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  return undefined;
}

export function createCoordinatorApp(options: CoordinatorAppOptions = {}): FastifyInstance {
  const telegramWebhookEnabled =
    options.telegramGateway !== undefined && options.telegramClient !== undefined;
  if (
    telegramWebhookEnabled &&
    (options.telegramWebhookSecret === undefined ||
      options.telegramWebhookSecret.trim().length === 0)
  ) {
    throw new Error("telegramWebhookSecret is required when the Telegram webhook is enabled");
  }

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
    if (options.internalAuthToken === undefined || options.internalAuthToken.length === 0) {
      throw new Error("internalAuthToken is required when internal routes are enabled");
    }
    const taskStore = options.taskStore;
    const internalAuthToken = options.internalAuthToken;
    const stateMachine = new TaskStateMachine(taskStore);

    const requireInternalAuth = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      if (request.headers.authorization !== `Bearer ${internalAuthToken}`) {
        await reply.code(401).send({
          code: "UNAUTHORIZED",
          correlationId: request.id,
        });
      }
    };

    app.post("/internal/tasks", { preHandler: requireInternalAuth }, async (request, reply) => {
      const input = createTaskSchema.parse(request.body);
      const result = await taskStore.createTask({
        ...input,
        correlationId: request.id,
      });
      return reply.code(result.idempotentReplay ? 200 : 201).send(result);
    });

    app.post(
      "/internal/tasks/:taskId/transitions",
      { preHandler: requireInternalAuth },
      async (request) => {
        const { taskId } = taskParamsSchema.parse(request.params);
        const input = transitionBodySchema.parse(request.body);
        const { failureStage, ...requiredInput } = input;
        return stateMachine.transition({
          ...requiredInput,
          correlationId: request.id,
          taskId,
          ...(failureStage === undefined ? {} : { failureStage }),
        });
      },
    );
  }

  if (options.telegramGateway !== undefined && options.telegramClient !== undefined) {
    const telegramGateway = options.telegramGateway;
    const telegramClient = options.telegramClient;
    const telegramWebhookSecret = options.telegramWebhookSecret;
    app.post("/telegram/webhook", async (request, reply) => {
      if (request.headers["x-telegram-bot-api-secret-token"] !== telegramWebhookSecret) {
        return reply.code(401).send({
          code: "INVALID_WEBHOOK_SECRET",
          correlationId: request.id,
        });
      }
      const dispatch = await telegramGateway.handle(request.body, request.id);
      await dispatchTelegram(telegramClient, dispatch);
      return {
        correlationId: request.id,
        ok: true,
        replayed: dispatch.replayed,
      };
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
    if (error instanceof TelegramUnauthorizedError) {
      request.log.warn({ correlationId: request.id }, "unauthorized telegram user");
      return reply.code(403).send({
        code: "TELEGRAM_USER_FORBIDDEN",
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
