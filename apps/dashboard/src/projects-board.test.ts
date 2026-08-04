import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProjectsBoard } from "./projects-board.js";
import { projectsBoardFixture } from "./test/fixtures.js";

describe("Projects board client boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the relative GET endpoint and validates the public contract", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(projectsBoardFixture), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProjectsBoard(signal)).resolves.toEqual(projectsBoardFixture);
    expect(fetchMock).toHaveBeenCalledWith("/dashboard/api/projects-board", {
      credentials: "same-origin",
      method: "GET",
      signal,
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("authorization");
  });

  it("fails closed when a sensitive field crosses the strict contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ...projectsBoardFixture,
              projects: [
                { ...projectsBoardFixture.projects[0], messageText: "SECRET_MESSAGE_TEXT" },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    await expect(fetchProjectsBoard(new AbortController().signal)).rejects.toMatchObject({
      code: "invalid_contract",
    });
  });

  it("never exposes a remote error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("SECRET_REMOTE_BODY", { status: 500 }))),
    );

    await expect(fetchProjectsBoard(new AbortController().signal)).rejects.toMatchObject({
      code: "request_failed",
    });
    await expect(fetchProjectsBoard(new AbortController().signal)).rejects.not.toThrow(
      "SECRET_REMOTE_BODY",
    );
  });
});
