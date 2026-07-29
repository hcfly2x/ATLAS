import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboardSession, DashboardSessionError } from "./session.js";

describe("dashboard session client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the credential once to the relative session endpoint and ignores the response body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("SECRET_SESSION_RESPONSE_BODY", {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createDashboardSession({ credential: "synthetic-owner-credential" }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/dashboard/auth/session", {
      body: JSON.stringify({ credential: "synthetic-owner-credential" }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  });

  it("returns only stable safe error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("SECRET_REMOTE_ERROR", { status: 401 }))),
    );

    await expect(
      createDashboardSession({ credential: "synthetic-owner-credential" }),
    ).rejects.toEqual(new DashboardSessionError("unauthorized"));
  });
});
