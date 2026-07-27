import { describe, expect, it } from "vitest";

import {
  SpecificationDeliveryGuardError,
  assertSpecificationDelivery,
  classifyDeliveryMode,
  deliveryGuardReason,
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
  it("classifies planning without repository changes as answer_only", () => {
    expect(
      classifyDeliveryMode({
        normalized: normalized({
          constraints: ["Não implementar neste pedido"],
          objective: "Elaborar um planejamento de custos",
          requested_actions: ["pesquisar_referencias", "propor_layout"],
        }),
        originalMessage: "Estude o mercado e me traga um planejamento",
      }),
    ).toBe("answer_only");
  });

  it("classifies any explicit repository change and ambiguity as repository_change", () => {
    expect(
      classifyDeliveryMode({
        normalized: normalized({ objective: "Planejar e implementar o endpoint" }),
        originalMessage: "Planeje e implemente",
      }),
    ).toBe("repository_change");
    expect(
      classifyDeliveryMode({
        normalized: normalized(),
        originalMessage: "Cuide disso",
      }),
    ).toBe("repository_change");
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
