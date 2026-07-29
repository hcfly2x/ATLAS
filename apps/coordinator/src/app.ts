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
import {
  createMemoryItemSchema,
  memoryTypeSchema,
  taskTransitionCommandSchema,
  workerCapabilitiesSchema,
  workerResultSchema,
} from "@atlas/shared";

import { dispatchTelegram, type TelegramClient } from "./telegram/client.js";
import { TelegramUnauthorizedError, type TelegramGateway } from "./telegram/service.js";
import {
  ApprovalTargetHashMismatchError,
  PostExecutionReviewPendingError,
} from "./telegram/store.js";
import {
  LlmMonthlyBudgetExceededError,
  TaskNotReadyForSupervisionError,
  type SupervisorService,
} from "./supervisor/service.js";
import {
  CodexMonthlyBudgetExceededError,
  WorkerAuthenticationError,
  WorkerConflictError,
  WorkerLeaseError,
  type WorkerService,
} from "./worker/service.js";
import {
  ProjectConfigConflictError,
  ProjectConfigValidationError,
  type ProjectConfigStore,
} from "./setup/project-config.js";
import { registerSetupRoutes } from "./setup/routes.js";
import {
  MemoryConflictError,
  MemoryProjectNotFoundError,
  MemoryTaskScopeError,
  type MemoryService,
} from "./memory/service.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import type { DashboardAuthenticator } from "./dashboard/auth.js";
import type { DashboardAuthAuditEvent } from "./dashboard/routes.js";
import type { DashboardService } from "./dashboard/service.js";
import type { PostExecutionQaService } from "./post-execution/service.js";

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
const workerParamsSchema = z.object({ workerId: z.string().uuid() });
const workerRegistrationSchema = z.object({
  capabilities: workerCapabilitiesSchema,
  concurrencyLimit: z.number().int().positive(),
  name: z.string().min(1),
  projectScopes: z.array(z.string().min(1)),
});
const claimSchema = z.object({ idempotencyKey: z.string().min(1) });
const leaseSchema = z.object({
  executionId: z.string().uuid(),
  fencingToken: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().min(1),
  leaseId: z.string().uuid(),
});

export interface CoordinatorAppOptions {
  readonly dashboardAuth?: DashboardAuthenticator;
  readonly dashboardAuthAudit?: ((event: DashboardAuthAuditEvent) => void) | undefined;
  readonly dashboardRemoteAccessEnabled?: boolean;
  readonly dashboardService?: DashboardService;
  readonly internalAuthToken?: string;
  readonly logger?: boolean;
  readonly memoryService?: MemoryService;
  readonly postExecutionQaService?: Pick<PostExecutionQaService, "reviewExecution">;
  readonly projectConfigStore?: ProjectConfigStore;
  readonly supervisorService?: Pick<SupervisorService, "processTask">;
  readonly taskStore?: TaskCoreStore;
  readonly telegramClient?: TelegramClient;
  readonly telegramGateway?: TelegramGateway;
  readonly telegramWebhookSecret?: string;
  readonly workerBootstrapToken?: string;
  readonly workerService?: WorkerService;
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

  if (options.dashboardService !== undefined) {
    if (options.dashboardAuth === undefined) {
      throw new Error("dashboardAuth is required when dashboard routes are enabled");
    }
    registerDashboardRoutes(app, options.dashboardService, options.dashboardAuth, {
      authAudit: options.dashboardAuthAudit,
      remoteAccessEnabled: options.dashboardRemoteAccessEnabled,
    });
  }

  if (options.projectConfigStore !== undefined) {
    registerSetupRoutes(app, options.projectConfigStore);
  }

  const internalRoutesEnabled =
    options.taskStore !== undefined || options.memoryService !== undefined;
  if (
    internalRoutesEnabled &&
    (options.internalAuthToken === undefined || options.internalAuthToken.length === 0)
  ) {
    throw new Error("internalAuthToken is required when internal routes are enabled");
  }
  const requireInternalAuth = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (request.headers.authorization !== `Bearer ${options.internalAuthToken ?? ""}`) {
      await reply.code(401).send({
        code: "UNAUTHORIZED",
        correlationId: request.id,
      });
    }
  };

  if (options.taskStore !== undefined) {
    const taskStore = options.taskStore;
    const stateMachine = new TaskStateMachine(taskStore);

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

    if (options.supervisorService !== undefined) {
      const supervisorService = options.supervisorService;
      app.post(
        "/internal/tasks/:taskId/supervise",
        { preHandler: requireInternalAuth },
        async (request) => {
          const { taskId } = taskParamsSchema.parse(request.params);
          return supervisorService.processTask(taskId, request.id);
        },
      );
    }
    if (options.workerService !== undefined) {
      const workerService = options.workerService;
      app.post(
        "/internal/executions/:executionId/reconcile",
        { preHandler: requireInternalAuth },
        async (request) => {
          const params = z.object({ executionId: z.string().uuid() }).parse(request.params);
          const body = z
            .object({
              confirmedStopped: z.literal(true),
              idempotencyKey: z.string().min(1),
            })
            .parse(request.body);
          return workerService.reconcileTechnicalFailure({
            ...body,
            executionId: params.executionId,
          });
        },
      );
    }
  }

  if (options.memoryService !== undefined) {
    const memoryService = options.memoryService;
    const projectParamsSchema = z.object({ projectId: z.string().min(1).max(128) });
    const memoryQuerySchema = z.object({
      before: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      taskId: z.string().uuid().optional(),
      type: memoryTypeSchema.optional(),
    });
    app.get(
      "/internal/projects/:projectId/memory",
      { preHandler: requireInternalAuth },
      async (request) => {
        const { projectId } = projectParamsSchema.parse(request.params);
        const query = memoryQuerySchema.parse(request.query);
        return memoryService.list({
          limit: query.limit,
          projectId,
          ...(query.before === undefined ? {} : { before: query.before }),
          ...(query.taskId === undefined ? {} : { taskId: query.taskId }),
          ...(query.type === undefined ? {} : { type: query.type }),
        });
      },
    );
    app.get(
      "/internal/projects/:projectId/memory/context",
      { preHandler: requireInternalAuth },
      async (request) => {
        const { projectId } = projectParamsSchema.parse(request.params);
        const query = z.object({ taskId: z.string().uuid().optional() }).parse(request.query);
        return memoryService.getContext(projectId, query.taskId);
      },
    );
    app.post(
      "/internal/projects/:projectId/memory",
      { preHandler: requireInternalAuth },
      async (request, reply) => {
        const { projectId } = projectParamsSchema.parse(request.params);
        const result = await memoryService.create(
          projectId,
          createMemoryItemSchema.parse(request.body),
          request.id,
        );
        return reply.code(result.replayed ? 200 : 201).send(result);
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

  if (options.workerService !== undefined) {
    if (
      options.workerBootstrapToken === undefined ||
      options.workerBootstrapToken.trim().length === 0
    ) {
      throw new Error("workerBootstrapToken is required when worker routes are enabled");
    }
    const workerService = options.workerService;
    const bearer = (request: FastifyRequest): string => {
      const header = request.headers.authorization;
      if (header?.startsWith("Bearer ") !== true) throw new WorkerAuthenticationError();
      return header.slice("Bearer ".length);
    };
    const identity = async (request: FastifyRequest, workerId: string) => {
      const authenticated = await workerService.authenticate(bearer(request));
      if (authenticated.id !== workerId) throw new WorkerAuthenticationError();
      return authenticated;
    };
    app.post("/internal/worker/register", async (request) => {
      const token = bearer(request);
      if (token !== options.workerBootstrapToken) throw new WorkerAuthenticationError();
      return workerService.register({ ...workerRegistrationSchema.parse(request.body), token });
    });
    app.post("/internal/worker/:workerId/heartbeat", async (request) => {
      const { workerId } = workerParamsSchema.parse(request.params);
      await identity(request, workerId);
      const body = z.object({ capabilities: workerCapabilitiesSchema }).parse(request.body);
      await workerService.heartbeat(workerId, body.capabilities);
      return { ok: true };
    });
    app.post("/internal/worker/:workerId/claim", async (request) => {
      const { workerId } = workerParamsSchema.parse(request.params);
      const worker = await identity(request, workerId);
      return workerService.claim(worker, claimSchema.parse(request.body).idempotencyKey);
    });
    app.post("/internal/worker/:workerId/lease", async (request) => {
      const { workerId } = workerParamsSchema.parse(request.params);
      await identity(request, workerId);
      const body = leaseSchema.parse(request.body);
      return workerService.renewLease({
        ...body,
        fencingToken: BigInt(body.fencingToken),
        workerId,
      });
    });
    app.post("/internal/worker/:workerId/logs", async (request) => {
      const { workerId } = workerParamsSchema.parse(request.params);
      await identity(request, workerId);
      const body = leaseSchema
        .extend({
          checksum: z.string().min(1),
          content: z.string(),
          sequence: z.number().int().nonnegative(),
        })
        .parse(request.body);
      return workerService.appendLog({
        ...body,
        fencingToken: BigInt(body.fencingToken),
        workerId,
      });
    });
    app.post("/internal/worker/:workerId/result", async (request) => {
      const { workerId } = workerParamsSchema.parse(request.params);
      await identity(request, workerId);
      const body = z
        .object({
          fencingToken: z.string().regex(/^\d+$/),
          leaseId: z.string().uuid(),
          result: workerResultSchema,
        })
        .parse(request.body);
      const submitted = await workerService.submitResult({
        fencingToken: BigInt(body.fencingToken),
        leaseId: body.leaseId,
        result: body.result,
        workerId,
      });
      if (!submitted.replayed && options.postExecutionQaService !== undefined) {
        void options.postExecutionQaService
          .reviewExecution(body.result.execution_id)
          .catch((error: unknown) => {
            request.log.error(
              { error, executionId: body.result.execution_id },
              "post-execution QA failed",
            );
          });
      }
      return submitted;
    });
    app.post("/internal/worker/:workerId/finalize", async (request) => {
      const { workerId } = workerParamsSchema.parse(request.params);
      await identity(request, workerId);
      const body = leaseSchema
        .omit({ idempotencyKey: true })
        .extend({
          commitSha: z.string().min(7).nullable(),
          idempotencyKey: z.string().min(1),
          pullRequestUrl: z.string().url().nullable(),
        })
        .parse(request.body);
      return workerService.finalize({
        ...body,
        fencingToken: BigInt(body.fencingToken),
        workerId,
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
    if (error instanceof TelegramUnauthorizedError) {
      request.log.warn({ correlationId: request.id }, "unauthorized telegram user");
      return reply.code(403).send({
        code: "TELEGRAM_USER_FORBIDDEN",
        correlationId: request.id,
      });
    }
    if (error instanceof ApprovalTargetHashMismatchError) {
      request.log.warn(
        { approvalId: error.approvalId, correlationId: request.id },
        "approval target hash mismatch",
      );
      return reply.code(409).send({
        code: error.code,
        correlationId: request.id,
      });
    }
    if (error instanceof PostExecutionReviewPendingError) {
      request.log.warn(
        { approvalId: error.approvalId, correlationId: request.id },
        "post-execution review is pending",
      );
      return reply.code(409).send({
        code: error.code,
        correlationId: request.id,
      });
    }
    if (error instanceof LlmMonthlyBudgetExceededError) {
      request.log.warn({ correlationId: request.id }, "LLM monthly budget exceeded");
      return reply.code(429).send({
        code: error.code,
        correlationId: request.id,
        limitUsd: error.limitUsd,
        spentUsd: error.spentUsd,
      });
    }
    if (error instanceof TaskNotReadyForSupervisionError) {
      return reply.code(409).send({
        code: "TASK_NOT_READY_FOR_SUPERVISION",
        correlationId: request.id,
        state: error.state,
      });
    }
    if (error instanceof WorkerAuthenticationError) {
      return reply.code(401).send({ code: error.code, correlationId: request.id });
    }
    if (error instanceof WorkerLeaseError) {
      return reply.code(409).send({ code: error.code, correlationId: request.id });
    }
    if (error instanceof WorkerConflictError) {
      return reply
        .code(409)
        .send({ code: error.code, correlationId: request.id, detail: error.detail });
    }
    if (error instanceof CodexMonthlyBudgetExceededError) {
      return reply.code(429).send({
        code: error.code,
        correlationId: request.id,
        limitUsd: error.limitUsd,
        spentUsd: error.spentUsd,
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
    if (error instanceof MemoryConflictError) {
      return reply.code(409).send({
        code: error.code,
        correlationId: request.id,
        message: error.message,
      });
    }
    if (error instanceof MemoryProjectNotFoundError) {
      return reply.code(404).send({
        code: error.code,
        correlationId: request.id,
        message: error.message,
      });
    }
    if (error instanceof MemoryTaskScopeError) {
      return reply.code(422).send({
        code: error.code,
        correlationId: request.id,
        message: error.message,
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
