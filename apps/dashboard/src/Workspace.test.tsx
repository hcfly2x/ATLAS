import type { DemandWorkspaceResponse } from "@atlas/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ApprovalDecisionClient } from "./approval-decision.js";
import { App } from "./App.js";
import { DemandWorkspaceReadError, type DemandWorkspaceClient } from "./demand-workspace.js";
import {
  DashboardCommandError,
  type CancelDashboardTaskClient,
  type PauseDashboardTaskClient,
  type ResumeDashboardTaskClient,
  type SetDashboardTaskPriorityClient,
} from "./task-commands.js";
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
  pauseTaskClient?: PauseDashboardTaskClient,
  resumeTaskClient?: ResumeDashboardTaskClient,
  setTaskPriorityClient?: SetDashboardTaskPriorityClient,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App
          {...(approvalDecisionClient === undefined ? {} : { approvalDecisionClient })}
          {...(cancelTaskClient === undefined ? {} : { cancelTaskClient })}
          {...(pauseTaskClient === undefined ? {} : { pauseTaskClient })}
          {...(resumeTaskClient === undefined ? {} : { resumeTaskClient })}
          {...(setTaskPriorityClient === undefined ? {} : { setTaskPriorityClient })}
          demandWorkspaceClient={client}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

function resolvedClient(data: DemandWorkspaceResponse): DemandWorkspaceClient {
  return () => Promise.resolve(data);
}

function workspaceInState(taskState: string, taskVersion = 7): DemandWorkspaceResponse {
  return {
    ...demandWorkspaceFixture,
    header: { ...demandWorkspaceFixture.header, taskState, taskVersion },
  };
}

function operationalResult(state: string, version = 8) {
  return {
    idempotentReplay: false,
    task: {
      id: demandWorkspaceFixture.header.taskId,
      pausedFromState: state === "PAUSED" ? ("QUEUED" as const) : null,
      priority: 10 as const,
      projectId: "atlas",
      state,
      version,
    },
  };
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
    expect(screen.queryByRole("button", { name: /pausar|retomar|prioridade/i })).toBeNull();
  });

  it.each([
    ["WAITING_APPROVAL", true, false, true],
    ["QUEUED", true, false, true],
    ["PAUSED", false, true, true],
    ["RUNNING", false, false, false],
  ] as const)(
    "shows only the operational controls valid for %s",
    async (state, pauseVisible, resumeVisible, priorityVisible) => {
      renderWorkspace(resolvedClient(workspaceInState(state)));
      await screen.findByRole("heading", { level: 1 });

      expect(screen.queryByRole("button", { name: "Pausar demanda" }) !== null).toBe(pauseVisible);
      expect(screen.queryByRole("button", { name: "Retomar demanda" }) !== null).toBe(
        resumeVisible,
      );
      expect(screen.queryByLabelText("Nova prioridade") !== null).toBe(priorityVisible);
    },
  );

  it("confirms pause with demand context and sends the current task version", async () => {
    const pauseClient = vi
      .fn<PauseDashboardTaskClient>()
      .mockResolvedValue(operationalResult("PAUSED"));
    renderWorkspace(resolvedClient(workspaceInState("QUEUED")), undefined, undefined, pauseClient);

    fireEvent.click(await screen.findByRole("button", { name: "Pausar demanda" }));
    expect(screen.getByRole("heading", { name: "Confirmar pausa" })).toBeInTheDocument();
    expect(screen.getAllByText(demandWorkspaceFixture.demand.objective)).not.toHaveLength(0);
    expect(screen.getByText(/sai temporariamente da fila ou decisão/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pausa" }));

    await waitFor(() => {
      expect(pauseClient).toHaveBeenCalledOnce();
      expect(pauseClient.mock.calls[0]?.[0]).toMatchObject({
        request: { taskVersion: 7 },
        taskId: demandWorkspaceFixture.header.taskId,
      });
      expect(pauseClient.mock.calls[0]?.[0].request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it("confirms resume and sends priority with governed versioned commands", async () => {
    const resumeClient = vi
      .fn<ResumeDashboardTaskClient>()
      .mockResolvedValue(operationalResult("QUEUED"));
    const priorityClient = vi
      .fn<SetDashboardTaskPriorityClient>()
      .mockResolvedValue(operationalResult("PAUSED"));
    renderWorkspace(
      resolvedClient(workspaceInState("PAUSED", 9)),
      undefined,
      undefined,
      undefined,
      resumeClient,
      priorityClient,
    );

    fireEvent.change(await screen.findByLabelText("Nova prioridade"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar prioridade" }));
    await waitFor(() => {
      expect(priorityClient.mock.calls[0]?.[0].request.priority).toBe(20);
      expect(priorityClient.mock.calls[0]?.[0].request.taskVersion).toBe(9);
      expect(priorityClient.mock.calls[0]?.[0].taskId).toBe(demandWorkspaceFixture.header.taskId);
    });

    fireEvent.click(screen.getByRole("button", { name: "Retomar demanda" }));
    expect(screen.getByText(/volta somente ao estado de origem/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar retomada" }));
    await waitFor(() => {
      expect(resumeClient.mock.calls[0]?.[0].request.taskVersion).toBe(9);
      expect(resumeClient.mock.calls[0]?.[0].taskId).toBe(demandWorkspaceFixture.header.taskId);
    });
  });

  it("refreshes all views and rotates the logical key after an operational conflict", async () => {
    const workspaceClient = vi
      .fn<DemandWorkspaceClient>()
      .mockResolvedValue(workspaceInState("QUEUED"));
    const pauseClient = vi
      .fn<PauseDashboardTaskClient>()
      .mockRejectedValue(new DashboardCommandError("conflict"));
    const { queryClient } = renderWorkspace(workspaceClient, undefined, undefined, pauseClient);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(await screen.findByRole("button", { name: "Pausar demanda" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pausa" }));
    expect(await screen.findAllByText(/As visões foram atualizadas/i)).not.toHaveLength(0);
    const firstKey = pauseClient.mock.calls[0]?.[0].request.idempotencyKey;
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mission-control"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects-board"] });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar pausa" }));
    await waitFor(() => {
      expect(pauseClient).toHaveBeenCalledTimes(2);
    });
    expect(pauseClient.mock.calls[1]?.[0].request.idempotencyKey).not.toBe(firstKey);
  });

  it("returns to login on 401 and never renders a remote error body", async () => {
    const workspaceClient = vi
      .fn<DemandWorkspaceClient>()
      .mockResolvedValueOnce(workspaceInState("QUEUED"))
      .mockRejectedValue(new DemandWorkspaceReadError("unauthorized"));
    const pauseClient = vi
      .fn<PauseDashboardTaskClient>()
      .mockRejectedValue(new DashboardCommandError("unauthorized"));
    renderWorkspace(workspaceClient, undefined, undefined, pauseClient);

    fireEvent.click(await screen.findByRole("button", { name: "Pausar demanda" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pausa" }));

    expect(await screen.findByLabelText("Credencial do dono")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("SECRET_REMOTE_ERROR_BODY");
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
    expect(screen.getAllByText(demandWorkspaceFixture.header.taskId)).not.toHaveLength(0);
    expect(
      screen.getByText(
        `${demandWorkspaceFixture.header.project.name} (${demandWorkspaceFixture.header.project.id})`,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(demandWorkspaceFixture.header.taskState)).not.toHaveLength(0);
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

  it("refetches the Workspace after conflict and starts a new logical attempt", async () => {
    const workspaceClient = vi
      .fn<DemandWorkspaceClient>()
      .mockResolvedValue(demandWorkspaceFixture);
    const cancelTaskClient = vi
      .fn<CancelDashboardTaskClient>()
      .mockRejectedValue(new DashboardCommandError("conflict"));
    renderWorkspace(workspaceClient, undefined, cancelTaskClient);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar demanda" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await screen.findByText(
      "A demanda mudou. O Workspace foi atualizado antes de tentar novamente.",
    );
    await waitFor(() => {
      expect(workspaceClient.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => {
      expect(cancelTaskClient).toHaveBeenCalledTimes(2);
    });
    expect(cancelTaskClient.mock.calls[0]?.[0].request.idempotencyKey).not.toBe(
      cancelTaskClient.mock.calls[1]?.[0].request.idempotencyKey,
    );
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
