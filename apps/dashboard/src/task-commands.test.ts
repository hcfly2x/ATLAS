import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DashboardCommandError,
  pauseDashboardTask,
  resumeDashboardTask,
  setDashboardTaskPriority,
} from "./task-commands.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const taskId = "22222222-2222-4222-8222-222222222222";
const csrfToken = "a".repeat(43);

function sessionResponse(): Response {
  return new Response(
    JSON.stringify({
      csrfToken,
      expiresAt: "2026-07-29T15:00:00.000Z",
      role: "owner",
    }),
    { status: 200 },
  );
}

function commandResponse(state: string, version: number): Response {
  return new Response(
    JSON.stringify({
      idempotentReplay: false,
      task: {
        id: taskId,
        pausedFromState: state === "PAUSED" ? "QUEUED" : null,
        priority: 10,
        projectId: "atlas",
        state,
        version,
      },
    }),
    { status: 200 },
  );
}

describe("dashboard operational task commands", () => {
  it.each([
    ["pause", pauseDashboardTask, "PAUSED"],
    ["resume", resumeDashboardTask, "QUEUED"],
  ] as const)(
    "sends %s with the session CSRF token and versioned idempotency",
    async (path, client, state) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(commandResponse(state, 8));
      vi.stubGlobal("fetch", fetchMock);

      await client({
        request: {
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
          taskVersion: 7,
        },
        taskId,
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/dashboard/auth/session",
        expect.objectContaining({ credentials: "same-origin" }),
      );
      const commandCall = fetchMock.mock.calls[1];
      expect(commandCall?.[0]).toBe(`/dashboard/api/tasks/${taskId}/${path}`);
      expect(commandCall?.[1]?.method).toBe("POST");
      expect(new Headers(commandCall?.[1]?.headers).get("x-atlas-csrf-token")).toBe(csrfToken);
      const body = commandCall?.[1]?.body;
      if (typeof body !== "string") throw new Error("expected a JSON request body");
      expect(JSON.parse(body)).toEqual({
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        taskVersion: 7,
      });
    },
  );

  it("sends only the governed priority level in addition to the versioned command", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(commandResponse("QUEUED", 8));
    vi.stubGlobal("fetch", fetchMock);

    await setDashboardTaskPriority({
      request: {
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        priority: 20,
        taskVersion: 7,
      },
      taskId,
    });

    const commandCall = fetchMock.mock.calls[1];
    expect(commandCall?.[0]).toBe(`/dashboard/api/tasks/${taskId}/priority`);
    const body = commandCall?.[1]?.body;
    if (typeof body !== "string") throw new Error("expected a JSON request body");
    expect(JSON.parse(body)).toEqual({
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      priority: 20,
      taskVersion: 7,
    });
  });

  it("maps remote failures to a safe code without rendering the response body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "SECRET_REMOTE_BODY" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pauseDashboardTask({
        request: {
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
          taskVersion: 7,
        },
        taskId,
      }),
    ).rejects.toEqual(new DashboardCommandError("conflict"));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("SECRET_REMOTE_BODY");
  });
});
