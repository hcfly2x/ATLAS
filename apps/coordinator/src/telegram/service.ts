import { z } from "zod";

import { TaskStateMachine, type TaskCoreStore, type TaskSnapshot } from "@atlas/core";

import type { ApprovalDecisionResult, TelegramStore, TelegramTaskStatus } from "./store.js";
import {
  telegramUpdateSchema,
  type TelegramDispatch,
  type TelegramResponse,
  type TelegramUpdate,
} from "./types.js";

const projectCallbackSchema = z.string().regex(/^project:[a-zA-Z0-9._-]{1,128}$/);
const approvalCallbackSchema = z.string().regex(/^approval:[0-9a-f-]{36}:(approve|reject)$/);
const commandSchema = z.object({
  command: z.string().min(1),
  argument: z.string().optional(),
});
const optionalTaskIdSchema = z.string().uuid().optional();

export class TelegramUnauthorizedError extends Error {
  constructor() {
    super("Telegram user is not authorized");
    this.name = "TelegramUnauthorizedError";
  }
}

export interface TelegramGatewayOptions {
  readonly allowedUserId: bigint;
  readonly store: TelegramStore;
  readonly taskStore: TaskCoreStore;
}

function parseCommand(text: string): z.infer<typeof commandSchema> | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }
  const [rawCommand, argument] = text.trim().split(/\s+/, 2);
  const command = rawCommand?.slice(1).split("@", 1)[0];
  return commandSchema.parse({
    command,
    ...(argument === undefined ? {} : { argument }),
  });
}

function taskLine(task: TaskSnapshot): string {
  return `Task ${task.id}\nProjeto: ${task.projectId}\nEstado: ${task.state}\nVersão: ${String(task.version)}`;
}

function statusResponse(status: TelegramTaskStatus): TelegramResponse {
  const buttons = status.approvals.map((approval) => [
    {
      callbackData: `approval:${approval.id}:approve`,
      text: `Aprovar ${approval.targetType} v${String(approval.targetVersion ?? "-")}`,
    },
    {
      callbackData: `approval:${approval.id}:reject`,
      text: `Rejeitar ${approval.targetType}`,
    },
  ]);
  const targets = status.approvals.map(
    (approval) =>
      `${approval.targetType}:${approval.targetId}@${String(approval.targetVersion ?? "-")}#${approval.targetHash}`,
  );
  return {
    text: `${taskLine(status.task)}${
      targets.length === 0 ? "" : `\nAprovações pendentes:\n${targets.join("\n")}`
    }`,
    ...(buttons.length === 0 ? {} : { buttons }),
  };
}

function approvalTransition(
  result: ApprovalDecisionResult,
): "CANCELLED" | "FINALIZING" | "QUEUED" | "SPECIFYING" | undefined {
  if (result.approval.type === "PRE_EXECUTION" && result.task.state === "WAITING_APPROVAL") {
    return result.decision === "APPROVED" ? "QUEUED" : "CANCELLED";
  }
  if (result.approval.type === "RESULT" && result.task.state === "WAITING_RESULT_APPROVAL") {
    return result.decision === "APPROVED" ? "FINALIZING" : "SPECIFYING";
  }
  return undefined;
}

export class TelegramGateway {
  private readonly stateMachine: TaskStateMachine;

  constructor(private readonly options: TelegramGatewayOptions) {
    this.stateMachine = new TaskStateMachine(options.taskStore);
  }

  async handle(rawUpdate: unknown, correlationId: string): Promise<TelegramDispatch> {
    const update = telegramUpdateSchema.parse(rawUpdate);
    const context = this.context(update);
    if (context.userId !== this.options.allowedUserId) {
      throw new TelegramUnauthorizedError();
    }

    const replay = await this.options.store.findProcessedUpdate(context.updateId);
    if (replay !== undefined) {
      return {
        ...context,
        replayed: true,
        responses: replay,
      };
    }

    const responses =
      update.message === undefined
        ? await this.handleCallback(update, correlationId)
        : await this.handleMessage(update, correlationId);
    const recorded = await this.options.store.recordProcessedUpdate({
      ...context,
      responses,
      userId: context.userId,
    });
    return {
      ...context,
      replayed: recorded.idempotentReplay,
      responses: recorded.responses,
    };
  }

  private context(update: TelegramUpdate): {
    callbackId?: string;
    chatId: bigint;
    updateId: bigint;
    userId: bigint;
  } {
    if (update.message !== undefined) {
      return {
        chatId: BigInt(update.message.chat.id),
        updateId: BigInt(update.update_id),
        userId: BigInt(update.message.from.id),
      };
    }
    const callback = update.callback_query;
    if (callback?.message === undefined) {
      throw new Error("Callback query message context is required");
    }
    return {
      callbackId: callback.id,
      chatId: BigInt(callback.message.chat.id),
      updateId: BigInt(update.update_id),
      userId: BigInt(callback.from.id),
    };
  }

  private async handleMessage(
    update: TelegramUpdate,
    correlationId: string,
  ): Promise<readonly TelegramResponse[]> {
    const message = update.message;
    if (message === undefined) {
      throw new Error("Message is required");
    }
    if (message.text === undefined) {
      return [{ text: "Somente mensagens de texto são aceitas nesta fase." }];
    }
    const userId = BigInt(message.from.id);
    const command = parseCommand(message.text);
    if (command?.command === "start") {
      return [
        {
          text: "ATLAS pronto. Use /projects para selecionar um projeto e envie uma mensagem para criar uma Task.",
        },
      ];
    }
    if (command?.command === "projects") {
      const projects = await this.options.store.listProjects();
      return [
        {
          text: projects.length === 0 ? "Nenhum projeto disponível." : "Selecione um projeto:",
          ...(projects.length === 0
            ? {}
            : {
                buttons: projects.map((project) => [
                  { callbackData: `project:${project.id}`, text: project.name },
                ]),
              }),
        },
      ];
    }
    if (command?.command === "status") {
      const taskId = optionalTaskIdSchema.parse(command.argument);
      const status = await this.options.store.findTaskStatus(userId, taskId);
      return [status === undefined ? { text: "Nenhuma Task encontrada." } : statusResponse(status)];
    }
    if (command?.command === "cancel") {
      const taskId = optionalTaskIdSchema.parse(command.argument);
      const status = await this.options.store.findTaskStatus(userId, taskId);
      if (status === undefined) {
        return [{ text: "Nenhuma Task encontrada para cancelamento." }];
      }
      if (status.task.state === "COMPLETED" || status.task.state === "CANCELLED") {
        return [{ text: `Task ${status.task.id} já está em estado terminal.` }];
      }
      const target =
        status.task.state === "RUNNING" ||
        status.task.state === "TESTING" ||
        status.task.state === "WAITING_RESULT_APPROVAL" ||
        status.task.state === "FINALIZING"
          ? "CANCEL_REQUESTED"
          : "CANCELLED";
      const result = await this.stateMachine.transition({
        actor: "user",
        correlationId,
        expectedVersion: status.task.version,
        idempotencyKey: `telegram:update:${String(update.update_id)}:cancel`,
        taskId: status.task.id,
        toState: target,
      });
      return [
        {
          text:
            target === "CANCEL_REQUESTED"
              ? `Cancelamento cooperativo solicitado para ${result.task.id}.`
              : `Task ${result.task.id} cancelada.`,
        },
      ];
    }
    if (command !== undefined) {
      return [{ text: "Comando não suportado. Use /projects, /status ou /cancel." }];
    }

    const project = await this.options.store.getSelectedProject(userId);
    if (project === undefined) {
      return [{ text: "Selecione um projeto primeiro com /projects." }];
    }
    const created = await this.options.taskStore.createTask({
      correlationId,
      idempotencyKey: `telegram:update:${String(update.update_id)}:task`,
      origin: `telegram:${userId.toString()}`,
      originalMessage: message.text,
      projectId: project.id,
    });
    return [
      {
        text: `${created.idempotentReplay ? "Task existente" : "Task criada"}: ${created.task.id}\nProjeto: ${project.name}\nEstado: ${created.task.state}`,
      },
    ];
  }

  private async handleCallback(
    update: TelegramUpdate,
    correlationId: string,
  ): Promise<readonly TelegramResponse[]> {
    const callback = update.callback_query;
    if (callback?.message === undefined) {
      throw new Error("Callback query message context is required");
    }
    const userId = BigInt(callback.from.id);
    const projectMatch = projectCallbackSchema.safeParse(callback.data);
    if (projectMatch.success) {
      const projectId = projectMatch.data.slice("project:".length);
      const project = await this.options.store.selectProject(
        userId,
        BigInt(callback.message.chat.id),
        projectId,
      );
      return [{ text: `Projeto selecionado: ${project.name}.` }];
    }

    const approvalMatch = approvalCallbackSchema.safeParse(callback.data);
    if (approvalMatch.success) {
      const [, approvalId, action] = approvalMatch.data.split(":");
      if (approvalId === undefined || action === undefined) {
        throw new Error("Invalid approval callback");
      }
      const decision = action === "approve" ? "APPROVED" : "REJECTED";
      const result = await this.options.store.decideApproval({
        approvalId,
        callbackId: callback.id,
        correlationId,
        decision,
        userId,
      });
      const toState = approvalTransition(result);
      if (toState !== undefined) {
        await this.stateMachine.transition({
          actor: "user",
          correlationId,
          expectedVersion: result.task.version,
          idempotencyKey: `telegram:callback:${callback.id}:transition`,
          taskId: result.task.id,
          toState,
        });
      }
      return [
        {
          text: `${decision === "APPROVED" ? "Aprovado" : "Rejeitado"}: ${result.approval.targetType}:${result.approval.targetId}@${String(result.approval.targetVersion ?? "-")}#${result.approval.targetHash}`,
        },
      ];
    }

    return [{ text: "Ação desconhecida ou expirada." }];
  }
}
