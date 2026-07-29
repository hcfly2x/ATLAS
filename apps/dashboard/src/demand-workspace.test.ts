import { describe, expect, it, vi } from "vitest";

import { DemandWorkspaceReadError, fetchDemandWorkspace } from "./demand-workspace.js";
import { demandWorkspaceFixture } from "./test/fixtures.js";

describe("demand workspace client", () => {
  it("uses only GET, the HttpOnly session cookie and the relative task endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      expect(input).toBe(`/dashboard/api/demand/${demandWorkspaceFixture.header.taskId}`);
      expect(init?.credentials).toBe("same-origin");
      expect(init?.headers).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.method).toBeUndefined();
      return Promise.resolve(
        new Response(JSON.stringify(demandWorkspaceFixture), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    });

    const result = await fetchDemandWorkspace({
      signal: new AbortController().signal,
      taskId: demandWorkspaceFixture.header.taskId,
    });

    expect(result).toEqual(demandWorkspaceFixture);
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });

  it("rejects extra raw fields through the strict contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ...demandWorkspaceFixture,
          messageText: "SECRET_MESSAGE_TEXT",
          payload: "SECRET_PAYLOAD",
          prompt: "SECRET_PROMPT",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    await expect(
      fetchDemandWorkspace({
        signal: new AbortController().signal,
        taskId: demandWorkspaceFixture.header.taskId,
      }),
    ).rejects.toEqual(new DemandWorkspaceReadError("invalid_contract"));
    fetchMock.mockRestore();
  });

  it("maps 404 without exposing a response body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("SECRET_NOT_FOUND_BODY", { status: 404 }));

    await expect(
      fetchDemandWorkspace({
        signal: new AbortController().signal,
        taskId: "missing",
      }),
    ).rejects.toEqual(new DemandWorkspaceReadError("not_found"));
    fetchMock.mockRestore();
  });
});
