import { afterEach, describe, expect, it, vi } from "vitest";

import { decideDashboardApproval } from "./approval-decision.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decideDashboardApproval", () => {
  it("obtains a session-bound CSRF token and sends no credential", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrfToken: "a".repeat(43),
            expiresAt: "2026-07-29T15:00:00.000Z",
            role: "owner",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            approvalId: "11111111-1111-4111-8111-111111111111",
            decision: "approve",
            idempotentReplay: false,
            status: "APPROVED",
            task: {
              id: "22222222-2222-4222-8222-222222222222",
              state: "QUEUED",
              version: 8,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await decideDashboardApproval({
      approvalId: "11111111-1111-4111-8111-111111111111",
      request: {
        decision: "approve",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        targetVersion: 4,
        taskVersion: 7,
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/dashboard/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
    const decisionCall = fetchMock.mock.calls[1];
    expect(decisionCall?.[0]).toContain("/dashboard/api/approvals/");
    expect(decisionCall?.[1]?.method).toBe("POST");
    expect(new Headers(decisionCall?.[1]?.headers).get("x-atlas-csrf-token")).toBe("a".repeat(43));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("synthetic-owner-secret");
  });
});
