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

export const projectBoardColumnSchema = z.enum([
  "needs_attention",
  "in_progress",
  "stopped",
  "completed",
]);

const projectBoardDemandSchema = z
  .object({
    column: projectBoardColumnSchema,
    objective: z.string().min(1).max(160),
    stateLabel: z.string().min(1).max(80),
    taskId: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const projectsBoardResponseSchema = z
  .object({
    generatedAt: z.string().datetime(),
    projects: z.array(
      z
        .object({
          activeDemandCount: z.number().int().nonnegative(),
          columns: z
            .object({
              completed: z.array(projectBoardDemandSchema),
              inProgress: z.array(projectBoardDemandSchema),
              needsAttention: z.array(projectBoardDemandSchema),
              stopped: z.array(projectBoardDemandSchema),
            })
            .strict(),
          demandCount: z.number().int().nonnegative(),
          description: z.string().min(1).max(240),
          hasActiveDemand: z.boolean(),
          id: z.string().min(1).max(128),
          isActive: z.boolean(),
          name: z.string().min(1).max(120),
        })
        .strict(),
    ),
  })
  .strict();

export type ProjectBoardColumn = z.infer<typeof projectBoardColumnSchema>;
export type ProjectsBoardResponse = z.infer<typeof projectsBoardResponseSchema>;

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
          canDecide: z.boolean(),
          occurredAt: z.string().datetime(),
          status: z.string(),
          targetType: z.string(),
          targetVersion: z.union([z.number().int().nonnegative(), indeterminateSchema]),
          taskVersion: z.number().int().nonnegative(),
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
        taskVersion: z.number().int().nonnegative(),
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

const dashboardTaskSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().min(1),
    state: z.string().min(1),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const dashboardProjectsResponseSchema = z
  .object({
    projects: z.array(
      z
        .object({
          id: z.string().min(1).max(128),
          name: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const createDashboardDemandRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    objective: z.string().trim().min(1).max(10_000),
    projectId: z.string().min(1).max(128),
  })
  .strict();

export const createDashboardDemandResponseSchema = z
  .object({
    idempotentReplay: z.boolean(),
    task: dashboardTaskSnapshotSchema,
  })
  .strict();

export const cancelDashboardTaskRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    reason: z.string().trim().max(1_000).optional(),
    taskVersion: z.number().int().nonnegative(),
  })
  .strict();

export const cancelDashboardTaskResponseSchema = z
  .object({
    idempotentReplay: z.boolean(),
    mode: z.enum(["immediate", "cooperative"]),
    task: dashboardTaskSnapshotSchema,
  })
  .strict();

const dashboardTaskOperationalSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    pausedFromState: z.enum(["WAITING_APPROVAL", "QUEUED"]).nullable(),
    priority: z.union([z.literal(0), z.literal(10), z.literal(20)]),
    projectId: z.string().min(1),
    state: z.string().min(1),
    version: z.number().int().nonnegative(),
  })
  .strict();

const dashboardTaskVersionedCommandSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    taskVersion: z.number().int().nonnegative(),
  })
  .strict();

export const pauseDashboardTaskRequestSchema = dashboardTaskVersionedCommandSchema;
export const resumeDashboardTaskRequestSchema = dashboardTaskVersionedCommandSchema;

export const setDashboardTaskPriorityRequestSchema = dashboardTaskVersionedCommandSchema
  .extend({
    priority: z.union([z.literal(0), z.literal(10), z.literal(20)]),
  })
  .strict();

export const dashboardTaskOperationalCommandResponseSchema = z
  .object({
    idempotentReplay: z.boolean(),
    task: dashboardTaskOperationalSnapshotSchema,
  })
  .strict();

export const dashboardSessionResponseSchema = z
  .object({
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime(),
    role: z.literal("owner"),
  })
  .strict();

export const approvalDecisionRequestSchema = z
  .object({
    comment: z.string().trim().max(1_000).optional(),
    decision: z.enum(["approve", "reject", "request_change"]),
    idempotencyKey: z.string().uuid(),
    targetVersion: z.number().int().nonnegative(),
    taskVersion: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "request_change" && (value.comment?.trim().length ?? 0) === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "comment is required for request_change",
        path: ["comment"],
      });
    }
  });

export const approvalDecisionResponseSchema = z
  .object({
    approvalId: z.string().uuid(),
    decision: z.enum(["approve", "reject", "request_change"]),
    idempotentReplay: z.boolean(),
    status: z.enum(["APPROVED", "REJECTED"]),
    task: z
      .object({
        id: z.string().uuid(),
        state: z.string(),
        version: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type DashboardSessionResponse = z.infer<typeof dashboardSessionResponseSchema>;
export type DashboardProjectsResponse = z.infer<typeof dashboardProjectsResponseSchema>;
export type CreateDashboardDemandRequest = z.infer<typeof createDashboardDemandRequestSchema>;
export type CreateDashboardDemandResponse = z.infer<typeof createDashboardDemandResponseSchema>;
export type CancelDashboardTaskRequest = z.infer<typeof cancelDashboardTaskRequestSchema>;
export type CancelDashboardTaskResponse = z.infer<typeof cancelDashboardTaskResponseSchema>;
export type PauseDashboardTaskRequest = z.infer<typeof pauseDashboardTaskRequestSchema>;
export type ResumeDashboardTaskRequest = z.infer<typeof resumeDashboardTaskRequestSchema>;
export type SetDashboardTaskPriorityRequest = z.infer<typeof setDashboardTaskPriorityRequestSchema>;
export type DashboardTaskOperationalCommandResponse = z.infer<
  typeof dashboardTaskOperationalCommandResponseSchema
>;
export type ApprovalDecisionRequest = z.infer<typeof approvalDecisionRequestSchema>;
export type ApprovalDecisionResponse = z.infer<typeof approvalDecisionResponseSchema>;
