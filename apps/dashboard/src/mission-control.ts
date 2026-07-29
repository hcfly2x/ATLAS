import { missionControlResponseSchema, type MissionControlResponse } from "@atlas/contracts";

export type DashboardReadErrorCode = "invalid_contract" | "request_failed" | "unauthorized";

export class DashboardReadError extends Error {
  constructor(readonly code: DashboardReadErrorCode) {
    super(code);
    this.name = "DashboardReadError";
  }
}

export interface MissionControlClientInput {
  readonly projectId?: string;
  readonly signal: AbortSignal;
}

export type MissionControlClient = (
  input: MissionControlClientInput,
) => Promise<MissionControlResponse>;

export const fetchMissionControl: MissionControlClient = async ({ projectId, signal }) => {
  const query = projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`;
  let response: Response;
  try {
    response = await fetch(`/dashboard/api/mission-control${query}`, {
      credentials: "same-origin",
      signal,
    });
  } catch {
    throw new DashboardReadError("request_failed");
  }

  if (response.status === 401) throw new DashboardReadError("unauthorized");
  if (!response.ok) throw new DashboardReadError("request_failed");

  try {
    return missionControlResponseSchema.parse((await response.json()) as unknown);
  } catch {
    throw new DashboardReadError("invalid_contract");
  }
};
