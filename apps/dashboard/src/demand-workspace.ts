import { demandWorkspaceResponseSchema, type DemandWorkspaceResponse } from "@atlas/contracts";

export type DemandWorkspaceReadErrorCode =
  "invalid_contract" | "not_found" | "request_failed" | "unauthorized";

export class DemandWorkspaceReadError extends Error {
  constructor(readonly code: DemandWorkspaceReadErrorCode) {
    super(code);
    this.name = "DemandWorkspaceReadError";
  }
}

export interface DemandWorkspaceClientInput {
  readonly signal: AbortSignal;
  readonly taskId: string;
  readonly token: string;
}

export type DemandWorkspaceClient = (
  input: DemandWorkspaceClientInput,
) => Promise<DemandWorkspaceResponse>;

export const fetchDemandWorkspace: DemandWorkspaceClient = async ({ signal, taskId, token }) => {
  let response: Response;
  try {
    response = await fetch(`/dashboard/api/demand/${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
  } catch {
    throw new DemandWorkspaceReadError("request_failed");
  }

  if (response.status === 401) throw new DemandWorkspaceReadError("unauthorized");
  if (response.status === 404) throw new DemandWorkspaceReadError("not_found");
  if (!response.ok) throw new DemandWorkspaceReadError("request_failed");

  try {
    return demandWorkspaceResponseSchema.parse((await response.json()) as unknown);
  } catch {
    throw new DemandWorkspaceReadError("invalid_contract");
  }
};
