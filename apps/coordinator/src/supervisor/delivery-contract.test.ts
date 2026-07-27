import { describe, expect, it } from "vitest";

import {
  SpecificationDeliveryGuardError,
  assertSpecificationDelivery,
  classifyDeliveryMode,
  deliveryGuardReason,
  repositoryChangeVerbForms,
} from "./delivery-contract.js";

function normalized(overrides: Record<string, unknown> = {}) {
  return {
    constraints: [],
    context: [],
    objective: "Executar a demanda",
    requested_actions: [],
    ...overrides,
  };
}

describe("delivery contract", () => {
  function classify(originalMessage: string) {
    return classifyDeliveryMode({
      normalized: normalized({ objective: originalMessage }),
      originalMessage,
    });
  }

  it.each([
    "não implemente, apenas me traga um planejamento",
    "não altere nada, faça uma análise",
    "não edite arquivos, só recomende",
    "não modifique o código, só explique",
    "estude como se faz no mercado e me traga um planejamento pra implementar essa melhoria",
    "não implementar, só um planejamento",
    "não crie nada, apenas um relatório",
    "nao altere nada, faça uma análise",
    "sem implementar, só um plano",
    "pesquise o mercado e recomende uma abordagem",
  ])("classifies textual delivery without effective repository changes: %s", (message) => {
    expect(classify(message)).toBe("answer_only");
  });

  it.each([
    "implemente o endpoint",
    "corrija o bug",
    "crie a tabela no banco",
    "atualize o arquivo X",
    "ajuste o schema",
    "analise o custo e corrija o cálculo no código",
    "planeje e implemente o endpoint",
    "faça o de sempre",
  ])("classifies effective changes and ambiguity conservatively: %s", (message) => {
    expect(classify(message)).toBe("repository_change");
  });

  it("derives affirmative and negated behavior from every repository change verb form", () => {
    for (const verb of repositoryChangeVerbForms) {
      expect(classify(`não ${verb}, apenas faça um planejamento`), verb).toBe("answer_only");
      expect(classify(`${verb} o código`), verb).toBe("repository_change");
    }
  });

  it("is deterministic for repeated equivalent evaluations", () => {
    const message = "estude o mercado e traga um plano para implementar a melhoria";
    const decisions = Array.from({ length: 10 }, () => classify(message));
    expect(new Set(decisions)).toEqual(new Set(["answer_only"]));
  });

  it("rejects answer_only without a valid Task.origin", () => {
    expect(() => {
      assertSpecificationDelivery({
        deliveryMode: "answer_only",
        origin: "internal:api",
        repositoryPath: "/tmp/atlas",
      });
    }).toThrowError(
      new SpecificationDeliveryGuardError(deliveryGuardReason.answerOnlyDestinationRequired),
    );
  });

  it("rejects repository_change without an absolute configured repository path", () => {
    for (const repositoryPath of [null, "relative/repository"]) {
      expect(() => {
        assertSpecificationDelivery({
          deliveryMode: "repository_change",
          origin: "telegram:42:42",
          repositoryPath,
        });
      }).toThrowError(
        new SpecificationDeliveryGuardError(deliveryGuardReason.repositoryWritePathRequired),
      );
    }
  });
});
