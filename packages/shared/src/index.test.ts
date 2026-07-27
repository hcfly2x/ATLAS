import { describe, expect, it } from "vitest";

import {
  canonicalPayloadHash,
  createMemoryItemSchema,
  createStructuredLog,
  createWorkerResult,
  divergenceAnalysisSchema,
  executableSpecificationPayloadSchema,
  specialistOpinionSchema,
  workerRuntimeSchema,
  workerResultSchema,
} from "./index.js";

describe("createStructuredLog", () => {
  it("keeps the correlation id in every structured record", () => {
    const result = createStructuredLog(
      { correlationId: "task-123", service: "coordinator" },
      "info",
      "ready",
      new Date("2026-07-23T12:00:00.000Z"),
    );

    expect(result).toEqual({
      context: { correlationId: "task-123", service: "coordinator" },
      level: "info",
      message: "ready",
      timestamp: "2026-07-23T12:00:00.000Z",
    });
  });
});

describe("canonicalPayloadHash", () => {
  it("is deterministic for semantically identical objects and changes with content", () => {
    const first = canonicalPayloadHash({
      objective: "same",
      nested: { beta: 2, alpha: 1 },
      scope: ["one", "two"],
    });
    const reordered = canonicalPayloadHash({
      scope: ["one", "two"],
      nested: { alpha: 1, beta: 2 },
      objective: "same",
    });
    const changed = canonicalPayloadHash({
      scope: ["one", "changed"],
      nested: { alpha: 1, beta: 2 },
      objective: "same",
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects values outside the JSON data model", () => {
    expect(() => canonicalPayloadHash({ invalid: undefined })).toThrow(TypeError);
    expect(() => canonicalPayloadHash({ invalid: Number.NaN })).toThrow(TypeError);
  });
});

describe("Specification delivery mode", () => {
  it("loads a legacy payload without delivery_mode as repository_change", () => {
    expect(
      executableSpecificationPayloadSchema.parse({
        acceptance_criteria: ["Legacy behavior is preserved"],
        allowed_commands: [],
        approval_required_for: [],
        authorized_scope: ["docs/**"],
        constraints: [],
        context: [],
        expected_delivery: "document",
        implementation_strategy: ["write the document"],
        objective: "Legacy specification",
        out_of_scope: [],
        project_id: "atlas",
        required_tests: ["review"],
        risk_level: "moderate",
        task_id: "10000000-0000-4000-8000-000000000001",
        version: 1,
      }).delivery_mode,
    ).toBe("repository_change");
  });

  it("fails safely to repository_change for an invalid delivery_mode", () => {
    expect(
      executableSpecificationPayloadSchema.parse({
        acceptance_criteria: ["Invalid mode cannot widen delivery"],
        allowed_commands: [],
        approval_required_for: [],
        authorized_scope: ["docs/**"],
        constraints: [],
        context: [],
        delivery_mode: "send_anywhere",
        expected_delivery: "document",
        implementation_strategy: ["write the document"],
        objective: "Invalid specification",
        out_of_scope: [],
        project_id: "atlas",
        required_tests: ["review"],
        risk_level: "moderate",
        task_id: "10000000-0000-4000-8000-000000000001",
        version: 1,
      }).delivery_mode,
    ).toBe("repository_change");
  });
});

describe("createMemoryItemSchema", () => {
  it("requires taskId for summaries but not for manual decisions", () => {
    expect(
      createMemoryItemSchema.safeParse({
        content: "completed",
        idempotencyKey: "summary-without-task",
        type: "summary",
      }).success,
    ).toBe(false);
    expect(
      createMemoryItemSchema.safeParse({
        content: "keep PostgreSQL",
        idempotencyKey: "decision-1",
        type: "decision",
      }).success,
    ).toBe(true);
  });
});

describe("multi-agent deliberation contracts", () => {
  it("validates bounded confidence and material divergences with at least two agents", () => {
    expect(
      specialistOpinionSchema.safeParse({
        acceptance_criteria: [],
        confidence: 0.8,
        findings: [],
        recommendation: "proceed",
        risks: [],
        understanding: "bounded request",
        unresolved_questions: [],
      }).success,
    ).toBe(true);
    expect(
      divergenceAnalysisSchema.safeParse({
        material_divergences: [
          {
            agent_ids: ["architect"],
            description: "material conflict",
            topic: "scope",
          },
        ],
        revision_requests: [],
      }).success,
    ).toBe(false);
  });
});

describe("workerResultSchema", () => {
  it("creates a result whose hash covers the complete validated content", () => {
    const result = createWorkerResult({
      changed_paths: [],
      codex_estimated_cost_usd: 0,
      commands: [],
      contract_version: "1.0",
      diff_hash: `sha256:${"a".repeat(64)}`,
      diff_ref: "diff:test",
      diff_summary: {
        deletions: 0,
        description: "no changes",
        files_changed: 0,
        insertions: 0,
      },
      error: null,
      execution_id: "10000000-0000-4000-8000-000000000001",
      failure_stage: null,
      finished_at: "2026-07-24T12:01:00.000Z",
      idempotency_key: "result:test",
      log_chunks: [],
      logs_truncated: false,
      pending_items: [],
      protected_path_matches: [],
      redaction_applied: true,
      risks: [],
      sequence: 1,
      specification_hash: `sha256:${"b".repeat(64)}`,
      specification_id: "10000000-0000-4000-8000-000000000002",
      specification_version: 1,
      started_at: "2026-07-24T12:00:00.000Z",
      status: "succeeded",
      summary: "done",
      task_id: "10000000-0000-4000-8000-000000000003",
      tests: [],
      worker_id: "10000000-0000-4000-8000-000000000004",
    });
    const { result_hash: _hash, ...content } = workerResultSchema.parse(result);

    expect(_hash).toBe(result.result_hash);
    expect(result.result_hash).toBe(canonicalPayloadHash(content));
  });
});

describe("workerRuntimeSchema", () => {
  it("parses a declared runtime manifest and rejects an incomplete one", () => {
    const manifest = {
      allowed_commands: [
        { executable: "pnpm", args: ["install", "--frozen-lockfile"] },
        { executable: "pnpm", args: ["validate"] },
      ],
      bootstrap: [{ executable: "pnpm", args: ["install", "--frozen-lockfile"] }],
      forbidden_commands: [{ executable: "rm", args: [] }],
      package_manager: "pnpm",
      timeout_minutes: 10,
      validate: [{ executable: "pnpm", args: ["validate"] }],
    };
    expect(workerRuntimeSchema.safeParse(manifest).success).toBe(true);
    expect(workerRuntimeSchema.safeParse({ ...manifest, validate: [] }).success).toBe(false);
  });
});
