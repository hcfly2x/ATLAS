import { posix } from "node:path";

import { minimatch } from "minimatch";

import { canonicalPayloadHash } from "@atlas/shared";

export const ENFORCEMENT_REASON_CODES = {
  ALLOWED: "allowed",
  AMBIGUOUS_INPUT: "ambiguous_input",
  COMMAND_FORBIDDEN: "command_forbidden",
  COMMAND_GNU_TOOL_NOT_DECLARED: "command_gnu_tool_not_declared",
  COMMAND_NOT_ALLOWED: "command_not_allowed",
  INVALID_INPUT: "invalid_input",
  PATH_ABSOLUTE: "path_absolute",
  PATH_NON_POSIX: "path_non_posix",
  PATH_PROTECTED: "path_protected",
  PATH_TRAVERSAL: "path_traversal",
} as const;

export type EnforcementReasonCode =
  (typeof ENFORCEMENT_REASON_CODES)[keyof typeof ENFORCEMENT_REASON_CODES];
export type EnforcementAction = "execute_command" | "commit" | "open_pull_request";
export type EnforcementDecisionKind = "allow" | "deny" | "require_human";

export interface EnforcementCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface EnforcementInput {
  readonly action: EnforcementAction;
  readonly command?: EnforcementCommand;
  readonly allowedCommands: readonly EnforcementCommand[];
  readonly forbiddenCommands: readonly EnforcementCommand[];
  readonly gnuOnlyExecutables?: readonly string[];
  readonly gnuTools?: readonly string[];
  readonly changedPaths: readonly string[];
  readonly protectedGlobs: readonly string[];
}

export interface NormalizedPathEvidence {
  readonly normalized: string;
  readonly originals: readonly string[];
}

export interface EnforcementEvidence {
  readonly action: EnforcementAction;
  readonly allowedCommands: readonly EnforcementCommand[];
  readonly changedPaths: readonly NormalizedPathEvidence[];
  readonly command?: EnforcementCommand;
  readonly forbiddenCommands: readonly EnforcementCommand[];
  readonly gnuOnlyExecutables?: readonly string[];
  readonly gnuTools?: readonly string[];
  readonly protectedGlobs: readonly string[];
  readonly protectedPaths: readonly string[];
}

export interface EnforcementDecision {
  readonly decision: EnforcementDecisionKind;
  readonly decisionHash: string;
  readonly evidence: EnforcementEvidence;
  readonly inputHash: string;
  readonly reasonCode: EnforcementReasonCode;
  readonly rules: readonly string[];
}

const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;
const ACTIONS = new Set<EnforcementAction>(["execute_command", "commit", "open_pull_request"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function commandKey(command: EnforcementCommand): string {
  return `${command.executable}\u0000${command.args.join("\u0000")}`;
}

function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value as readonly unknown[];
  if (values.some((item) => typeof item !== "string")) return undefined;
  return values.map((item) => String(item));
}

function parseCommand(value: unknown): EnforcementCommand | undefined {
  if (!isRecord(value) || typeof value.executable !== "string") return undefined;
  const args = parseStringArray(value.args);
  return args === undefined ? undefined : { args, executable: value.executable };
}

function parseCommandArray(value: unknown): readonly EnforcementCommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value as readonly unknown[];
  const commands: EnforcementCommand[] = [];
  for (const item of values) {
    const command = parseCommand(item);
    if (command === undefined) return undefined;
    commands.push(command);
  }
  return commands;
}

function parseInput(value: unknown): EnforcementInput | undefined {
  if (!isRecord(value) || typeof value.action !== "string") return undefined;
  if (!ACTIONS.has(value.action as EnforcementAction)) return undefined;
  const action = value.action as EnforcementAction;
  const allowedCommands = parseCommandArray(value.allowedCommands);
  const forbiddenCommands = parseCommandArray(value.forbiddenCommands);
  const gnuOnlyExecutables =
    value.gnuOnlyExecutables === undefined ? undefined : parseStringArray(value.gnuOnlyExecutables);
  const gnuTools = value.gnuTools === undefined ? undefined : parseStringArray(value.gnuTools);
  const changedPaths = parseStringArray(value.changedPaths);
  const protectedGlobs = parseStringArray(value.protectedGlobs);
  if (
    allowedCommands === undefined ||
    forbiddenCommands === undefined ||
    changedPaths === undefined ||
    protectedGlobs === undefined
  ) {
    return undefined;
  }
  if (
    action === "execute_command" &&
    (gnuOnlyExecutables === undefined || gnuTools === undefined)
  ) {
    return undefined;
  }
  const common = {
    action,
    allowedCommands,
    changedPaths,
    forbiddenCommands,
    gnuOnlyExecutables: gnuOnlyExecutables ?? [],
    gnuTools: gnuTools ?? [],
    protectedGlobs,
  };
  if (value.command === undefined) return common;
  const command = parseCommand(value.command);
  return command === undefined ? undefined : { ...common, command };
}

function normalizeCommand(command: EnforcementCommand): EnforcementCommand | undefined {
  if (
    command.executable.length === 0 ||
    !SAFE_TOKEN.test(command.executable) ||
    command.args.some((argument) => !SAFE_TOKEN.test(argument))
  ) {
    return undefined;
  }
  return { args: [...command.args], executable: command.executable };
}

function canonicalizeCommands(
  commands: readonly EnforcementCommand[],
): readonly EnforcementCommand[] {
  const copies = commands.map((command) => ({
    args: [...command.args],
    executable: command.executable,
  }));
  return [...new Map(copies.map((command) => [commandKey(command), command])).values()].sort(
    (left, right) => compareText(commandKey(left), commandKey(right)),
  );
}

function canonicalizeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

type PathNormalization =
  | { readonly evidence: readonly NormalizedPathEvidence[] }
  | { readonly reasonCode: EnforcementReasonCode; readonly rules: readonly string[] };

function normalizePaths(paths: readonly string[]): PathNormalization {
  const grouped = new Map<string, Set<string>>();
  for (const original of paths) {
    if (original.length === 0) {
      return {
        reasonCode: ENFORCEMENT_REASON_CODES.INVALID_INPUT,
        rules: ["path.non_empty"],
      };
    }
    if (original.includes("\\")) {
      return {
        reasonCode: ENFORCEMENT_REASON_CODES.PATH_NON_POSIX,
        rules: ["path.posix_separator"],
      };
    }
    if (posix.isAbsolute(original)) {
      return {
        reasonCode: ENFORCEMENT_REASON_CODES.PATH_ABSOLUTE,
        rules: ["path.relative_to_worktree"],
      };
    }
    const normalized = posix.normalize(original);
    if (normalized === ".." || normalized.startsWith("../")) {
      return {
        reasonCode: ENFORCEMENT_REASON_CODES.PATH_TRAVERSAL,
        rules: ["path.inside_worktree"],
      };
    }
    const originals = grouped.get(normalized) ?? new Set<string>();
    originals.add(original);
    grouped.set(normalized, originals);
  }
  return {
    evidence: [...grouped.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([normalized, originals]) => ({
        normalized,
        originals: [...originals].sort(compareText),
      })),
  };
}

function commandMatches(left: EnforcementCommand, right: EnforcementCommand): boolean {
  return commandKey(left) === commandKey(right);
}

function forbiddenCommandMatches(
  forbidden: EnforcementCommand,
  requested: EnforcementCommand,
): boolean {
  return (
    forbidden.executable === requested.executable &&
    (forbidden.args.length === 0 || commandMatches(forbidden, requested))
  );
}

function finish(
  decision: EnforcementDecisionKind,
  reasonCode: EnforcementReasonCode,
  rules: readonly string[],
  evidence: EnforcementEvidence,
): EnforcementDecision {
  const inputHash = canonicalPayloadHash(evidence);
  const decisionContent = { decision, evidence, inputHash, reasonCode, rules: [...rules] };
  return {
    ...decisionContent,
    decisionHash: canonicalPayloadHash(decisionContent),
  };
}

function emptyEvidence(input: unknown): EnforcementEvidence {
  const action =
    isRecord(input) &&
    typeof input.action === "string" &&
    ACTIONS.has(input.action as EnforcementAction)
      ? (input.action as EnforcementAction)
      : "execute_command";
  return {
    action,
    allowedCommands: [],
    changedPaths: [],
    forbiddenCommands: [],
    protectedGlobs: [],
    protectedPaths: [],
  };
}

export function decideEnforcement(rawInput: unknown): EnforcementDecision {
  const input = parseInput(rawInput);
  if (input === undefined || input.protectedGlobs.some((glob) => glob.length === 0)) {
    const evidence = emptyEvidence(rawInput);
    return finish("deny", ENFORCEMENT_REASON_CODES.INVALID_INPUT, ["input.valid"], evidence);
  }

  const allowedCommands = canonicalizeCommands(input.allowedCommands);
  const forbiddenCommands = canonicalizeCommands(input.forbiddenCommands);
  const gnuOnlyExecutables = canonicalizeStrings(input.gnuOnlyExecutables ?? []);
  const gnuTools = canonicalizeStrings(input.gnuTools ?? []);
  const command = input.command === undefined ? undefined : normalizeCommand(input.command);
  const paths = normalizePaths(input.changedPaths);
  if (input.command !== undefined && command === undefined) {
    const evidence = emptyEvidence(input);
    return finish("deny", ENFORCEMENT_REASON_CODES.INVALID_INPUT, ["command.valid"], evidence);
  }
  if ("reasonCode" in paths) {
    const evidence: EnforcementEvidence = {
      action: input.action,
      allowedCommands,
      changedPaths: [],
      ...(command === undefined ? {} : { command }),
      forbiddenCommands,
      ...(input.action === "execute_command" ? { gnuOnlyExecutables, gnuTools } : {}),
      protectedGlobs: [...new Set(input.protectedGlobs)].sort(compareText),
      protectedPaths: [],
    };
    return finish("deny", paths.reasonCode, paths.rules, evidence);
  }

  const protectedGlobs = [...new Set(input.protectedGlobs)].sort(compareText);
  const protectedPaths = paths.evidence
    .filter(({ normalized }) =>
      protectedGlobs.some((glob) =>
        minimatch(normalized, glob, { dot: true, matchBase: false, nocase: true }),
      ),
    )
    .map(({ normalized }) => normalized);
  const evidence: EnforcementEvidence = {
    action: input.action,
    allowedCommands,
    changedPaths: paths.evidence,
    ...(command === undefined ? {} : { command }),
    forbiddenCommands,
    ...(input.action === "execute_command" ? { gnuOnlyExecutables, gnuTools } : {}),
    protectedGlobs,
    protectedPaths,
  };

  if (
    (input.action === "execute_command" && command === undefined) ||
    (input.action !== "execute_command" && paths.evidence.length === 0)
  ) {
    return finish(
      "deny",
      ENFORCEMENT_REASON_CODES.AMBIGUOUS_INPUT,
      ["action.required_evidence"],
      evidence,
    );
  }
  if (
    command !== undefined &&
    gnuOnlyExecutables.includes(command.executable) &&
    !gnuTools.includes(command.executable)
  ) {
    return finish(
      "deny",
      ENFORCEMENT_REASON_CODES.COMMAND_GNU_TOOL_NOT_DECLARED,
      ["command.gnu_tool_declared"],
      evidence,
    );
  }
  if (
    command !== undefined &&
    forbiddenCommands.some((forbidden) => forbiddenCommandMatches(forbidden, command))
  ) {
    return finish(
      "deny",
      ENFORCEMENT_REASON_CODES.COMMAND_FORBIDDEN,
      ["command.forbidden_precedes_allowlist"],
      evidence,
    );
  }
  if (
    command !== undefined &&
    !allowedCommands.some((allowed) => commandMatches(allowed, command))
  ) {
    return finish(
      "deny",
      ENFORCEMENT_REASON_CODES.COMMAND_NOT_ALLOWED,
      ["command.exact_allowlist_match"],
      evidence,
    );
  }
  if (input.action !== "execute_command" && protectedPaths.length > 0) {
    return finish(
      "require_human",
      ENFORCEMENT_REASON_CODES.PATH_PROTECTED,
      ["path.protected_requires_human"],
      evidence,
    );
  }
  return finish("allow", ENFORCEMENT_REASON_CODES.ALLOWED, ["all_rules_passed"], evidence);
}
