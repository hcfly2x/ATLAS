import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMissionControl, readDashboardToken } from "./mission-control.js";
import { missionControlFixture } from "./test/fixtures.js";

const input = {
  projectId: "atlas",
  signal: new AbortController().signal,
  token: "synthetic-dashboard-token",
};

describe("Mission Control client boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the token only from the URL fragment", () => {
    expect(readDashboardToken("#token=safe%20value")).toBe("safe value");
    expect(readDashboardToken("?token=query-value")).toBe("");
  });

  it("sends the token only as a Bearer header and validates the contract", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(missionControlFixture), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMissionControl(input)).resolves.toEqual(missionControlFixture);
    expect(fetchMock).toHaveBeenCalledWith(
      "/dashboard/api/mission-control?projectId=atlas",
      expect.objectContaining({
        headers: { authorization: "Bearer synthetic-dashboard-token" },
      }),
    );
  });

  it("fails closed when the wire response violates the strict Zod contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ...missionControlFixture, messageText: "SECRET" }), {
            status: 200,
          }),
        ),
      ),
    );

    await expect(fetchMissionControl(input)).rejects.toMatchObject({
      code: "invalid_contract",
    });
  });
});
