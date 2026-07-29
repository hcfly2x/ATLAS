import type { MissionControlResponse } from "@atlas/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";
import type { MissionControlClient } from "./mission-control.js";
import {
  emptyMissionControlFixture,
  indeterminateMissionControlFixture,
  missionControlFixture,
} from "./test/fixtures.js";

function renderDashboard(client: MissionControlClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <App initialToken="synthetic-dashboard-token" missionControlClient={client} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function resolvedClient(data: MissionControlResponse): MissionControlClient {
  return () => Promise.resolve(data);
}

describe("Mission Control UI", () => {
  it("renders a loading state while the read model is pending", () => {
    renderDashboard(() => new Promise<MissionControlResponse>(() => undefined));

    expect(screen.getByText("Sincronizando sinais do Mission Control…")).toBeInTheDocument();
  });

  it("renders every workflow block from the validated read model", async () => {
    renderDashboard(resolvedClient(missionControlFixture));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Entrega terminal precisa de atenção",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Precisa de mim" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Em execução" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Parado ou bloqueado" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Concluído recentemente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Riscos & Proatividade" })).toBeInTheDocument();
    expect(screen.getByText("Aprovação pendente")).toBeInTheDocument();
    expect(screen.getAllByText("ETA indeterminado").length).toBeGreaterThan(0);
  });

  it("renders explicit empty states without inventing work", async () => {
    renderDashboard(resolvedClient(emptyMissionControlFixture));

    expect(
      await screen.findByText("Nenhuma decisão humana está aguardando você."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nenhum trabalho está em execução agora.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum trabalho está parado ou bloqueado.")).toBeInTheDocument();
    expect(
      screen.getByText("Nenhuma conclusão foi registrada na janela recente."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nenhum risco foi derivado dos sinais disponíveis."),
    ).toBeInTheDocument();
  });

  it("keeps unavailable blocks independent and visibly indeterminate", async () => {
    renderDashboard(resolvedClient(indeterminateMissionControlFixture));

    expect(await screen.findAllByText("Sinal indeterminado")).toHaveLength(5);
    expect(
      screen.getByText("Os sinais disponíveis não sustentam uma recomendação."),
    ).toBeInTheDocument();
  });

  it("renders a safe page-level error without inferred values", async () => {
    renderDashboard(() => Promise.reject(new Error("synthetic transport failure")));

    expect(
      await screen.findByRole("heading", { name: "Mission Control está indeterminado" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nenhum progresso, custo ou prioridade foi inferido/),
    ).toBeInTheDocument();
  });

  it("never renders extra sensitive properties from a synthetic response", async () => {
    const unsafeFixture = {
      ...missionControlFixture,
      messageText: "SECRET_MESSAGE_TEXT",
      originalMessage: "SECRET_ORIGINAL_MESSAGE",
      risks: {
        ...missionControlFixture.risks,
        items: missionControlFixture.risks.items.map((item) => ({
          ...item,
          payload: "SECRET_RAW_PAYLOAD",
        })),
      },
    } as unknown as MissionControlResponse;
    renderDashboard(resolvedClient(unsafeFixture));

    await screen.findByText("Riscos & Proatividade");
    expect(document.body).not.toHaveTextContent("SECRET_MESSAGE_TEXT");
    expect(document.body).not.toHaveTextContent("SECRET_ORIGINAL_MESSAGE");
    expect(document.body).not.toHaveTextContent("SECRET_RAW_PAYLOAD");
  });

  it("has no accessibility violations in the populated Home", async () => {
    const { container } = renderDashboard(resolvedClient(missionControlFixture));
    await screen.findByText("Riscos & Proatividade");

    const audit = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(audit.violations).toEqual([]);
  });
});
