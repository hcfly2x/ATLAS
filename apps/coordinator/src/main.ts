import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

import { OpenAIAgentRuntime } from "@atlas/agent-runtime";

import { createCoordinatorApp } from "./app.js";
import { PrismaTaskCoreStore } from "./core/prisma-task-core-store.js";
import { loadAlwaysHumanActions, parseMonthlyBudgetUsd } from "./supervisor/config.js";
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
import { PrismaTelegramProgressStore, TelegramProgressPublisher } from "./telegram/progress.js";

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
const dashboardToken = process.env.DASHBOARD_TOKEN;
const dashboardService =
  dashboardToken === undefined || dashboardToken.trim().length === 0
    ? undefined
    : new DashboardService(prisma);
const internalAuthToken = process.env.INTERNAL_API_TOKEN;
if (internalAuthToken === undefined || internalAuthToken.length === 0) {
  throw new Error("INTERNAL_API_TOKEN is required");
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramAllowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID;
const telegramEnabled = telegramToken !== undefined && telegramAllowedUserId !== undefined;
const telegramClient = telegramEnabled ? new TelegramBotApiClient(telegramToken) : undefined;
const telegramGateway = telegramEnabled
  ? new TelegramGateway({
      allowedUserId: BigInt(telegramAllowedUserId),
      store: new PrismaTelegramStore(prisma),
      taskStore,
    })
  : undefined;
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const telegramWebhookEnabled =
  telegramClient !== undefined &&
  telegramGateway !== undefined &&
  telegramWebhookSecret !== undefined &&
  telegramWebhookSecret.trim().length > 0;
const openaiApiKey = process.env.OPENAI_API_KEY;
const supervisorService =
  openaiApiKey === undefined || openaiApiKey.trim().length === 0
    ? undefined
    : new SupervisorService({
        alwaysHuman: await loadAlwaysHumanActions(process.env.ATLAS_POLICIES_PATH),
        monthlyBudgetUsd: parseMonthlyBudgetUsd(process.env.LLM_MONTHLY_BUDGET_USD),
        memoryContextProvider: memoryService,
        runtime: new OpenAIAgentRuntime(openaiApiKey),
        store: new PrismaSupervisorStore(prisma),
        taskStore,
      });
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
    : { dashboardService, dashboardToken }),
  internalAuthToken,
  logger: true,
  memoryService,
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
app.addHook("onClose", () => {
  if (technicalRetryTimer !== undefined) clearInterval(technicalRetryTimer);
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

try {
  await app.listen({ host, port });
} catch (error: unknown) {
  app.log.error({ error }, "coordinator failed to start");
  process.exitCode = 1;
  await app.close();
}
