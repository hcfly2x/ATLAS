import type { ApprovalDecisionRequest, DemandWorkspaceResponse } from "@atlas/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";

import { ApprovalDecisionError, type ApprovalDecisionClient } from "./approval-decision.js";
import {
  DashboardCommandError,
  type CancelDashboardTaskClient,
  type PauseDashboardTaskClient,
  type ResumeDashboardTaskClient,
  type SetDashboardTaskPriorityClient,
} from "./task-commands.js";

type WorkspaceValue = string;

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "USD",
  style: "currency",
});

const taskStateLabels: Record<string, string> = {
  PAUSED: "Pausada",
  QUEUED: "Na fila",
  WAITING_APPROVAL: "Aguardando aprovação",
};

const pauseStates = new Set(["WAITING_APPROVAL", "QUEUED"]);
const priorityStates = new Set(["WAITING_APPROVAL", "QUEUED", "PAUSED"]);

function formatDate(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function DisplayValue({ value }: { readonly value: WorkspaceValue | number }) {
  return (
    <span className={value === "indeterminado" ? "value-indeterminate" : undefined}>{value}</span>
  );
}

function WorkspaceSection({
  children,
  eyebrow,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={id} className="workspace-section">
      <header>
        <p className="kicker">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function EmptySection({ children }: { readonly children: ReactNode }) {
  return <p className="workspace-empty">{children}</p>;
}

function StringList({
  empty,
  items,
}: {
  readonly empty: string;
  readonly items: readonly string[] | "indeterminado";
}) {
  if (items === "indeterminado") return <EmptySection>Indeterminado.</EmptySection>;
  if (items.length === 0) return <EmptySection>{empty}</EmptySection>;
  return (
    <ol className="workspace-list">
      {items.map((item, index) => (
        <li key={`${String(index)}:${item}`}>{item}</li>
      ))}
    </ol>
  );
}

function DemandHeader({ data }: { readonly data: DemandWorkspaceResponse }) {
  const { header } = data;
  return (
    <header className="workspace-hero">
      <div className="workspace-hero-copy">
        <Link className="back-link" to="/">
          <span aria-hidden="true">←</span> Mission Control
        </Link>
        <p className="kicker">Workspace da demanda · operação governada</p>
        <h1>{data.demand.objective}</h1>
        <p className="workspace-reference">
          {header.project.name} · <span className="mono">{header.taskId}</span>
        </p>
      </div>
      <dl className="workspace-facts">
        <div>
          <dt>Estado da demanda</dt>
          <dd>{taskStateLabels[header.taskState] ?? header.taskState}</dd>
        </div>
        <div>
          <dt>Estado da execução</dt>
          <dd>
            <DisplayValue value={header.executionState} />
          </dd>
        </div>
        <div>
          <dt>Risco</dt>
          <dd>
            <DisplayValue value={header.risk} />
          </dd>
        </div>
        <div>
          <dt>Autonomia</dt>
          <dd>
            <DisplayValue value={header.autonomyLevel} />
          </dd>
        </div>
        <div>
          <dt>Modo de entrega</dt>
          <dd>
            <DisplayValue value={header.deliveryMode} />
          </dd>
        </div>
        <div>
          <dt>Origem</dt>
          <dd>
            <DisplayValue value={header.originChannel} />
          </dd>
        </div>
        <div>
          <dt>Custo estimado</dt>
          <dd>
            {data.cost.estimatedUsd === "indeterminado"
              ? "indeterminado"
              : moneyFormatter.format(data.cost.estimatedUsd)}
          </dd>
        </div>
        <div>
          <dt>Atualizada</dt>
          <dd>{formatDate(header.updatedAt)}</dd>
        </div>
      </dl>
    </header>
  );
}

type OperationalAction = "pause" | "resume";

function TaskOperations({
  data,
  pauseClient,
  priorityClient,
  resumeClient,
}: {
  readonly data: DemandWorkspaceResponse;
  readonly pauseClient: PauseDashboardTaskClient;
  readonly priorityClient: SetDashboardTaskPriorityClient;
  readonly resumeClient: ResumeDashboardTaskClient;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keys = useRef<Record<OperationalAction | "priority", string>>({
    pause: crypto.randomUUID(),
    priority: crypto.randomUUID(),
    resume: crypto.randomUUID(),
  });
  const [action, setAction] = useState<OperationalAction>();
  const [priority, setPriority] = useState<0 | 10 | 20>();
  const [message, setMessage] = useState<string>();

  const invalidateViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["demand-workspace", data.header.taskId] }),
      queryClient.invalidateQueries({ queryKey: ["mission-control"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-board"] }),
    ]);
  };

  const handleError = async (operation: OperationalAction | "priority", error: unknown) => {
    if (error instanceof DashboardCommandError && error.code === "conflict") {
      keys.current[operation] = crypto.randomUUID();
      setMessage("A demanda mudou. As visões foram atualizadas antes de uma nova tentativa.");
      await invalidateViews();
      return;
    }
    if (error instanceof DashboardCommandError && error.code === "unauthorized") {
      setAction(undefined);
      await invalidateViews();
      return;
    }
    setMessage("A operação não foi aplicada.");
  };

  const pauseMutation = useMutation({
    mutationFn: pauseClient,
    onError: (error) => handleError("pause", error),
    onSuccess: async () => {
      setAction(undefined);
      setMessage("Demanda pausada.");
      await invalidateViews();
    },
  });
  const resumeMutation = useMutation({
    mutationFn: resumeClient,
    onError: (error) => handleError("resume", error),
    onSuccess: async () => {
      setAction(undefined);
      setMessage("Demanda retomada.");
      await invalidateViews();
    },
  });
  const priorityMutation = useMutation({
    mutationFn: priorityClient,
    onError: (error) => handleError("priority", error),
    onSuccess: async () => {
      const labels = { 0: "normal", 10: "alta", 20: "urgente" } as const;
      setMessage(
        `Prioridade atualizada para ${priority === undefined ? "o nível escolhido" : labels[priority]}.`,
      );
      setPriority(undefined);
      keys.current.priority = crypto.randomUUID();
      await invalidateViews();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (action === undefined) {
      if (dialog?.open === true) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      return;
    }
    if (dialog?.open === false) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  }, [action]);

  const canPause = pauseStates.has(data.header.taskState);
  const canResume = data.header.taskState === "PAUSED";
  const canPrioritize = priorityStates.has(data.header.taskState);
  if (!canPause && !canResume && !canPrioritize) return null;

  function submitAction(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action === "pause" && !pauseMutation.isPending) {
      pauseMutation.mutate({
        request: { idempotencyKey: keys.current.pause, taskVersion: data.header.taskVersion },
        taskId: data.header.taskId,
      });
    }
    if (action === "resume" && !resumeMutation.isPending) {
      resumeMutation.mutate({
        request: { idempotencyKey: keys.current.resume, taskVersion: data.header.taskVersion },
        taskId: data.header.taskId,
      });
    }
  }

  return (
    <section aria-labelledby="task-operations-title" className="workspace-command task-operations">
      <div>
        <p className="kicker">Operação segura</p>
        <h2 id="task-operations-title">Fila e prioridade</h2>
        <p>O backend valida o estado e continua sendo a autoridade sobre cada mudança.</p>
        <div className="task-operation-actions">
          {canPause ? (
            <button
              onClick={() => {
                setMessage(undefined);
                setAction("pause");
              }}
              type="button"
            >
              Pausar demanda
            </button>
          ) : null}
          {canResume ? (
            <button
              onClick={() => {
                setMessage(undefined);
                setAction("resume");
              }}
              type="button"
            >
              Retomar demanda
            </button>
          ) : null}
        </div>
      </div>
      {canPrioritize ? (
        <form
          className="priority-command"
          onSubmit={(event) => {
            event.preventDefault();
            if (priority === undefined || priorityMutation.isPending) return;
            priorityMutation.mutate({
              request: {
                idempotencyKey: keys.current.priority,
                priority,
                taskVersion: data.header.taskVersion,
              },
              taskId: data.header.taskId,
            });
          }}
        >
          <label>
            Nova prioridade
            <select
              disabled={priorityMutation.isPending}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setPriority(value === 0 || value === 10 || value === 20 ? value : undefined);
                setMessage(undefined);
              }}
              value={priority ?? ""}
            >
              <option value="">Escolha um nível</option>
              <option value="0">Normal</option>
              <option value="10">Alta</option>
              <option value="20">Urgente</option>
            </select>
          </label>
          <button disabled={priority === undefined || priorityMutation.isPending} type="submit">
            {priorityMutation.isPending ? "Atualizando…" : "Atualizar prioridade"}
          </button>
        </form>
      ) : null}
      {message === undefined ? null : (
        <p
          aria-live="polite"
          className="operation-message"
          role={message.includes("não foi") ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      <dialog
        aria-labelledby="operational-confirm-title"
        className="approval-dialog"
        onCancel={() => {
          setAction(undefined);
        }}
        ref={dialogRef}
      >
        <form onSubmit={submitAction}>
          <p className="kicker">Confirmação humana</p>
          <h3 id="operational-confirm-title">
            {action === "pause" ? "Confirmar pausa" : "Confirmar retomada"}
          </h3>
          <dl>
            <div>
              <dt>Demanda</dt>
              <dd>{data.demand.objective}</dd>
            </div>
            <div>
              <dt>Projeto</dt>
              <dd>{data.header.project.name}</dd>
            </div>
            <div>
              <dt>Estado atual</dt>
              <dd>{taskStateLabels[data.header.taskState] ?? data.header.taskState}</dd>
            </div>
            <div>
              <dt>O que acontece</dt>
              <dd>
                {action === "pause"
                  ? "A demanda sai temporariamente da fila ou decisão. Ela não é cancelada e nenhuma execução em curso é interrompida."
                  : "A demanda volta somente ao estado de origem preservado e validado pelo backend."}
              </dd>
            </div>
          </dl>
          {pauseMutation.isError || resumeMutation.isError ? (
            <p role="alert">{message ?? "A operação não foi aplicada."}</p>
          ) : null}
          <div className="approval-actions">
            <button
              onClick={() => {
                setAction(undefined);
              }}
              type="button"
            >
              Voltar
            </button>
            <button disabled={pauseMutation.isPending || resumeMutation.isPending} type="submit">
              {pauseMutation.isPending || resumeMutation.isPending
                ? "Registrando…"
                : action === "pause"
                  ? "Confirmar pausa"
                  : "Confirmar retomada"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function CancelTask({
  client,
  data,
}: {
  readonly client: CancelDashboardTaskClient;
  readonly data: DemandWorkspaceResponse;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  idempotencyKey.current ??= crypto.randomUUID();
  const immediateStates = new Set([
    "NEW",
    "NORMALIZING",
    "ROUTING",
    "SPECIFYING",
    "WAITING_APPROVAL",
    "QUEUED",
    "FAILED",
  ]);
  const disabledStates = new Set(["CANCEL_REQUESTED", "COMPLETED", "CANCELLED"]);
  const mode = immediateStates.has(data.header.taskState) ? "imediato" : "cooperativo";
  const disabled = disabledStates.has(data.header.taskState);
  const mutation = useMutation({
    mutationFn: client,
    onError: async (error) => {
      if (error instanceof DashboardCommandError && error.code === "conflict") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["demand-workspace", data.header.taskId] }),
          queryClient.invalidateQueries({ queryKey: ["mission-control"] }),
          queryClient.invalidateQueries({ queryKey: ["projects-board"] }),
        ]);
        idempotencyKey.current = crypto.randomUUID();
      }
    },
    onSuccess: async () => {
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["demand-workspace", data.header.taskId] }),
        queryClient.invalidateQueries({ queryKey: ["mission-control"] }),
        queryClient.invalidateQueries({ queryKey: ["projects-board"] }),
      ]);
    },
  });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open) {
      if (dialog?.open === false) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
    } else if (dialog?.open === true) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestIdempotencyKey = idempotencyKey.current;
    if (mutation.isPending || requestIdempotencyKey === null) return;
    mutation.mutate({
      request: {
        idempotencyKey: requestIdempotencyKey,
        ...(reason.trim().length === 0 ? {} : { reason: reason.trim() }),
        taskVersion: data.header.taskVersion,
      },
      taskId: data.header.taskId,
    });
  }

  return (
    <section aria-labelledby="cancel-task-title" className="workspace-command">
      <div>
        <p className="kicker">Controle da demanda</p>
        <h2 id="cancel-task-title">Cancelamento</h2>
        <p>
          {disabled
            ? `Nenhuma ação disponível no estado ${data.header.taskState}.`
            : `No estado atual, o cancelamento será ${mode}.`}
        </p>
      </div>
      <button
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Cancelar demanda
      </button>
      <dialog
        aria-labelledby="cancel-confirm-title"
        className="approval-dialog"
        onCancel={() => {
          setOpen(false);
          mutation.reset();
        }}
        ref={dialogRef}
      >
        <form onSubmit={submit}>
          <p className="kicker">Confirmação humana</p>
          <h3 id="cancel-confirm-title">Confirmar cancelamento</h3>
          <dl className="detail-list">
            <div>
              <dt>Task</dt>
              <dd>{data.header.taskId}</dd>
            </div>
            <div>
              <dt>Projeto</dt>
              <dd>
                {data.header.project.name} ({data.header.project.id})
              </dd>
            </div>
            <div>
              <dt>Estado atual</dt>
              <dd>{data.header.taskState}</dd>
            </div>
            <div>
              <dt>Modalidade</dt>
              <dd>{mode}</dd>
            </div>
          </dl>
          <label>
            Motivo (opcional)
            <textarea
              maxLength={1_000}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                if (mutation.isError) {
                  idempotencyKey.current = crypto.randomUUID();
                  mutation.reset();
                }
              }}
              value={reason}
            />
          </label>
          {mutation.isError ? (
            <p role="alert">
              {mutation.error instanceof DashboardCommandError && mutation.error.code === "conflict"
                ? "A demanda mudou. O Workspace foi atualizado antes de tentar novamente."
                : "O cancelamento não foi aplicado."}
            </p>
          ) : null}
          <div className="approval-actions">
            <button
              onClick={() => {
                setOpen(false);
                mutation.reset();
              }}
              type="button"
            >
              Voltar
            </button>
            <button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Registrando…" : "Confirmar cancelamento"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function Overview({ data }: { readonly data: DemandWorkspaceResponse }) {
  return (
    <WorkspaceSection eyebrow="Contexto" id="overview-title" title="Visão geral">
      <dl className="overview-grid">
        <div>
          <dt>Objetivo</dt>
          <dd>
            <DisplayValue value={data.demand.objective} />
          </dd>
        </div>
        <div>
          <dt>Versão da especificação</dt>
          <dd>
            <DisplayValue value={data.plan.specificationVersion} />
          </dd>
        </div>
        <div>
          <dt>Memórias relacionadas</dt>
          <dd>{data.memory.total}</dd>
        </div>
        <div>
          <dt>Distribuição da memória</dt>
          <dd>
            {data.memory.byType.DECISION} decisões · {data.memory.byType.SUMMARY} resumos ·{" "}
            {data.memory.byType.NOTE} notas
          </dd>
        </div>
      </dl>
    </WorkspaceSection>
  );
}

function Plan({ data }: { readonly data: DemandWorkspaceResponse }) {
  return (
    <WorkspaceSection eyebrow="Plano seguro" id="plan-title" title="Plano e tarefas">
      <div className="workspace-split">
        <div>
          <h3>Estratégia de implementação</h3>
          <StringList
            empty="Nenhuma etapa de estratégia foi registrada."
            items={data.plan.implementationStrategy}
          />
        </div>
        <div>
          <h3>Critérios de aceite</h3>
          <StringList
            empty="Nenhum critério de aceite foi registrado."
            items={data.plan.acceptanceCriteria}
          />
        </div>
      </div>
      <h3>Execuções</h3>
      {data.executions.length === 0 ? (
        <EmptySection>Nenhuma execução foi registrada.</EmptySection>
      ) : (
        <div className="execution-list">
          {data.executions.map((execution) => (
            <article className="execution-card" key={execution.executionId}>
              <header>
                <strong>Execução {execution.attempt}</strong>
                <span>{execution.status}</span>
              </header>
              <dl>
                <div>
                  <dt>Executáveis</dt>
                  <dd>
                    {execution.executables === "indeterminado"
                      ? "indeterminado"
                      : execution.executables.join(", ") || "Nenhum"}
                  </dd>
                </div>
                <div>
                  <dt>Duração</dt>
                  <dd>
                    {execution.durationMs === "indeterminado"
                      ? "indeterminado"
                      : `${String(execution.durationMs)} ms`}
                  </dd>
                </div>
                <div>
                  <dt>Resultado</dt>
                  <dd>
                    <DisplayValue value={execution.resultStatus} />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </WorkspaceSection>
  );
}

function Approvals({
  approvals,
  client,
  taskId,
}: {
  readonly approvals: DemandWorkspaceResponse["approvals"];
  readonly client: ApprovalDecisionClient;
  readonly taskId: string;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<{
    readonly approval: DemandWorkspaceResponse["approvals"][number];
    readonly decision: ApprovalDecisionRequest["decision"];
  }>();
  const [comment, setComment] = useState("");
  const mutation = useMutation({
    mutationFn: client,
    onSuccess: async () => {
      setSelected(undefined);
      setComment("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["demand-workspace", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["mission-control"] }),
      ]);
    },
  });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected === undefined) {
      if (dialog?.open === true) dialog.close();
      return;
    }
    if (dialog?.open === false) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
  }, [selected]);

  function confirm(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === undefined || mutation.isPending) return;
    mutation.mutate({
      approvalId: selected.approval.approvalId,
      request: {
        ...(comment.trim().length === 0 ? {} : { comment: comment.trim() }),
        decision: selected.decision,
        idempotencyKey: crypto.randomUUID(),
        targetVersion:
          selected.approval.targetVersion === "indeterminado" ? 0 : selected.approval.targetVersion,
        taskVersion: selected.approval.taskVersion,
      },
    });
  }

  return (
    <WorkspaceSection eyebrow="Governança" id="approvals-title" title="Aprovações">
      {approvals.length === 0 ? (
        <EmptySection>Nenhuma aprovação foi registrada.</EmptySection>
      ) : (
        <div className="record-list">
          {approvals.map((approval) => (
            <article className="record-row" key={approval.approvalId}>
              <div>
                <strong>{approval.type}</strong>
                <span>
                  {approval.actor} · versão <DisplayValue value={approval.targetVersion} />
                </span>
              </div>
              <div>
                <span className="state-pill">{approval.status}</span>
                <time dateTime={approval.occurredAt}>{formatDate(approval.occurredAt)}</time>
                {approval.canDecide ? (
                  <div
                    aria-label={`Decidir aprovação ${approval.approvalId}`}
                    className="approval-actions"
                  >
                    <button
                      onClick={() => {
                        setSelected({ approval, decision: "approve" });
                      }}
                      type="button"
                    >
                      Aprovar
                    </button>
                    {approval.type === "RESULT" && approval.targetType === "EXECUTION_RESULT" ? (
                      <button
                        onClick={() => {
                          setSelected({ approval, decision: "request_change" });
                        }}
                        type="button"
                      >
                        Pedir alteração
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        setSelected({ approval, decision: "reject" });
                      }}
                      type="button"
                    >
                      Rejeitar
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {selected === undefined ? null : (
        <dialog
          aria-labelledby="approval-confirm-title"
          className="approval-dialog"
          onCancel={() => {
            setSelected(undefined);
            mutation.reset();
          }}
          ref={dialogRef}
        >
          <form onSubmit={confirm}>
            <p className="kicker">Confirmação humana</p>
            <h3 id="approval-confirm-title">Confirmar decisão</h3>
            <dl>
              <div>
                <dt>O quê</dt>
                <dd>{selected.approval.type}</dd>
              </div>
              <div>
                <dt>Por quê</dt>
                <dd>Aprovação humana pendente no estado canônico.</dd>
              </div>
              <div>
                <dt>Impacto</dt>
                <dd>A decisão pode avançar ou devolver a demanda.</dd>
              </div>
              <div>
                <dt>Evidência</dt>
                <dd>
                  {selected.approval.targetType} v{String(selected.approval.targetVersion)}
                </dd>
              </div>
              <div>
                <dt>Reversibilidade</dt>
                <dd>A decisão é persistida e auditada; não há auto-merge ou deploy.</dd>
              </div>
              <div>
                <dt>Recomendação</dt>
                <dd>Confirme somente após revisar o contexto seguro acima.</dd>
              </div>
            </dl>
            <label>
              Comentário {selected.decision === "request_change" ? "(obrigatório)" : "(opcional)"}
              <textarea
                maxLength={1_000}
                onChange={(event) => {
                  setComment(event.target.value);
                }}
                required={selected.decision === "request_change"}
                value={comment}
              />
            </label>
            {mutation.isError ? (
              <p role="alert">
                {mutation.error instanceof ApprovalDecisionError &&
                mutation.error.code === "conflict"
                  ? "A aprovação mudou. Atualize o Workspace antes de decidir."
                  : "A decisão não foi aplicada."}
              </p>
            ) : null}
            <div className="approval-actions">
              <button
                onClick={() => {
                  setSelected(undefined);
                  mutation.reset();
                }}
                type="button"
              >
                Cancelar
              </button>
              <button disabled={mutation.isPending} type="submit">
                {mutation.isPending ? "Registrando…" : "Confirmar decisão"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </WorkspaceSection>
  );
}

function QualityAssurance({ qa }: { readonly qa: DemandWorkspaceResponse["qa"] }) {
  return (
    <WorkspaceSection eyebrow="Verificação" id="qa-title" title="QA">
      {qa.length === 0 ? (
        <EmptySection>Nenhuma revisão de QA foi registrada.</EmptySection>
      ) : (
        <div className="record-list">
          {qa.map((review) => (
            <article className="record-row" key={review.executionId}>
              <div>
                <strong>Execução {review.executionId}</strong>
                <span>
                  Reconciliação: <DisplayValue value={review.reconciliationReason} />
                </span>
              </div>
              <dl className="qa-signals">
                <div>
                  <dt>Empírico</dt>
                  <dd>
                    <DisplayValue value={review.empiricalVerdict} />
                  </dd>
                </div>
                <div>
                  <dt>Revisor</dt>
                  <dd>
                    <DisplayValue value={review.reviewerDecision} />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </WorkspaceSection>
  );
}

function Deliverables({
  executions,
}: {
  readonly executions: DemandWorkspaceResponse["executions"];
}) {
  return (
    <WorkspaceSection eyebrow="Evidência persistida" id="deliverables-title" title="Entregáveis">
      {executions.length === 0 ? (
        <EmptySection>Nenhuma evidência de entrega foi registrada.</EmptySection>
      ) : (
        <div className="deliverable-grid">
          {executions.map((execution) => (
            <article className="deliverable-card" key={execution.executionId}>
              <strong>Execução {execution.attempt}</strong>
              {execution.diffSummary === "indeterminado" ? (
                <p className="value-indeterminate">Diff indeterminado</p>
              ) : (
                <p>
                  {execution.diffSummary.filesChanged} arquivo(s) · +
                  {execution.diffSummary.insertions} · −{execution.diffSummary.deletions}
                </p>
              )}
              <p>
                Paths protegidos: <DisplayValue value={execution.protectedPathMatchCount} />
              </p>
              <p>
                Resultado: <DisplayValue value={execution.resultStatus} />
              </p>
            </article>
          ))}
        </div>
      )}
      <p className="methodology-note">
        A interface exibe somente metadados existentes. Links de PR ou artefatos não são inferidos.
      </p>
    </WorkspaceSection>
  );
}

function Replay({ timeline }: { readonly timeline: DemandWorkspaceResponse["timeline"] }) {
  const [step, setStep] = useState(0);

  if (timeline.length === 0) {
    return (
      <WorkspaceSection eyebrow="Replay seguro" id="replay-title" title="Linha do tempo">
        <EmptySection>Nenhum evento seguro foi registrado.</EmptySection>
      </WorkspaceSection>
    );
  }

  const active = timeline[Math.min(step, timeline.length - 1)];
  if (active === undefined) return null;

  return (
    <WorkspaceSection eyebrow="Replay seguro" id="replay-title" title="Linha do tempo">
      <div className="replay">
        <ol aria-label="Eventos da demanda" className="timeline-list">
          {timeline.map((event, index) => (
            <li aria-current={index === step ? "step" : undefined} key={event.eventId}>
              <button
                aria-label={`Ver evento ${String(index + 1)}: ${event.action}`}
                onClick={() => {
                  setStep(index);
                }}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{event.action}</strong>
                <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
              </button>
            </li>
          ))}
        </ol>
        <article aria-live="polite" className="replay-focus">
          <p className="kicker">
            Etapa {step + 1} de {timeline.length}
          </p>
          <h3>{active.action}</h3>
          <dl>
            <div>
              <dt>Quando</dt>
              <dd>{formatDate(active.occurredAt)}</dd>
            </div>
            <div>
              <dt>Correlação</dt>
              <dd className="mono">{active.correlationId}</dd>
            </div>
            <div>
              <dt>Evento</dt>
              <dd className="mono">{active.eventId}</dd>
            </div>
          </dl>
          <div className="replay-controls">
            <button
              disabled={step === 0}
              onClick={() => {
                setStep((current) => Math.max(0, current - 1));
              }}
              type="button"
            >
              Evento anterior
            </button>
            <button
              disabled={step === timeline.length - 1}
              onClick={() => {
                setStep((current) => Math.min(timeline.length - 1, current + 1));
              }}
              type="button"
            >
              Próximo evento
            </button>
          </div>
        </article>
      </div>
      <p className="methodology-note">
        Replay derivado de eventos persistidos; não exibe raciocínio interno, prompts ou respostas
        de modelo.
      </p>
    </WorkspaceSection>
  );
}

function Costs({ cost }: { readonly cost: DemandWorkspaceResponse["cost"] }) {
  return (
    <WorkspaceSection eyebrow="Estimativa" id="costs-title" title="Custos">
      <div className="cost-card">
        <span>Custo estimado</span>
        <strong>
          {cost.estimatedUsd === "indeterminado"
            ? "indeterminado"
            : moneyFormatter.format(cost.estimatedUsd)}
        </strong>
        <p>Metodologia: estimativas persistidas. Nenhum custo real é inferido pela interface.</p>
      </div>
    </WorkspaceSection>
  );
}

export function DemandWorkspace({
  approvalDecisionClient,
  cancelTaskClient,
  data,
  pauseTaskClient,
  resumeTaskClient,
  setTaskPriorityClient,
}: {
  readonly approvalDecisionClient: ApprovalDecisionClient;
  readonly cancelTaskClient: CancelDashboardTaskClient;
  readonly data: DemandWorkspaceResponse;
  readonly pauseTaskClient: PauseDashboardTaskClient;
  readonly resumeTaskClient: ResumeDashboardTaskClient;
  readonly setTaskPriorityClient: SetDashboardTaskPriorityClient;
}) {
  return (
    <>
      <header className="workspace-topbar">
        <span className="workspace-brand">ATLAS</span>
        <span>Workspace</span>
        <span className="context-status">
          <span aria-hidden="true" className="status-dot" />
          Governança autenticada
        </span>
      </header>
      <main className="workspace-page">
        <DemandHeader data={data} />
        <TaskOperations
          data={data}
          pauseClient={pauseTaskClient}
          priorityClient={setTaskPriorityClient}
          resumeClient={resumeTaskClient}
        />
        <CancelTask client={cancelTaskClient} data={data} />
        <div className="workspace-layout">
          <Overview data={data} />
          <Plan data={data} />
          <Approvals
            approvals={data.approvals}
            client={approvalDecisionClient}
            taskId={data.header.taskId}
          />
          <QualityAssurance qa={data.qa} />
          <Deliverables executions={data.executions} />
          <Replay timeline={data.timeline} />
          <Costs cost={data.cost} />
        </div>
        <footer className="mission-footer">
          <span>Operações validadas por @atlas/contracts</span>
          <span>Escritas governadas · sem conteúdo bruto · sem chain-of-thought</span>
        </footer>
      </main>
    </>
  );
}
