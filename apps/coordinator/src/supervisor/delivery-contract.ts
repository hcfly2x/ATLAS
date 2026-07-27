import { isAbsolute } from "node:path";

import type { NormalizedDemand, SpecificationDeliveryMode } from "@atlas/shared";

import { telegramResultDestination } from "../telegram/origin.js";

const repositoryChangeLexicon = [
  { verbs: ["implementar", "implemente", "implementem"], relatedTerms: ["implementação"] },
  { verbs: ["alterar", "altere", "alterem"], relatedTerms: ["alteração", "alterações"] },
  { verbs: ["editar", "edite", "editem"], relatedTerms: ["edição", "edições"] },
  {
    verbs: ["modificar", "modifique", "modifiquem"],
    relatedTerms: ["modificação", "modificações"],
  },
  { verbs: ["criar", "crie", "criem"], relatedTerms: ["criação"] },
  { verbs: ["adicionar", "adicione", "adicionem"], relatedTerms: ["adição"] },
  { verbs: ["atualizar", "atualize", "atualizem"], relatedTerms: ["atualização"] },
  { verbs: ["ajustar", "ajuste", "ajustem"], relatedTerms: [] },
  { verbs: ["remover", "remova", "removam"], relatedTerms: ["remoção"] },
  { verbs: ["corrigir", "corrija", "corrijam"], relatedTerms: ["correção"] },
  { verbs: ["consertar", "conserte", "consertem"], relatedTerms: ["conserto"] },
  { verbs: ["refatorar", "refatore", "refatorem"], relatedTerms: ["refatoração"] },
  { verbs: ["migrar", "migre", "migrem"], relatedTerms: ["migração"] },
  { verbs: ["deletar", "delete", "deletem"], relatedTerms: ["deleção"] },
  {
    verbs: [
      "implement",
      "create",
      "add",
      "update",
      "fix",
      "delete",
      "remove",
      "refactor",
      "migrate",
    ],
    relatedTerms: [],
  },
  { verbs: ["commit"], relatedTerms: ["pull request", "pr"] },
] as const;

export const repositoryChangeVerbForms = repositoryChangeLexicon.flatMap(({ verbs }) => verbs);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const repositoryChangeTerms = [
  ...new Set(
    repositoryChangeLexicon.flatMap(({ relatedTerms, verbs }) => [...verbs, ...relatedTerms]),
  ),
]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegex)
  .join("|");
const repositoryChangePattern = new RegExp(`\\b(?:${repositoryChangeTerms})\\b`, "iu");
const negationBridge =
  "(?:(?:\\s+)(?:quero|queremos|precisa|precisamos|deve|devem|que|você|voce|o|a|os|as|um|uma|qualquer|nenhum|nenhuma|executar|fazer|realizar|aplicar)){0,5}";
const negatedRepositoryChangePattern = new RegExp(
  `\\b(?:não|nao|sem)${negationBridge}\\s+(?:${repositoryChangeTerms})\\b`,
  "giu",
);
const futureRepositoryObjectivePattern = new RegExp(
  `\\b(?:para|pra|visando)\\s+(?:(?:futuramente|depois|eventualmente)\\s+)*(?:${repositoryChangeTerms})\\b`,
  "giu",
);
const textualDeliverableObjectivePattern = new RegExp(
  `\\b(?:planejamento|plano|análise|analise|relatório|relatorio|estudo|recomendação|recomendacao)\\s+(?:para|pra|de|sobre)\\s+(?:(?:futura|futuro|futuramente)\\s+)*(?:${repositoryChangeTerms})\\b`,
  "giu",
);
const answerOnlyPattern =
  /\b(planej(?:ar|amento|e)|plano|an[aá]lis(?:ar|e|es|is)|estud(?:ar|e|o)|pesquis(?:ar|e|a)|relat[oó]rio|respost(?:a|er)|explic(?:ar|ação|acao)|explique|recomend(?:ar|ação|acao|e)|diagn[oó]stic(?:ar|o)|traga(?:-me)?|compare)\b/iu;

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
  const requestedWork = text
    .replace(negatedRepositoryChangePattern, "")
    .replace(textualDeliverableObjectivePattern, "")
    .replace(futureRepositoryObjectivePattern, "");
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
