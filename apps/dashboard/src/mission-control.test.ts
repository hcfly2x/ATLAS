import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMissionControl } from "./mission-control.js";
import { missionControlFixture } from "./test/fixtures.js";

const input = {
  projectId: "atlas",
  signal: new AbortController().signal,
};

describe("Mission Control client boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the relative GET endpoint with only the HttpOnly session cookie and validates the contract", async () => {
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
    expect(fetchMock).toHaveBeenCalledWith("/dashboard/api/mission-control?projectId=atlas", {
      credentials: "same-origin",
      signal: input.signal,
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("authorization");
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
