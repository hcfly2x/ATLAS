import type { MemoryItem } from "@atlas/shared";

export class ProjectMemoryIsolationError extends Error {
  constructor(readonly expectedProjectId: string, readonly receivedProjectId: string) {
    super(`Memory item belongs to ${receivedProjectId}, expected ${expectedProjectId}`);
    this.name = "ProjectMemoryIsolationError";
  }
}

export interface ProjectMemoryContext {
  readonly entries: readonly MemoryItem[];
  readonly text: string;
  readonly truncated: boolean;
}

const typePriority: Record<MemoryItem["type"], number> = {
  decision: 1,
  note: 2,
  summary: 3,
};

export function buildProjectMemoryContext(input: {
  readonly items: readonly MemoryItem[];
  readonly maxChars?: number;
  readonly maxItems?: number;
  readonly projectId: string;
  readonly taskId?: string;
}): ProjectMemoryContext {
  const maxChars = input.maxChars ?? 12_000;
  const maxItems = input.maxItems ?? 20;
  if (maxChars < 1 || maxItems < 1) throw new RangeError("Context limits must be positive");
  for (const item of input.items) {
    if (item.projectId !== input.projectId) {
      throw new ProjectMemoryIsolationError(input.projectId, item.projectId);
    }
  }
  const ordered = [...input.items].sort((left, right) => {
    const leftTask = input.taskId !== undefined && left.taskId === input.taskId ? 0 : 1;
    const rightTask = input.taskId !== undefined && right.taskId === input.taskId ? 0 : 1;
    return (
      leftTask - rightTask ||
      typePriority[left.type] - typePriority[right.type] ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });
  const entries: MemoryItem[] = [];
  const lines: string[] = [];
  let used = 0;
  let truncated = ordered.length > maxItems;
  for (const item of ordered.slice(0, maxItems)) {
    const metadata = [
      item.type,
      item.taskId === undefined ? undefined : `task=${item.taskId}`,
      item.agentId === undefined ? undefined : `agent=${item.agentId}`,
    ]
      .filter((value): value is string => value !== undefined)
      .join(" ");
    const prefix = `[${metadata}] `;
    const remaining = maxChars - used - prefix.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const content =
      item.content.length <= remaining ? item.content : `${item.content.slice(0, remaining - 1)}…`;
    lines.push(`${prefix}${content}`);
    entries.push(content === item.content ? item : { ...item, content });
    used += prefix.length + content.length + 1;
    if (content !== item.content) {
      truncated = true;
      break;
    }
  }
  return { entries, text: lines.join("\n"), truncated };
}
