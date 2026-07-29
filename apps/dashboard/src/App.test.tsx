import type { MissionControlResponse } from "@atlas/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import type { MissionControlClient } from "./mission-control.js";
import { DashboardReadError } from "./mission-control.js";
import type { DashboardSessionClient } from "./session.js";
import {
  emptyMissionControlFixture,
  indeterminateMissionControlFixture,
  missionControlFixture,
} from "./test/fixtures.js";

function renderDashboard(client: MissionControlClient, sessionClient?: DashboardSessionClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <App
          missionControlClient={client}
          {...(sessionClient === undefined ? {} : { sessionClient })}
        />
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

  it("creates a session once, clears the credential and retries the read without a URL token", async () => {
    let authenticated = false;
    const client: MissionControlClient = () =>
      authenticated
        ? Promise.resolve(missionControlFixture)
        : Promise.reject(new DashboardReadError("unauthorized"));
    const sessionClient = vi.fn<DashboardSessionClient>(({ credential }) => {
      expect(credential).toBe("synthetic-owner-credential");
      authenticated = true;
      return Promise.resolve();
    });
    globalThis.history.replaceState(null, "", "/#token=legacy-secret");
    renderDashboard(client, sessionClient);

    const input = await screen.findByLabelText("Credencial do dono");
    fireEvent.change(input, { target: { value: "synthetic-owner-credential" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir Mission Control" }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Entrega terminal precisa de atenção",
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(globalThis.location.hash).toBe("");
    });
    expect(sessionClient).toHaveBeenCalledOnce();
    expect(document.body).not.toHaveTextContent("synthetic-owner-credential");
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
