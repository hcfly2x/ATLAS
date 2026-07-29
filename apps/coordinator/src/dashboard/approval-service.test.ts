import { describe, expect, it, vi } from "vitest";

import type { PrismaApprovalDecisionService } from "../approvals/service.js";
import { DashboardApprovalService, sanitizeApprovalComment } from "./approval-service.js";

const approvalId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";

describe("DashboardApprovalService", () => {
  it("maps request_change to the canonical human rejection path with optimistic versions", async () => {
    const decide = vi.fn().mockResolvedValue({
      approval: {
        id: approvalId,
        targetHash: "hash",
        targetId: "target",
        targetType: "SPECIFICATION",
        targetVersion: 4,
        type: "PRE_EXECUTION",
      },
      decision: "REJECTED",
      decisionKind: "request_change",
      idempotentReplay: false,
      task: { id: taskId, projectId: "atlas", state: "CANCELLED", version: 8 },
    });
    const service = new DashboardApprovalService({
      decide,
    } as unknown as PrismaApprovalDecisionService);

    await expect(
      service.decide(
        approvalId,
        {
          comment: "corrigir os critérios",
          decision: "request_change",
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
          targetVersion: 4,
          taskVersion: 7,
        },
        "correlation",
      ),
    ).resolves.toMatchObject({ decision: "request_change", status: "REJECTED" });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "DASHBOARD",
        decision: "REJECTED",
        decisionKind: "request_change",
        denySensitiveApproval: true,
        expectedTargetVersion: 4,
        expectedTaskVersion: 7,
        requireHumanActor: true,
      }),
    );
  });

  it("sanitizes comments before they can reach persistence or audit", () => {
    const sanitized = sanitizeApprovalComment(
      "Bearer top-secret\npostgres://owner:password@database/repo token=another-secret",
    );
    expect(sanitized).not.toContain("top-secret");
    expect(sanitized).not.toContain("password");
    expect(sanitized).not.toContain("another-secret");
    expect(sanitized).toContain("[REDACTED]");
  });
});
