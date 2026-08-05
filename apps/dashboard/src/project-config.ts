import {
  dashboardProjectCommandResponseSchema,
  dashboardProjectConfigsResponseSchema,
  dashboardProjectRepositorySuggestionSchema,
  dashboardSessionResponseSchema,
  type CreateDashboardProjectRequest,
  type DashboardProjectCommandResponse,
  type DashboardProjectRepositorySuggestion,
  type DashboardProjectStatusRequest,
  type UpdateDashboardProjectRequest,
} from "@atlas/contracts";

export class ProjectConfigClientError extends Error {
  constructor(
    readonly code:
      "conflict" | "denied" | "invalid" | "not_found" | "request_failed" | "unauthorized",
  ) {
    super(code);
    this.name = "ProjectConfigClientError";
  }
}

async function csrfToken(): Promise<string> {
  const response = await fetch("/dashboard/auth/session", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (response.status === 401) throw new ProjectConfigClientError("unauthorized");
  if (!response.ok) throw new ProjectConfigClientError("request_failed");
  return dashboardSessionResponseSchema.parse((await response.json()) as unknown).csrfToken;
}

async function write<T>(
  url: string,
  method: "POST" | "PUT",
  body: unknown,
  parse: (value: unknown) => T,
): Promise<T> {
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
      method,
    });
  } catch (error: unknown) {
    if (error instanceof ProjectConfigClientError) throw error;
    throw new ProjectConfigClientError("request_failed");
  }
  if (response.status === 401) throw new ProjectConfigClientError("unauthorized");
  if (response.status === 403) throw new ProjectConfigClientError("denied");
  if (response.status === 404) throw new ProjectConfigClientError("not_found");
  if (response.status === 409) throw new ProjectConfigClientError("conflict");
  if (response.status === 422) throw new ProjectConfigClientError("invalid");
  if (!response.ok) throw new ProjectConfigClientError("request_failed");
  return parse((await response.json()) as unknown);
}

export async function fetchProjectConfigs(signal?: AbortSignal) {
  const response = await fetch("/dashboard/api/project-configs", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 401) throw new ProjectConfigClientError("unauthorized");
  if (response.status === 403) throw new ProjectConfigClientError("denied");
  if (!response.ok) throw new ProjectConfigClientError("request_failed");
  return dashboardProjectConfigsResponseSchema.parse((await response.json()) as unknown);
}

export function createProject(
  request: CreateDashboardProjectRequest,
): Promise<DashboardProjectCommandResponse> {
  return write("/dashboard/api/project-configs", "POST", request, (value) =>
    dashboardProjectCommandResponseSchema.parse(value),
  );
}

export function updateProject(input: {
  readonly projectId: string;
  readonly request: UpdateDashboardProjectRequest;
}): Promise<DashboardProjectCommandResponse> {
  return write(
    `/dashboard/api/project-configs/${encodeURIComponent(input.projectId)}`,
    "PUT",
    input.request,
    (value) => dashboardProjectCommandResponseSchema.parse(value),
  );
}

export function setProjectActive(input: {
  readonly active: boolean;
  readonly projectId: string;
  readonly request: DashboardProjectStatusRequest;
}): Promise<DashboardProjectCommandResponse> {
  return write(
    `/dashboard/api/project-configs/${encodeURIComponent(input.projectId)}/${input.active ? "activate" : "deactivate"}`,
    "POST",
    input.request,
    (value) => dashboardProjectCommandResponseSchema.parse(value),
  );
}

export function detectProjectRepository(
  repository: string,
): Promise<DashboardProjectRepositorySuggestion> {
  return write("/dashboard/api/project-configs/detect", "POST", { repository }, (value) =>
    dashboardProjectRepositorySuggestionSchema.parse(value),
  );
}

export type ProjectConfigsClient = typeof fetchProjectConfigs;
