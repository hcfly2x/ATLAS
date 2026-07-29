export type DashboardSessionErrorCode = "request_failed" | "unauthorized";

export class DashboardSessionError extends Error {
  constructor(readonly code: DashboardSessionErrorCode) {
    super(code);
    this.name = "DashboardSessionError";
  }
}

export interface DashboardSessionClientInput {
  readonly credential: string;
  readonly signal?: AbortSignal | undefined;
}

export type DashboardSessionClient = (input: DashboardSessionClientInput) => Promise<void>;

export const createDashboardSession: DashboardSessionClient = async ({ credential, signal }) => {
  let response: Response;
  try {
    response = await fetch("/dashboard/auth/session", {
      body: JSON.stringify({ credential }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new DashboardSessionError("request_failed");
  }
  if (response.status === 401) throw new DashboardSessionError("unauthorized");
  if (!response.ok) throw new DashboardSessionError("request_failed");
};
