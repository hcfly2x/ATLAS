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
