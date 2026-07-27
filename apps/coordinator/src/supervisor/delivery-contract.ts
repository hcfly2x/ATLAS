import { isAbsolute } from "node:path";

import type { NormalizedDemand, SpecificationDeliveryMode } from "@atlas/shared";

import { telegramResultDestination } from "../telegram/origin.js";

const repositoryChangePattern =
  /\b(implement(?:ar|e|ation)?|alter(?:ar|e|ação)|edit(?:ar|e)?|modific(?:ar|ação)|corrig(?:ir|e)|consert(?:ar|e)|refactor(?:ar|ing)?|migr(?:ar|ação)|remov(?:er|a)|delet(?:ar|e)|criar\s+(?:um\s+)?(?:arquivo|código|codigo|endpoint|tabela|migração|migracao)|create|add|update|fix|delete|remove|commit|pull request|pr)\b/i;
const answerOnlyPattern =
  /\b(planej(?:ar|amento|e)|analis(?:ar|e|e|is)|estud(?:ar|e|o)|pesquis(?:ar|e|a)|relat[oó]rio|respost(?:a|er)|explic(?:ar|ação)|recomend(?:ar|ação)|diagn[oó]stic(?:ar|o)|traga(?:-me)?|compare)\b/i;
const negatedRepositoryChangePattern =
  /\b(?:não|nao|sem)\s+(?:executar\s+)?(?:a\s+)?(?:implement(?:ar|ação)|alter(?:ar|ação)|edit(?:ar)?|modific(?:ar|ação)|corrig(?:ir)|migr(?:ar|ação)|remov(?:er)|delet(?:ar)|create|add|update|fix|delete|remove)\b/gi;

export const deliveryGuardReason = {
  answerOnlyDestinationRequired: "ANSWER_ONLY_DESTINATION_REQUIRED",
  repositoryWritePathRequired: "REPOSITORY_WRITE_PATH_REQUIRED",
} as const;

export class SpecificationDeliveryGuardError extends Error {
  constructor(readonly code: (typeof deliveryGuardReason)[keyof typeof deliveryGuardReason]) {
    super(`Specification delivery guard rejected the contract: ${code}`);
    this.name = "SpecificationDeliveryGuardError";
  }
}

export function classifyDeliveryMode(input: {
  normalized: NormalizedDemand;
  originalMessage: string;
}): SpecificationDeliveryMode {
  const text = [
    input.originalMessage,
    input.normalized.objective,
    ...input.normalized.context,
    ...input.normalized.constraints,
    ...input.normalized.requested_actions,
  ].join("\n");
  const requestedWork = text.replace(negatedRepositoryChangePattern, "");
  if (repositoryChangePattern.test(requestedWork)) return "repository_change";
  if (answerOnlyPattern.test(requestedWork)) return "answer_only";
  return "repository_change";
}

export function assertSpecificationDelivery(input: {
  deliveryMode: SpecificationDeliveryMode;
  origin: string;
  repositoryPath: string | null;
}): void {
  if (input.deliveryMode === "answer_only") {
    if (telegramResultDestination(input.origin) === undefined) {
      throw new SpecificationDeliveryGuardError(deliveryGuardReason.answerOnlyDestinationRequired);
    }
    return;
  }
  if (input.repositoryPath === null || !isAbsolute(input.repositoryPath)) {
    throw new SpecificationDeliveryGuardError(deliveryGuardReason.repositoryWritePathRequired);
  }
}
