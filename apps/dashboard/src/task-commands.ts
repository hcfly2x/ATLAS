import {
  cancelDashboardTaskResponseSchema,
  createDashboardDemandResponseSchema,
  dashboardProjectsResponseSchema,
  dashboardSessionResponseSchema,
  type CancelDashboardTaskRequest,
  type CancelDashboardTaskResponse,
  type CreateDashboardDemandRequest,
  type CreateDashboardDemandResponse,
  type DashboardProjectsResponse,
} from "@atlas/contracts";

export class DashboardCommandError extends Error {
  constructor(
    readonly code: "conflict" | "denied" | "not_found" | "request_failed" | "unauthorized",
  ) {
    super(code);
    this.name = "DashboardCommandError";
  }
}

async function csrfToken(signal?: AbortSignal): Promise<string> {
  const response = await fetch("/dashboard/auth/session", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 401) throw new DashboardCommandError("unauthorized");
  if (!response.ok) throw new DashboardCommandError("request_failed");
  return dashboardSessionResponseSchema.parse((await response.json()) as unknown).csrfToken;
}

async function command<T>(url: string, body: unknown, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-atlas-csrf-token": await csrfToken(),
      },
      method: "POST",
    });
  } catch (error: unknown) {
    if (error instanceof DashboardCommandError) throw error;
    throw new DashboardCommandError("request_failed");
  }
  if (response.status === 401) throw new DashboardCommandError("unauthorized");
  if (response.status === 403) throw new DashboardCommandError("denied");
  if (response.status === 404) throw new DashboardCommandError("not_found");
  if (response.status === 409) throw new DashboardCommandError("conflict");
  if (!response.ok) throw new DashboardCommandError("request_failed");
  try {
    return parse((await response.json()) as unknown);
  } catch {
    throw new DashboardCommandError("request_failed");
  }
}

export async function fetchDashboardProjects(
  signal?: AbortSignal,
): Promise<DashboardProjectsResponse> {
  const response = await fetch("/dashboard/api/projects", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 401) throw new DashboardCommandError("unauthorized");
  if (!response.ok) throw new DashboardCommandError("request_failed");
  return dashboardProjectsResponseSchema.parse((await response.json()) as unknown);
}

export function createDashboardDemand(
  request: CreateDashboardDemandRequest,
): Promise<CreateDashboardDemandResponse> {
  return command("/dashboard/api/demands", request, (value) =>
    createDashboardDemandResponseSchema.parse(value),
  );
}

export function cancelDashboardTask(input: {
  readonly request: CancelDashboardTaskRequest;
  readonly taskId: string;
}): Promise<CancelDashboardTaskResponse> {
  return command(
    `/dashboard/api/tasks/${encodeURIComponent(input.taskId)}/cancel`,
    input.request,
    (value) => cancelDashboardTaskResponseSchema.parse(value),
  );
}

export type CreateDashboardDemandClient = typeof createDashboardDemand;
export type CancelDashboardTaskClient = typeof cancelDashboardTask;
export type DashboardProjectsClient = typeof fetchDashboardProjects;
