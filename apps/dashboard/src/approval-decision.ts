import {
  approvalDecisionResponseSchema,
  dashboardSessionResponseSchema,
  type ApprovalDecisionRequest,
  type ApprovalDecisionResponse,
} from "@atlas/contracts";

export class ApprovalDecisionError extends Error {
  constructor(readonly code: "conflict" | "denied" | "request_failed" | "unauthorized") {
    super(code);
    this.name = "ApprovalDecisionError";
  }
}

export interface ApprovalDecisionClientInput {
  readonly approvalId: string;
  readonly request: ApprovalDecisionRequest;
  readonly signal?: AbortSignal | undefined;
}

export type ApprovalDecisionClient = (
  input: ApprovalDecisionClientInput,
) => Promise<ApprovalDecisionResponse>;

export const decideDashboardApproval: ApprovalDecisionClient = async ({
  approvalId,
  request,
  signal,
}) => {
  let sessionResponse: Response;
  let response: Response;
  try {
    sessionResponse = await fetch("/dashboard/auth/session", {
      credentials: "same-origin",
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
    });
    if (sessionResponse.status === 401) throw new ApprovalDecisionError("unauthorized");
    if (!sessionResponse.ok) throw new ApprovalDecisionError("request_failed");
    const session = dashboardSessionResponseSchema.parse(await sessionResponse.json());
    response = await fetch(`/dashboard/api/approvals/${encodeURIComponent(approvalId)}/decision`, {
      body: JSON.stringify(request),
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-atlas-csrf-token": session.csrfToken,
      },
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ApprovalDecisionError) throw error;
    throw new ApprovalDecisionError("request_failed");
  }
  if (response.status === 401) throw new ApprovalDecisionError("unauthorized");
  if (response.status === 403) throw new ApprovalDecisionError("denied");
  if (response.status === 409) throw new ApprovalDecisionError("conflict");
  if (!response.ok) throw new ApprovalDecisionError("request_failed");
  try {
    return approvalDecisionResponseSchema.parse(await response.json());
  } catch {
    throw new ApprovalDecisionError("request_failed");
  }
};
