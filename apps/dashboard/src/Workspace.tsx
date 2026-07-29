import type { DemandWorkspaceResponse } from "@atlas/contracts";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

type WorkspaceValue = string;

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "USD",
  style: "currency",
});

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
        <Link className="back-link" to={{ hash: globalThis.location.hash, pathname: "/" }}>
          <span aria-hidden="true">←</span> Mission Control
        </Link>
        <p className="kicker">Workspace da demanda · somente leitura</p>
        <h1>{data.demand.objective}</h1>
        <p className="workspace-reference">
          {header.project.name} · <span className="mono">{header.taskId}</span>
        </p>
      </div>
      <dl className="workspace-facts">
        <div>
          <dt>Estado da demanda</dt>
          <dd>{header.taskState}</dd>
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

function Approvals({ approvals }: { readonly approvals: DemandWorkspaceResponse["approvals"] }) {
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
              </div>
            </article>
          ))}
        </div>
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

export function DemandWorkspace({ data }: { readonly data: DemandWorkspaceResponse }) {
  return (
    <>
      <header className="workspace-topbar">
        <span className="workspace-brand">ATLAS</span>
        <span>Workspace</span>
        <span className="context-status">
          <span aria-hidden="true" className="status-dot" />
          Somente leitura
        </span>
      </header>
      <main className="workspace-page">
        <DemandHeader data={data} />
        <div className="workspace-layout">
          <Overview data={data} />
          <Plan data={data} />
          <Approvals approvals={data.approvals} />
          <QualityAssurance qa={data.qa} />
          <Deliverables executions={data.executions} />
          <Replay timeline={data.timeline} />
          <Costs cost={data.cost} />
        </div>
        <footer className="mission-footer">
          <span>Leitura validada por @atlas/contracts</span>
          <span>Sem ações · sem conteúdo bruto · sem chain-of-thought</span>
        </footer>
      </main>
    </>
  );
}
