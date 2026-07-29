import type { ApprovalDecisionRequest, ApprovalDecisionResponse } from "@atlas/contracts";

import type {
  ApprovalDecisionResult,
  PrismaApprovalDecisionService,
} from "../approvals/service.js";

const sensitivePatterns = [
  /\bBearer\s+\S+/giu,
  /\b(?:sk|token|secret|credential|password)[-_=: ]+\S+/giu,
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/\S+/giu,
] as const;

export function sanitizeApprovalComment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let sanitized = value.replace(/\s+/gu, " ").trim();
  for (const pattern of sensitivePatterns) sanitized = sanitized.replace(pattern, "[REDACTED]");
  return sanitized.length === 0 ? undefined : sanitized.slice(0, 1_000);
}

export class DashboardApprovalService {
  constructor(private readonly decisions: PrismaApprovalDecisionService) {}

  async decide(
    approvalId: string,
    input: ApprovalDecisionRequest,
    correlationId: string,
  ): Promise<ApprovalDecisionResponse> {
    const comment = sanitizeApprovalComment(input.comment);
    const decision = input.decision === "approve" ? "APPROVED" : "REJECTED";
    const result: ApprovalDecisionResult = await this.decisions.decide({
      approvalId,
      channel: "DASHBOARD",
      ...(comment === undefined ? {} : { comment }),
      correlationId,
      decidedBy: "dashboard:owner",
      decision,
      decisionKind: input.decision,
      denySensitiveApproval: true,
      expectedTargetVersion: input.targetVersion,
      expectedTaskVersion: input.taskVersion,
      idempotencyKey: `dashboard:approval:${approvalId}:${input.idempotencyKey}`,
      requireHumanActor: true,
    });
    return {
      approvalId: result.approval.id,
      decision: input.decision,
      idempotentReplay: result.idempotentReplay,
      status: result.decision,
      task: {
        id: result.task.id,
        state: result.task.state,
        version: result.task.version,
      },
    };
  }
}
