import { describe, expect, it } from "vitest";

import {
  canonicalPayloadHash,
  createEmpiricalReviewEvidence,
  createWorkerResult,
  postExecutionReviewSchema,
} from "@atlas/shared";

import {
  PostExecutionQaService,
  assertEmpiricalReviewerIndependent,
  postExecutionReviewInstructions,
  safePostExecutionFailureCode,
} from "./service.js";

const reviewer = { id: "qa", instructions: "Review delivered work." };
const workerId = "10000000-0000-4000-8000-000000000005";

function qaHarness(input: {
  approvalActor?: "SYSTEM" | "USER";
  approvalStatus: "APPROVED" | "PENDING";
  empiricalVerdict: "fail" | "pass" | "unavailable" | null;
  reviewerDecision: "approved" | "rejected";
  reviewerFailureCode?: string;
}) {
  const taskId = "10000000-0000-4000-8000-000000000001";
  const executionId = "10000000-0000-4000-8000-000000000002";
  const specificationId = "10000000-0000-4000-8000-000000000004";
  const specification = {
    acceptance_criteria: ["validated"],
    allowed_commands: [],
    approval_required_for: [],
    authorized_scope: ["docs/**"],
    constraints: [],
    context: [],
    delivery_mode: "repository_change" as const,
    expected_delivery: "PR",
    implementation_strategy: ["edit"],
    objective: "test review",
    out_of_scope: [],
    project_id: "atlas",
    required_tests: ["validate"],
    risk_level: "moderate" as const,
    task_id: taskId,
    version: 1,
  };
  const empirical = createEmpiricalReviewEvidence({
    changed_paths_hash: canonicalPayloadHash(["docs/readme.md"]),
    commands: [],
    expected_scope_hash: canonicalPayloadHash(["docs/**"]),
    finished_at: "2026-07-28T12:00:01.000Z",
    reviewer_id: workerId,
    scope_matches: true,
    started_at: "2026-07-28T12:00:00.000Z",
    unavailable_reason_code: input.empiricalVerdict === "unavailable" ? "command_denied" : null,
    unexpected_path_hashes: [],
    verdict: input.empiricalVerdict ?? "pass",
  });
  const { evidence_hash: evidenceHash, ...empiricalPayload } = empirical;
  const result = createWorkerResult({
    changed_paths: ["docs/readme.md"],
    codex_estimated_cost_usd: 0,
    commands: [
      {
        args: ["validate"],
        executable: "pnpm",
        exit_code: 0,
        finished_at: "2026-07-28T12:00:01.000Z",
        started_at: "2026-07-28T12:00:00.000Z",
        status: "passed",
      },
    ],
    contract_version: "1.0",
    diff_hash: canonicalPayloadHash("diff"),
    diff_ref: `execution:${executionId}:diff`,
    diff_summary: {
      deletions: 0,
      description: "one file",
      files_changed: 1,
      insertions: 1,
    },
    empirical_review: empirical,
    error: null,
    execution_id: executionId,
    failure_stage: null,
    finished_at: "2026-07-28T12:00:02.000Z",
    idempotency_key: `execution:${executionId}:result`,
    log_chunks: [],
    logs_truncated: false,
    pending_items: [],
    protected_path_matches: [],
    redaction_applied: true,
    risks: [],
    sequence: 1,
    specification_hash: canonicalPayloadHash(specification),
    specification_id: specificationId,
    specification_version: 1,
    started_at: "2026-07-28T12:00:00.000Z",
    status: "succeeded",
    summary: "done",
    task_id: taskId,
    tests: [
      {
        command_index: 0,
        duration_ms: 1_000,
        name: "validate",
        status: "passed",
        summary: "passed",
      },
    ],
    worker_id: workerId,
  });
  const taskUpdates: unknown[] = [];
  const approvalUpdates: unknown[] = [];
  const auditEvents: unknown[] = [];
  const reviewUpdates: unknown[] = [];
  let runtimeInput = "";
  const execution = {
    empiricalReview:
      input.empiricalVerdict === null
        ? null
        : {
            payload: empiricalPayload,
            payloadHash: evidenceHash,
            reviewerId: workerId,
            verdict: input.empiricalVerdict.toUpperCase(),
          },
    id: executionId,
    resultPayload: result,
    specification: { payload: specification },
    specificationId,
    status: "AWAITING_RESULT_APPROVAL",
    task: {
      failureStage: null,
      id: taskId,
      origin: "telegram:42:-100500",
      projectId: "atlas",
      state: "WAITING_RESULT_APPROVAL",
      version: 4,
    },
    taskId,
    workerId,
  };
  const transaction = {
    approval: {
      findUnique: () =>
        Promise.resolve({
          actor: input.approvalActor ?? "USER",
          channel: input.approvalActor === "SYSTEM" ? "POLICY" : "TELEGRAM",
          id: "10000000-0000-4000-8000-000000000007",
          status: input.approvalStatus,
        }),
      updateMany: (value: unknown) => {
        approvalUpdates.push(value);
        return Promise.resolve({ count: 1 });
      },
    },
    auditEvent: {
      create: (value: unknown) => {
        auditEvents.push(value);
        return Promise.resolve({});
      },
    },
    execution: {
      findUniqueOrThrow: () => Promise.resolve(execution),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    llmCall: { create: () => Promise.resolve({}) },
    postExecutionReview: {
      findUniqueOrThrow: () =>
        Promise.resolve({
          execution,
          executionId,
          id: "10000000-0000-4000-8000-000000000006",
          reviewerId: "qa",
          status: "RUNNING",
          taskId,
        }),
      updateMany: (value: unknown) => {
        reviewUpdates.push(value);
        return Promise.resolve({ count: 1 });
      },
    },
    task: {
      updateMany: (value: unknown) => {
        taskUpdates.push(value);
        return Promise.resolve({ count: 1 });
      },
    },
    worker: { update: () => Promise.resolve({}) },
  };
  const prisma = {
    $transaction: (callback: (client: typeof transaction) => Promise<boolean>) =>
      callback(transaction),
    execution: { findUnique: () => Promise.resolve(execution) },
    llmCall: { aggregate: () => Promise.resolve({ _sum: { estimatedCostUsd: 0 } }) },
    postExecutionReview: {
      updateMany: () => Promise.resolve({ count: 1 }),
      upsert: () =>
        Promise.resolve({
          executionId,
          id: "10000000-0000-4000-8000-000000000006",
          reviewerId: "qa",
          status: "PENDING",
          taskId,
        }),
    },
  };
  const service = new PostExecutionQaService({
    claimDurationMs: 30_000,
    council: {
      agents: new Map([["qa", reviewer]]),
      routes: { critical: ["qa"], moderate: ["qa"], simple: ["qa"] },
      supervisorId: "engineering_supervisor",
    },
    monthlyBudgetUsd: 25,
    prisma: prisma as never,
    runtime: {
      run: (request: { input: string }) => {
        runtimeInput = request.input;
        if (input.reviewerFailureCode !== undefined) {
          return Promise.reject(new Error(input.reviewerFailureCode));
        }
        return Promise.resolve({
          estimatedCostUsd: 0,
          inputTokens: 1,
          latencyMs: 1,
          model: "reviewer",
          output: {
            confidence: 1,
            decision: input.reviewerDecision,
            findings: [],
            required_actions: input.reviewerDecision === "rejected" ? ["fix tests"] : [],
            risks: [],
            summary: input.reviewerDecision,
          },
          outputTokens: 1,
        });
      },
    } as never,
  });
  return {
    approvalUpdates,
    auditEvents,
    getRuntimeInput: () => runtimeInput,
    reviewUpdates,
    service,
    taskUpdates,
  };
}

describe("PostExecutionQaService", () => {
  it("requires a reviewer distinct from the supervisor", () => {
    expect(
      () =>
        new PostExecutionQaService({
          claimDurationMs: 30_000,
          council: {
            agents: new Map([["qa", reviewer]]),
            routes: { critical: ["qa"], moderate: ["qa"], simple: ["qa"] },
            supervisorId: "qa",
          },
          monthlyBudgetUsd: 25,
          prisma: {} as never,
          runtime: {} as never,
        }),
    ).toThrow("must differ from the supervisor");
    expect(() => {
      assertEmpiricalReviewerIndependent("supervisor", "supervisor");
    }).toThrow("empirical reviewer must differ from the supervisor");
    expect(() => {
      assertEmpiricalReviewerIndependent("worker", "supervisor");
    }).not.toThrow();
  });

  it("accepts only a bounded, structured post-execution decision", () => {
    expect(
      postExecutionReviewSchema.parse({
        confidence: 0.91,
        decision: "approved",
        findings: ["Tests and diff satisfy the specification."],
        required_actions: [],
        risks: [],
        summary: "Approved for finalization.",
      }),
    ).toMatchObject({ decision: "approved" });
    expect(() => postExecutionReviewSchema.parse({ decision: "approve" })).toThrow();
  });

  it("accepts an empty diff for answer_only without weakening repository_change review", () => {
    expect(postExecutionReviewInstructions(true)).toContain(
      "an empty diff is valid and must not be rejected",
    );
    expect(postExecutionReviewInstructions(true)).toContain("Validate the textual summary");
    expect(postExecutionReviewInstructions(false)).toContain(
      "preserve the existing diff and artifact review behavior",
    );
    expect(postExecutionReviewInstructions(false)).not.toContain("an empty diff is valid");
    expect(postExecutionReviewInstructions(false)).toContain("PASS never approves by itself");
    expect(postExecutionReviewInstructions(false)).toContain("FAIL requires rework");
    expect(postExecutionReviewInstructions(false)).toContain(
      "empirical PASS plus reviewer approved",
    );
    expect(postExecutionReviewInstructions(false)).toContain(
      "existing Approval remains a separate gate",
    );
  });

  it("feeds empirical failure to the independent reviewer and returns only its rejection for rework", async () => {
    const harness = qaHarness({
      approvalStatus: "APPROVED",
      empiricalVerdict: "fail",
      reviewerDecision: "rejected",
    });
    await expect(
      harness.service.reviewExecution(
        "10000000-0000-4000-8000-000000000002",
        new Date("2026-07-28T12:01:00.000Z"),
      ),
    ).resolves.toBe(true);
    expect(harness.getRuntimeInput()).toContain('"verdict": "fail"');
    expect(harness.taskUpdates).toContainEqual(
      expect.objectContaining({ data: { state: "SPECIFYING", version: { increment: 1 } } }),
    );
    expect(JSON.stringify(harness.approvalUpdates)).toContain('"decidedBy":"post-execution-qa"');
    expect(JSON.stringify(harness.approvalUpdates)).toContain('"status":"REJECTED"');
  });

  it.each([
    {
      empiricalVerdict: "fail",
      reason: "qa_empirical_failed",
    },
    {
      empiricalVerdict: "unavailable",
      reason: "qa_empirical_unavailable",
    },
  ] as const)(
    "never approves reviewer approval when empirical evidence is $empiricalVerdict",
    async ({ empiricalVerdict, reason }) => {
      const harness = qaHarness({
        approvalStatus: "APPROVED",
        empiricalVerdict,
        reviewerDecision: "approved",
      });

      await expect(
        harness.service.reviewExecution(
          "10000000-0000-4000-8000-000000000002",
          new Date("2026-07-28T12:01:00.000Z"),
        ),
      ).resolves.toBe(true);

      const persistedReview = JSON.stringify(harness.reviewUpdates);
      expect(persistedReview).toContain(`"empiricalVerdict":"${empiricalVerdict.toUpperCase()}"`);
      expect(persistedReview).toContain(`"reconciliationReason":"${reason}"`);
      expect(persistedReview).toContain('"reviewerDecision":"APPROVED"');
      expect(persistedReview).toContain('"status":"REJECTED"');
      expect(harness.taskUpdates).toContainEqual(
        expect.objectContaining({ data: { state: "SPECIFYING", version: { increment: 1 } } }),
      );
      expect(harness.taskUpdates).not.toContainEqual(
        expect.objectContaining({ data: { state: "FINALIZING", version: { increment: 1 } } }),
      );
    },
  );

  it("returns pass plus reviewer rejection for rework", async () => {
    const harness = qaHarness({
      approvalStatus: "APPROVED",
      empiricalVerdict: "pass",
      reviewerDecision: "rejected",
    });

    await harness.service.reviewExecution(
      "10000000-0000-4000-8000-000000000002",
      new Date("2026-07-28T12:01:00.000Z"),
    );

    const persistedReview = JSON.stringify(harness.reviewUpdates);
    expect(persistedReview).toContain('"reconciliationReason":"qa_reviewer_rejected"');
    expect(persistedReview).toContain('"reviewerDecision":"REJECTED"');
    expect(persistedReview).toContain('"status":"REJECTED"');
    expect(harness.taskUpdates).toContainEqual(
      expect.objectContaining({ data: { state: "SPECIFYING", version: { increment: 1 } } }),
    );
  });

  it("keeps empirical pass advisory when the separate Approval is pending", async () => {
    const harness = qaHarness({
      approvalStatus: "PENDING",
      empiricalVerdict: "pass",
      reviewerDecision: "approved",
    });
    await expect(
      harness.service.reviewExecution(
        "10000000-0000-4000-8000-000000000002",
        new Date("2026-07-28T12:01:00.000Z"),
      ),
    ).resolves.toBe(true);
    expect(harness.getRuntimeInput()).toContain('"verdict": "pass"');
    const persistedReview = JSON.stringify(harness.reviewUpdates);
    expect(persistedReview).toContain('"empiricalVerdict":"PASS"');
    expect(persistedReview).toContain('"reconciliationReason":"qa_signals_approved"');
    expect(persistedReview).toContain('"reviewerDecision":"APPROVED"');
    expect(persistedReview).toContain('"status":"APPROVED"');
    expect(harness.taskUpdates).toEqual([]);
  });

  it("auto-approves a policy-eligible result only after both QA signals approve", async () => {
    const harness = qaHarness({
      approvalActor: "SYSTEM",
      approvalStatus: "PENDING",
      empiricalVerdict: "pass",
      reviewerDecision: "approved",
    });

    await expect(
      harness.service.reviewExecution(
        "10000000-0000-4000-8000-000000000002",
        new Date("2026-07-28T12:01:00.000Z"),
      ),
    ).resolves.toBe(true);

    expect(JSON.stringify(harness.approvalUpdates)).toContain(
      '"decidedBy":"proportional-autonomy-policy"',
    );
    expect(JSON.stringify(harness.approvalUpdates)).toContain('"status":"APPROVED"');
    expect(harness.taskUpdates).toContainEqual(
      expect.objectContaining({ data: { state: "FINALIZING", version: { increment: 1 } } }),
    );
    expect(JSON.stringify(harness.auditEvents)).toContain("approval.auto_approved");
  });

  it("fails closed when the empirical signal is missing", async () => {
    const harness = qaHarness({
      approvalStatus: "APPROVED",
      empiricalVerdict: null,
      reviewerDecision: "approved",
    });

    await expect(
      harness.service.reviewExecution(
        "10000000-0000-4000-8000-000000000002",
        new Date("2026-07-28T12:01:00.000Z"),
      ),
    ).resolves.toBe(true);

    const persistedReview = JSON.stringify(harness.reviewUpdates);
    expect(persistedReview).toContain('"empiricalVerdict":null');
    expect(persistedReview).toContain('"reconciliationReason":"qa_empirical_signal_missing"');
    expect(persistedReview).toContain('"status":"FAILED"');
    expect(harness.taskUpdates).toContainEqual(
      expect.objectContaining({ data: { state: "SPECIFYING", version: { increment: 1 } } }),
    );
  });

  it.each([
    "CLAUDE_REVIEWER_TIMEOUT",
    "CLAUDE_REVIEWER_UNAVAILABLE",
    "CLAUDE_REVIEWER_INVALID_RESPONSE",
  ])("fails closed without auto-approval when the Claude reviewer reports %s", async (code) => {
    const harness = qaHarness({
      approvalStatus: "APPROVED",
      empiricalVerdict: "pass",
      reviewerDecision: "approved",
      reviewerFailureCode: code,
    });

    await expect(
      harness.service.reviewExecution(
        "10000000-0000-4000-8000-000000000002",
        new Date("2026-07-28T12:01:00.000Z"),
      ),
    ).resolves.toBe(true);

    expect(JSON.stringify(harness.reviewUpdates)).toContain(`"failureReason":"${code}"`);
    expect(JSON.stringify(harness.reviewUpdates)).toContain('"status":"FAILED"');
    expect(harness.taskUpdates).toContainEqual(
      expect.objectContaining({ data: { state: "SPECIFYING", version: { increment: 1 } } }),
    );
    expect(JSON.stringify(harness.auditEvents)).toContain(code);
    expect(JSON.stringify(harness.auditEvents)).not.toContain("synthetic-review-input");
  });

  it("maps unknown failures to a stable sanitized code", () => {
    expect(safePostExecutionFailureCode(new Error("secret prompt and remote body"))).toBe(
      "post_execution_qa_failed",
    );
    expect(safePostExecutionFailureCode(new Error("CLAUDE_REVIEWER_TIMEOUT"))).toBe(
      "CLAUDE_REVIEWER_TIMEOUT",
    );
  });
});
