import { z } from "zod";

const indeterminateSchema = z.literal("indeterminado");
const signalStatusSchema = z.enum(["available", "indeterminate"]);

const safeWorkItemSchema = z
  .object({
    complexity: z.string().nullable(),
    eta: indeterminateSchema,
    progress: z
      .object({
        methodology: z.literal("task_state"),
        stage: z.string(),
      })
      .strict(),
    projectId: z.string(),
    state: z.string(),
    taskId: z.string(),
    updatedAt: z.string().datetime(),
    version: z.number().int().nonnegative(),
  })
  .strict();

const proactiveItemSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "approval_expired",
      "approval_pending",
      "delivery_failed",
      "delivery_outbox_missing",
      "delivery_sla_exceeded",
      "rework_required",
      "review_unavailable",
      "task_blocked",
      "task_cost_limit_exceeded",
    ]),
    label: z.string(),
    occurredAt: z.string().datetime(),
    projectId: z.string(),
    severity: z.enum(["critical", "high", "medium", "info"]),
    source: z
      .object({
        id: z.string(),
        type: z.enum(["approval", "delivery", "review", "task", "usage"]),
      })
      .strict(),
    taskId: z.string(),
  })
  .strict();

function blockSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      count: z.union([z.number().int().nonnegative(), indeterminateSchema]),
      items: z.array(item),
      reason: z.literal("signal_unavailable").optional(),
      status: signalStatusSchema,
    })
    .strict();
}

const priorityNowSchema = z.union([
  z
    .object({
      item: proactiveItemSchema,
      status: z.literal("available"),
    })
    .strict(),
  z
    .object({
      item: z.null(),
      status: z.literal("available"),
    })
    .strict(),
  z
    .object({
      item: z.null(),
      status: z.literal("indeterminate"),
      value: indeterminateSchema,
    })
    .strict(),
]);

export const missionControlResponseSchema = z
  .object({
    blocked: blockSchema(safeWorkItemSchema),
    generatedAt: z.string().datetime(),
    inProgress: blockSchema(safeWorkItemSchema),
    intelligence: z
      .object({
        facts: z.array(
          z
            .object({
              code: z.string(),
              label: z.string(),
              value: z.union([z.number().int().nonnegative(), indeterminateSchema]),
            })
            .strict(),
        ),
        generatedBy: z.literal("deterministic_rules"),
        headline: z.string(),
        status: z.enum(["available", "partial", "indeterminate"]),
      })
      .strict(),
    methodology: z
      .object({
        cost: z.literal("declared_task_cost_limit"),
        eta: indeterminateSchema,
        pendingQuestions: indeterminateSchema,
        progress: z.literal("task_state"),
        recentWindowDays: z.number().int().positive(),
      })
      .strict(),
    needsAttention: blockSchema(proactiveItemSchema),
    priorityNow: priorityNowSchema,
    projectId: z.string().nullable(),
    recentlyCompleted: blockSchema(safeWorkItemSchema),
    risks: blockSchema(proactiveItemSchema),
    unavailableSignals: z.array(z.string()),
  })
  .strict();

export type MissionControlResponse = z.infer<typeof missionControlResponseSchema>;

const workspaceValueSchema = z.union([z.string(), indeterminateSchema]);

const demandWorkspaceExecutionSchema = z
  .object({
    attempt: z.number().int().positive(),
    diffSummary: z.union([
      z
        .object({
          deletions: z.number().int().nonnegative(),
          filesChanged: z.number().int().nonnegative(),
          insertions: z.number().int().nonnegative(),
        })
        .strict(),
      indeterminateSchema,
    ]),
    durationMs: z.union([z.number().int().nonnegative(), indeterminateSchema]),
    executables: z.union([z.array(z.string().min(1)), indeterminateSchema]),
    executionId: z.string(),
    protectedPathMatchCount: z.union([z.number().int().nonnegative(), indeterminateSchema]),
    resultStatus: workspaceValueSchema,
    specificationVersion: z.union([z.number().int().positive(), indeterminateSchema]),
    status: z.string(),
  })
  .strict();

export const demandWorkspaceResponseSchema = z
  .object({
    approvals: z.array(
      z
        .object({
          actor: z.enum(["SYSTEM", "USER"]),
          approvalId: z.string(),
          occurredAt: z.string().datetime(),
          status: z.string(),
          targetVersion: z.union([z.number().int().nonnegative(), indeterminateSchema]),
          type: z.string(),
        })
        .strict(),
    ),
    cost: z
      .object({
        currency: z.literal("USD"),
        estimatedUsd: z.union([z.number().nonnegative(), indeterminateSchema]),
        methodology: z.literal("persisted_estimates"),
      })
      .strict(),
    demand: z
      .object({
        objective: workspaceValueSchema,
      })
      .strict(),
    executions: z.array(demandWorkspaceExecutionSchema),
    generatedAt: z.string().datetime(),
    header: z
      .object({
        autonomyLevel: z.union([z.number().int().min(0).max(4), indeterminateSchema]),
        createdAt: z.string().datetime(),
        deliveryMode: z.union([z.enum(["answer_only", "repository_change"]), indeterminateSchema]),
        executionState: workspaceValueSchema,
        originChannel: workspaceValueSchema,
        project: z
          .object({
            id: z.string(),
            name: z.string(),
          })
          .strict(),
        risk: workspaceValueSchema,
        taskId: z.string(),
        taskState: z.string(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
    memory: z
      .object({
        byType: z
          .object({
            DECISION: z.number().int().nonnegative(),
            NOTE: z.number().int().nonnegative(),
            SUMMARY: z.number().int().nonnegative(),
          })
          .strict(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    plan: z
      .object({
        acceptanceCriteria: z.union([z.array(z.string()), indeterminateSchema]),
        implementationStrategy: z.union([z.array(z.string()), indeterminateSchema]),
        specificationVersion: z.union([z.number().int().positive(), indeterminateSchema]),
      })
      .strict(),
    qa: z.array(
      z
        .object({
          empiricalVerdict: z.union([z.enum(["FAIL", "PASS", "UNAVAILABLE"]), indeterminateSchema]),
          executionId: z.string(),
          reconciliationReason: z.union([
            z.enum([
              "qa_empirical_failed",
              "qa_empirical_signal_missing",
              "qa_empirical_unavailable",
              "qa_reviewer_rejected",
              "qa_reviewer_signal_missing",
              "qa_signals_approved",
            ]),
            indeterminateSchema,
          ]),
          reviewerDecision: z.union([z.enum(["APPROVED", "REJECTED"]), indeterminateSchema]),
        })
        .strict(),
    ),
    timeline: z.array(
      z
        .object({
          action: z.string(),
          correlationId: z.string(),
          eventId: z.string(),
          occurredAt: z.string().datetime(),
        })
        .strict(),
    ),
  })
  .strict();

export type DemandWorkspaceResponse = z.infer<typeof demandWorkspaceResponseSchema>;
