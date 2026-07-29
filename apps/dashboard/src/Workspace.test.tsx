import type { DemandWorkspaceResponse } from "@atlas/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ApprovalDecisionClient } from "./approval-decision.js";
import { App } from "./App.js";
import { DemandWorkspaceReadError, type DemandWorkspaceClient } from "./demand-workspace.js";
import type { CancelDashboardTaskClient } from "./task-commands.js";
import {
  demandWorkspaceFixture,
  emptyDemandWorkspaceFixture,
  indeterminateDemandWorkspaceFixture,
} from "./test/fixtures.js";

const route = `/demand/${demandWorkspaceFixture.header.taskId}`;

function renderWorkspace(
  client: DemandWorkspaceClient,
  approvalDecisionClient?: ApprovalDecisionClient,
  cancelTaskClient?: CancelDashboardTaskClient,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App
          {...(approvalDecisionClient === undefined ? {} : { approvalDecisionClient })}
          {...(cancelTaskClient === undefined ? {} : { cancelTaskClient })}
          demandWorkspaceClient={client}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function resolvedClient(data: DemandWorkspaceResponse): DemandWorkspaceClient {
  return () => Promise.resolve(data);
}

describe("Demand Workspace UI", () => {
  it("renders loading while the demand read-model is pending", () => {
    renderWorkspace(() => new Promise<DemandWorkspaceResponse>(() => undefined));

    expect(screen.getByText("Carregando a projeção segura da demanda…")).toBeInTheDocument();
  });

  it("renders the workflow sections and the governed cancellation control", async () => {
    renderWorkspace(resolvedClient(demandWorkspaceFixture));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Construir o Workspace read-only da demanda",
      }),
    ).toBeInTheDocument();
    for (const heading of [
      "Visão geral",
      "Plano e tarefas",
      "Aprovações",
      "QA",
      "Entregáveis",
      "Linha do tempo",
      "Custos",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText("pnpm, git")).toBeInTheDocument();
    expect(screen.getByText(/5 arquivo\(s\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar demanda" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pausar|editar/i })).toBeNull();
  });

  it("renders explicit empty states without inventing records", async () => {
    renderWorkspace(resolvedClient(emptyDemandWorkspaceFixture));

    expect(await screen.findByText("Nenhuma execução foi registrada.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma aprovação foi registrada.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma revisão de QA foi registrada.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum evento seguro foi registrado.")).toBeInTheDocument();
  });

  it("keeps unavailable signals visibly indeterminate", async () => {
    renderWorkspace(resolvedClient(indeterminateDemandWorkspaceFixture));

    expect(await screen.findAllByText("indeterminado")).not.toHaveLength(0);
    expect(screen.getAllByText("Indeterminado.")).toHaveLength(2);
  });

  it("renders a specific safe not-found state", async () => {
    renderWorkspace(() => Promise.reject(new DemandWorkspaceReadError("not_found")));

    expect(
      await screen.findByRole("heading", { name: "Demanda não encontrada" }),
    ).toBeInTheDocument();
  });

  it("renders a safe contract error and never leaks synthetic raw fields", async () => {
    const forbiddenValues = ["SECRET_MESSAGE_TEXT", "SECRET_PAYLOAD", "SECRET_PROMPT"] as const;
    renderWorkspace(() => Promise.reject(new DemandWorkspaceReadError("invalid_contract")));

    expect(
      await screen.findByRole("heading", { name: "Demanda indeterminada" }),
    ).toBeInTheDocument();
    for (const value of forbiddenValues) {
      expect(document.body).not.toHaveTextContent(value);
    }
  });

  it("replays safe timeline events step by step", async () => {
    renderWorkspace(resolvedClient(demandWorkspaceFixture));

    expect(await screen.findByRole("heading", { name: "task.created" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próximo evento" }));
    expect(screen.getByRole("heading", { name: "execution.completed" })).toBeInTheDocument();
    expect(screen.getByText("Etapa 2 de 2")).toBeInTheDocument();
  });

  it("shows context before a human decision and submits through the governed client", async () => {
    const approvalDecisionClient = vi.fn<ApprovalDecisionClient>().mockResolvedValue({
      approvalId: "11111111-1111-4111-8111-111111111111",
      decision: "request_change",
      idempotentReplay: false,
      status: "REJECTED",
      task: { id: demandWorkspaceFixture.header.taskId, state: "SPECIFYING", version: 9 },
    });
    const baseApproval = demandWorkspaceFixture.approvals[0];
    if (baseApproval === undefined) throw new Error("approval fixture missing");
    const actionable: DemandWorkspaceResponse = {
      ...demandWorkspaceFixture,
      approvals: [
        {
          ...baseApproval,
          approvalId: "11111111-1111-4111-8111-111111111111",
          canDecide: true,
          status: "PENDING",
        },
      ],
    };
    renderWorkspace(resolvedClient(actionable), approvalDecisionClient);

    fireEvent.click(await screen.findByRole("button", { name: "Pedir alteração" }));
    expect(screen.getByText("A decisão pode avançar ou devolver a demanda.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ajuste os critérios." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar decisão" }));

    await waitFor(() => {
      expect(approvalDecisionClient).toHaveBeenCalled();
      const submitted = approvalDecisionClient.mock.calls[0]?.[0];
      expect(submitted?.approvalId).toBe("11111111-1111-4111-8111-111111111111");
      expect(submitted?.request.comment).toBe("Ajuste os critérios.");
      expect(submitted?.request.decision).toBe("request_change");
    });
  });

  it("hides request_change for pre-execution approvals without changing approve or reject", async () => {
    const baseApproval = demandWorkspaceFixture.approvals[0];
    if (baseApproval === undefined) throw new Error("approval fixture missing");
    renderWorkspace(
      resolvedClient({
        ...demandWorkspaceFixture,
        approvals: [
          {
            ...baseApproval,
            approvalId: "11111111-1111-4111-8111-111111111112",
            canDecide: true,
            status: "PENDING",
            type: "PRE_EXECUTION",
          },
        ],
      }),
    );

    expect(await screen.findByRole("button", { name: "Aprovar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pedir alteração" })).toBeNull();
  });

  it("confirms cancellation with the current task version through the governed client", async () => {
    const cancelTaskClient = vi.fn<CancelDashboardTaskClient>().mockResolvedValue({
      idempotentReplay: false,
      mode: "cooperative",
      task: {
        id: demandWorkspaceFixture.header.taskId,
        projectId: "atlas",
        state: "CANCEL_REQUESTED",
        version: 8,
      },
    });
    renderWorkspace(resolvedClient(demandWorkspaceFixture), undefined, cancelTaskClient);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar demanda" }));
    expect(screen.getByText(/cancelamento será cooperativo/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motivo (opcional)"), {
      target: { value: "Não é mais necessário." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));

    await waitFor(() => {
      expect(cancelTaskClient).toHaveBeenCalledOnce();
      expect(cancelTaskClient.mock.calls[0]?.[0]).toMatchObject({
        request: {
          reason: "Não é mais necessário.",
          taskVersion: demandWorkspaceFixture.header.taskVersion,
        },
        taskId: demandWorkspaceFixture.header.taskId,
      });
    });
  });

  it("has no accessibility violations in the populated Workspace", async () => {
    const { container } = renderWorkspace(resolvedClient(demandWorkspaceFixture));
    await screen.findByRole("heading", { name: "Linha do tempo" });

    const audit = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(audit.violations).toEqual([]);
  });
});
