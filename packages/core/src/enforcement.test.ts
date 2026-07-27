import { describe, expect, it } from "vitest";

import {
  ENFORCEMENT_REASON_CODES,
  decideEnforcement,
  type EnforcementInput,
} from "./enforcement.js";

const validateCommand = { executable: "pnpm", args: ["validate"] } as const;
const base: EnforcementInput = {
  action: "execute_command",
  allowedCommands: [validateCommand],
  changedPaths: [],
  command: validateCommand,
  forbiddenCommands: [],
  protectedGlobs: [".env*", "apps/worker/**"],
};
const baseWithoutCommand: EnforcementInput = {
  action: "execute_command",
  allowedCommands: [validateCommand],
  changedPaths: [],
  forbiddenCommands: [],
  protectedGlobs: [".env*", "apps/worker/**"],
};

describe("decideEnforcement", () => {
  it("returns identical canonical hashes for equivalent reordered input", () => {
    const first = decideEnforcement({
      ...base,
      allowedCommands: [validateCommand, { executable: "git", args: ["diff", "--check"] }],
      protectedGlobs: ["apps/worker/**", ".env*", ".env*"],
    });
    const second = decideEnforcement({
      ...base,
      allowedCommands: [{ executable: "git", args: ["diff", "--check"] }, validateCommand],
      protectedGlobs: [".env*", "apps/worker/**"],
    });

    expect(first).toEqual(second);
    expect(first.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.decisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("denies forbidden commands before an identical allowlist entry", () => {
    const decision = decideEnforcement({
      ...base,
      forbiddenCommands: [validateCommand],
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.COMMAND_FORBIDDEN);
  });

  it("supports executable-wide forbidden commands", () => {
    const decision = decideEnforcement({
      ...base,
      forbiddenCommands: [{ executable: "pnpm", args: [] }],
    });

    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.COMMAND_FORBIDDEN);
  });

  it("denies command arguments absent from the exact allowlist", () => {
    const decision = decideEnforcement({
      ...base,
      command: { executable: "pnpm", args: ["validate", "--fix"] },
    });

    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.COMMAND_NOT_ALLOWED);
  });

  it("requires a human for an allowed command combined with a protected path", () => {
    const decision = decideEnforcement({
      ...base,
      action: "commit",
      changedPaths: ["apps/worker/src/main.ts"],
    });

    expect(decision.decision).toBe("require_human");
    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.PATH_PROTECTED);
  });

  it("keeps a forbidden command ahead of protected-path escalation", () => {
    const decision = decideEnforcement({
      ...base,
      action: "open_pull_request",
      changedPaths: [".env.local"],
      forbiddenCommands: [validateCommand],
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.COMMAND_FORBIDDEN);
  });

  it("matches protected paths case-insensitively and includes dotfiles", () => {
    const decision = decideEnforcement({
      ...baseWithoutCommand,
      action: "commit",
      changedPaths: [".ENV.local"],
    });

    expect(decision.decision).toBe("require_human");
    expect(decision.evidence.protectedPaths).toEqual([".ENV.local"]);
  });

  it("normalizes internal traversal and retains original path evidence", () => {
    const decision = decideEnforcement({
      ...baseWithoutCommand,
      action: "commit",
      changedPaths: ["a/../apps/worker/src/main.ts", "apps/worker/src/main.ts"],
    });

    expect(decision.decision).toBe("require_human");
    expect(decision.evidence.changedPaths).toEqual([
      {
        normalized: "apps/worker/src/main.ts",
        originals: ["a/../apps/worker/src/main.ts", "apps/worker/src/main.ts"],
      },
    ]);
  });

  it.each([
    {
      changedPath: "../.env.local",
      reasonCode: ENFORCEMENT_REASON_CODES.PATH_TRAVERSAL,
    },
    {
      changedPath: "/tmp/.env.local",
      reasonCode: ENFORCEMENT_REASON_CODES.PATH_ABSOLUTE,
    },
    {
      changedPath: "apps\\worker\\src\\main.ts",
      reasonCode: ENFORCEMENT_REASON_CODES.PATH_NON_POSIX,
    },
  ])("denies unsafe path $changedPath", ({ changedPath, reasonCode }) => {
    const decision = decideEnforcement({
      ...baseWithoutCommand,
      action: "commit",
      changedPaths: [changedPath],
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe(reasonCode);
  });

  it.each([
    {
      input: baseWithoutCommand,
      label: "execute_command without command",
    },
    {
      input: { ...baseWithoutCommand, action: "commit", changedPaths: [] },
      label: "commit without paths",
    },
    {
      input: {
        ...baseWithoutCommand,
        action: "open_pull_request",
        changedPaths: [],
      },
      label: "pull request without paths",
    },
  ] satisfies readonly { input: EnforcementInput; label: string }[])(
    "denies ambiguous $label",
    ({ input }) => {
      const decision = decideEnforcement(input);

      expect(decision.decision).toBe("deny");
      expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.AMBIGUOUS_INPUT);
    },
  );

  it("allows a normalized unprotected commit", () => {
    const decision = decideEnforcement({
      ...baseWithoutCommand,
      action: "commit",
      changedPaths: ["docs/../docs/readme.md"],
    });

    expect(decision.decision).toBe("allow");
    expect(decision.evidence.changedPaths[0]?.normalized).toBe("docs/readme.md");
  });

  it.each([
    null,
    {},
    { ...base, action: "delete_data" },
    { ...base, allowedCommands: "pnpm validate" },
    { ...base, changedPaths: [42] },
    { ...base, command: { executable: "pnpm", args: "validate" } },
  ])("fails closed for structurally invalid input", (input) => {
    const decision = decideEnforcement(input);

    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe(ENFORCEMENT_REASON_CODES.INVALID_INPUT);
  });
});
