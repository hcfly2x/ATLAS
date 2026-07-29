import { PrismaClient, TaskState } from "@prisma/client";
import { fileURLToPath } from "node:url";

import { OpenAIAgentRuntime } from "@atlas/agent-runtime";

import { createCoordinatorApp } from "./app.js";
import { PrismaTaskCoreStore } from "./core/prisma-task-core-store.js";
import { loadAlwaysHumanActions, parseMonthlyBudgetUsd } from "./supervisor/config.js";
import { loadCouncilConfig } from "./supervisor/council-config.js";
import { PrismaSupervisorStore } from "./supervisor/prisma-supervisor-store.js";
import { SupervisorService } from "./supervisor/service.js";
import { TelegramBotApiClient } from "./telegram/client.js";
import { startTelegramPolling } from "./telegram/polling.js";
import { TelegramGateway } from "./telegram/service.js";
import { PrismaTelegramStore } from "./telegram/store.js";
import { loadProtectedGlobs } from "./worker/config.js";
import { WorkerService } from "./worker/service.js";
import { ProjectConfigStore } from "./setup/project-config.js";
import { PrismaMemoryService } from "./memory/service.js";
import { DashboardService } from "./dashboard/service.js";
import { assertRemoteDashboardConfiguration } from "./dashboard/routes.js";
import { PrismaTelegramProgressStore, TelegramProgressPublisher } from "./telegram/progress.js";
import { PrismaTelegramResultStore, TelegramResultPublisher } from "./telegram/result-publisher.js";
import { PrismaTelegramReworkStore, TelegramReworkPublisher } from "./telegram/rework-publisher.js";
import { PostExecutionQaService } from "./post-execution/service.js";
import { selectPostExecutionReviewerRuntime } from "./post-execution/reviewer-runtime.js";
import {
  DeliveryWatchdog,
  parseDeliveryWatchdogSlaMs,
  PrismaDeliveryWatchdogStore,
} from "./telegram/delivery-watchdog.js";

const prisma = new PrismaClient();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";
const setupWizardEnabled = process.env.SETUP_WIZARD_ENABLED === "true";
if (setupWizardEnabled && host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
  throw new Error("Pilot Setup Wizard requires HOST=127.0.0.1");
}
const projectConfigStore = setupWizardEnabled
  ? new ProjectConfigStore(
      process.env.ATLAS_PROJECTS_PATH ??
        fileURLToPath(new URL("../../../.atlas/projects.yaml", import.meta.url)),
    )
  : undefined;
const taskStore = new PrismaTaskCoreStore(prisma);
const memoryService = new PrismaMemoryService(prisma);
const deliverySlaMs = parseDeliveryWatchdogSlaMs(process.env.ATLAS_DELIVERY_SLA_MS);
const dashboardToken = process.env.DASHBOARD_TOKEN;
const dashboardRemoteAccessEnabled = process.env.DASHBOARD_REMOTE_ACCESS_ENABLED === "true";
assertRemoteDashboardConfiguration(dashboardRemoteAccessEnabled, dashboardToken);
const dashboardService =
  dashboardToken === undefined || dashboardToken.trim().length === 0
    ? undefined
    : new DashboardService(prisma, { deliverySlaMs });
const internalAuthToken = process.env.INTERNAL_API_TOKEN;
if (internalAuthToken === undefined || internalAuthToken.length === 0) {
  throw new Error("INTERNAL_API_TOKEN is required");
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramAllowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID;
const telegramEnabled = telegramToken !== undefined && telegramAllowedUserId !== undefined;
const telegramClient = telegramEnabled ? new TelegramBotApiClient(telegramToken) : undefined;
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const openaiApiKey = process.env.OPENAI_API_KEY;
const council =
  openaiApiKey === undefined || openaiApiKey.trim().length === 0
    ? undefined
    : await loadCouncilConfig(
        process.env.ATLAS_AGENTS_PATH ??
          fileURLToPath(new URL("../../../.atlas/agents.yaml", import.meta.url)),
        process.env.ATLAS_ROUTING_PATH ??
          fileURLToPath(new URL("../../../.atlas/routing.yaml", import.meta.url)),
      );
const agentRuntime =
  openaiApiKey === undefined || openaiApiKey.trim().length === 0
    ? undefined
    : new OpenAIAgentRuntime(openaiApiKey);
const supervisorService =
  agentRuntime === undefined || council === undefined
    ? undefined
    : new SupervisorService({
        alwaysHuman: await loadAlwaysHumanActions(process.env.ATLAS_POLICIES_PATH),
        council,
        ...(process.env.ATLAS_COUNCIL_MODEL === undefined
          ? {}
          : { councilModel: process.env.ATLAS_COUNCIL_MODEL }),
        monthlyBudgetUsd: parseMonthlyBudgetUsd(process.env.LLM_MONTHLY_BUDGET_USD),
        memoryContextProvider: memoryService,
        runtime: agentRuntime,
        store: new PrismaSupervisorStore(prisma),
        taskStore,
      });
const postExecutionReviewer =
  agentRuntime === undefined
    ? undefined
    : selectPostExecutionReviewerRuntime({
        ...(process.env.ANTHROPIC_API_KEY === undefined
          ? {}
          : { anthropicApiKey: process.env.ANTHROPIC_API_KEY }),
        ...(process.env.ATLAS_CLAUDE_REVIEWER_TIMEOUT_MS === undefined
          ? {}
          : { claudeTimeoutMs: process.env.ATLAS_CLAUDE_REVIEWER_TIMEOUT_MS }),
        openaiRuntime: agentRuntime,
        ...(process.env.ATLAS_POST_EXECUTION_REVIEWER_PROVIDER === undefined
          ? {}
          : { provider: process.env.ATLAS_POST_EXECUTION_REVIEWER_PROVIDER }),
      });
const postExecutionQaService =
  postExecutionReviewer === undefined || council === undefined
    ? undefined
    : new PostExecutionQaService({
        claimDurationMs: Number(process.env.ATLAS_POST_EXECUTION_QA_CLAIM_MS ?? "300000"),
        council,
        monthlyBudgetUsd: parseMonthlyBudgetUsd(process.env.LLM_MONTHLY_BUDGET_USD),
        prisma,
        reviewerModel: postExecutionReviewer.model,
        runtime: postExecutionReviewer.runtime,
      });
function logAutomaticSupervisionError(
  level: "error" | "warn",
  details: Record<string, unknown>,
  message: string,
): void {
  process.stderr.write(
    `${JSON.stringify({ ...details, level, message, service: "coordinator" })}\n`,
  );
}

const telegramGateway = telegramEnabled
  ? new TelegramGateway({
      allowedUserId: BigInt(telegramAllowedUserId),
      onTaskCreated: (taskId, correlationId) => {
        if (supervisorService === undefined) {
          logAutomaticSupervisionError(
            "warn",
            { correlationId, taskId },
            "task created without supervisor runtime",
          );
          return;
        }
        void supervisorService.processTask(taskId, correlationId).catch((error: unknown) => {
          logAutomaticSupervisionError(
            "error",
            {
              correlationId,
              error: error instanceof Error ? error.message : "unknown error",
              taskId,
            },
            "automatic task supervision failed",
          );
        });
      },
      store: new PrismaTelegramStore(prisma),
      taskStore,
    })
  : undefined;
const telegramWebhookEnabled =
  telegramClient !== undefined &&
  telegramGateway !== undefined &&
  telegramWebhookSecret !== undefined &&
  telegramWebhookSecret.trim().length > 0;
const workerBootstrapToken = process.env.ATLAS_WORKER_TOKEN;
const workerService =
  workerBootstrapToken === undefined || workerBootstrapToken.trim().length === 0
    ? undefined
    : new WorkerService({
        codexMonthlyBudgetUsd: Number(process.env.CODEX_MONTHLY_BUDGET_USD ?? "75"),
        leaseDurationMs: Number(process.env.ATLAS_LEASE_DURATION_MS ?? "30000"),
        prisma,
        protectedGlobsByProject: await loadProtectedGlobs(process.env.ATLAS_PROTECTED_PATHS_PATH),
      });
const workerAppOptions =
  workerService !== undefined && workerBootstrapToken !== undefined
    ? { workerBootstrapToken, workerService }
    : {};
const app = createCoordinatorApp({
  ...(dashboardService === undefined || dashboardToken === undefined
    ? {}
    : { dashboardRemoteAccessEnabled, dashboardService, dashboardToken }),
  internalAuthToken,
  logger: true,
  memoryService,
  ...(postExecutionQaService === undefined ? {} : { postExecutionQaService }),
  ...(projectConfigStore === undefined ? {} : { projectConfigStore }),
  ...(supervisorService === undefined ? {} : { supervisorService }),
  taskStore,
  ...workerAppOptions,
  ...(telegramWebhookEnabled ? { telegramClient, telegramGateway, telegramWebhookSecret } : {}),
});

app.addHook("onClose", async () => prisma.$disconnect());
const technicalRetryTimer =
  workerService === undefined
    ? undefined
    : setInterval(() => {
        void workerService.retryEligibleTechnicalFailures().catch((error: unknown) => {
          app.log.error({ error }, "technical retry reconciliation failed");
        });
      }, 15_000);
const finalizationRecoveryTimer =
  workerService === undefined
    ? undefined
    : setInterval(() => {
        void workerService.reconcileExpiredFinalizations().catch((error: unknown) => {
          app.log.error({ error }, "expired finalization reconciliation failed");
        });
      }, 15_000);
const activeLeaseRecoveryTimer =
  workerService === undefined
    ? undefined
    : setInterval(() => {
        void workerService.reconcileExpiredActiveLeases().catch((error: unknown) => {
          app.log.error({ error }, "expired active lease reconciliation failed");
        });
      }, 15_000);
if (workerService !== undefined) {
  void workerService.reconcileExpiredFinalizations().catch((error: unknown) => {
    app.log.error({ error }, "initial expired finalization reconciliation failed");
  });
  void workerService.reconcileExpiredActiveLeases().catch((error: unknown) => {
    app.log.error({ error }, "initial expired active lease reconciliation failed");
  });
}
if (supervisorService !== undefined) {
  void prisma.task
    .findMany({ where: { state: TaskState.NEW }, select: { id: true } })
    .then(async (tasks) => {
      for (const task of tasks) {
        try {
          await supervisorService.processTask(task.id, `task:${task.id}:startup-reconciliation`);
        } catch (error: unknown) {
          app.log.error({ error, taskId: task.id }, "new task reconciliation failed");
        }
      }
    })
    .catch((error: unknown) => {
      app.log.error({ error }, "new task startup reconciliation failed");
    });
}
const postExecutionQaTimer =
  postExecutionQaService === undefined
    ? undefined
    : setInterval(() => {
        void postExecutionQaService.processPendingReviews().catch((error: unknown) => {
          app.log.error({ error }, "post-execution QA reconciliation failed");
        });
      }, 15_000);
if (postExecutionQaService !== undefined) {
  void postExecutionQaService.processPendingReviews().catch((error: unknown) => {
    app.log.error({ error }, "initial post-execution QA reconciliation failed");
  });
}
app.addHook("onClose", () => {
  if (technicalRetryTimer !== undefined) clearInterval(technicalRetryTimer);
  if (finalizationRecoveryTimer !== undefined) clearInterval(finalizationRecoveryTimer);
  if (activeLeaseRecoveryTimer !== undefined) clearInterval(activeLeaseRecoveryTimer);
  if (postExecutionQaTimer !== undefined) clearInterval(postExecutionQaTimer);
});

const polling =
  process.env.TELEGRAM_MODE === "polling" &&
  telegramClient !== undefined &&
  telegramGateway !== undefined
    ? startTelegramPolling(telegramGateway, telegramClient, app.log)
    : undefined;
app.addHook("onClose", () => {
  polling?.stop();
});

const progressPublisher =
  telegramClient === undefined
    ? undefined
    : new TelegramProgressPublisher(new PrismaTelegramProgressStore(prisma), telegramClient);
const telegramProgressTimer =
  progressPublisher === undefined
    ? undefined
    : setInterval(
        () => {
          void progressPublisher.poll().catch((error: unknown) => {
            app.log.error({ error }, "telegram progress publication failed");
          });
        },
        Number(process.env.TELEGRAM_PROGRESS_INTERVAL_MS ?? "2000"),
      );
app.addHook("onClose", () => {
  if (telegramProgressTimer !== undefined) clearInterval(telegramProgressTimer);
});

const resultPublisher = new TelegramResultPublisher(
  new PrismaTelegramResultStore(prisma),
  telegramClient,
);
const deliveryWatchdog = new DeliveryWatchdog(
  new PrismaDeliveryWatchdogStore(prisma),
  deliverySlaMs,
);
const reworkPublisher = new TelegramReworkPublisher(
  new PrismaTelegramReworkStore(prisma),
  telegramClient,
);
void (async () => {
  try {
    await resultPublisher.poll();
  } catch {
    app.log.error("initial telegram result publication failed");
    return;
  }
  try {
    const result = await deliveryWatchdog.poll();
    if (result.alertsCreated > 0) {
      app.log.warn(
        {
          alertsCreated: result.alertsCreated,
          issuesObserved: result.issuesObserved,
        },
        "delivery watchdog recorded terminal delivery alerts",
      );
    }
  } catch {
    app.log.error("initial delivery watchdog reconciliation failed");
  }
})();
const telegramResultTimer = setInterval(
  () => {
    void resultPublisher.poll().catch(() => {
      app.log.error("telegram result publication failed");
    });
    void reworkPublisher.poll().catch((error: unknown) => {
      app.log.error({ error }, "telegram QA rework publication failed");
    });
  },
  Number(process.env.TELEGRAM_RESULT_INTERVAL_MS ?? "2000"),
);
const deliveryWatchdogTimer = setInterval(() => {
  void deliveryWatchdog
    .poll()
    .then((result) => {
      if (result.alertsCreated > 0) {
        app.log.warn(
          {
            alertsCreated: result.alertsCreated,
            issuesObserved: result.issuesObserved,
          },
          "delivery watchdog recorded terminal delivery alerts",
        );
      }
    })
    .catch(() => {
      app.log.error("delivery watchdog reconciliation failed");
    });
}, 15_000);
app.addHook("onClose", () => {
  clearInterval(telegramResultTimer);
  clearInterval(deliveryWatchdogTimer);
});

try {
  await app.listen({ host, port });
} catch (error: unknown) {
  app.log.error({ error }, "coordinator failed to start");
  process.exitCode = 1;
  await app.close();
}
