import { projectsBoardResponseSchema, type ProjectsBoardResponse } from "@atlas/contracts";

export type ProjectsBoardReadErrorCode = "invalid_contract" | "request_failed" | "unauthorized";

export class ProjectsBoardReadError extends Error {
  constructor(readonly code: ProjectsBoardReadErrorCode) {
    super(code);
  }
}

export type ProjectsBoardClient = (signal?: AbortSignal) => Promise<ProjectsBoardResponse>;

export const fetchProjectsBoard: ProjectsBoardClient = async (signal) => {
  let response: Response;
  try {
    response = await fetch("/dashboard/api/projects-board", {
      credentials: "same-origin",
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new ProjectsBoardReadError("request_failed");
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProjectsBoardReadError("unauthorized");
  }
  if (!response.ok) throw new ProjectsBoardReadError("request_failed");
  try {
    return projectsBoardResponseSchema.parse((await response.json()) as unknown);
  } catch {
    throw new ProjectsBoardReadError("invalid_contract");
  }
};
