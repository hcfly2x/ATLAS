import type { ProjectsBoardResponse } from "@atlas/contracts";
import { Link } from "react-router-dom";

const columns = [
  { key: "needsAttention", title: "Precisa de você", empty: "Nenhuma decisão pendente." },
  { key: "inProgress", title: "Em execução", empty: "Nenhuma demanda em execução." },
  { key: "stopped", title: "Parado", empty: "Nenhuma demanda parada." },
  { key: "completed", title: "Concluído", empty: "Nenhuma entrega concluída." },
] as const;

function DemandCard({
  demand,
}: {
  readonly demand: ProjectsBoardResponse["projects"][number]["columns"]["inProgress"][number];
}) {
  return (
    <Link
      aria-label={`${demand.objective}. ${demand.stateLabel}. Abrir Workspace`}
      className="project-demand-card"
      to={`/demand/${encodeURIComponent(demand.taskId)}`}
    >
      <strong>{demand.objective}</strong>
      <span>{demand.stateLabel}</span>
      <span className="project-card-action">Abrir Workspace →</span>
    </Link>
  );
}

function ProjectPlan({ project }: { readonly project: ProjectsBoardResponse["projects"][number] }) {
  const plan = project.plan;
  return (
    <section aria-labelledby={`${project.id}-plan`} className="project-plan">
      <header className="project-section-header">
        <div>
          <p className="kicker">Contexto declarado</p>
          <h2 id={`${project.id}-plan`}>Plano</h2>
        </div>
        {plan.status === "available" && plan.format === "checklist" ? (
          <span>
            {plan.completedCount} feito(s) · {plan.pendingCount} pendente(s)
          </span>
        ) : null}
      </header>
      {plan.status === "unavailable" ? (
        <p className="project-plan-unavailable">Plano não disponível.</p>
      ) : plan.format === "text" ? (
        <p className="project-plan-text">{plan.text}</p>
      ) : (
        <ul className="project-plan-list">
          {plan.items.map((item) => (
            <li className={`plan-${item.status}`} key={item.id}>
              <span aria-hidden="true">{item.status === "completed" ? "✓" : "○"}</span>
              <span>{item.label}</span>
              <strong>{item.status === "completed" ? "Feito" : "Pendente"}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoricalDemands({
  project,
}: {
  readonly project: ProjectsBoardResponse["projects"][number];
}) {
  if (project.history.length === 0) return null;
  return (
    <details className="project-history">
      <summary>
        <span>Histórico (pré–go-live)</span>
        <span>{project.historicalDemandCount} demanda(s)</span>
      </summary>
      <p>Registros anteriores ao marco operacional. Nada foi apagado.</p>
      <div className="project-history-list">
        {project.history.map((demand) => (
          <DemandCard demand={demand} key={demand.taskId} />
        ))}
      </div>
    </details>
  );
}

function ProjectLane({ project }: { readonly project: ProjectsBoardResponse["projects"][number] }) {
  return (
    <details
      className={`project-lane${project.isActive ? " project-lane-active" : ""}`}
      open={project.isActive && project.hasActiveDemand}
    >
      <summary>
        <div>
          <span className="project-name-row">
            <strong>{project.name}</strong>
            <span className={project.isActive ? "project-active-label" : "project-draft-label"}>
              {project.isActive ? "Projeto ativo" : "Projeto em rascunho"}
            </span>
          </span>
          <span className="project-description">{project.description}</span>
          {project.isActive ? null : (
            <span className="project-activation-note">
              Configure e ative em Projetos → Gerenciar antes de criar demandas.
            </span>
          )}
        </div>
        <div className="project-summary-meta">
          <span className={`project-status${project.hasActiveDemand ? " status-running" : ""}`}>
            <span aria-hidden="true">{project.hasActiveDemand ? "●" : "○"}</span>
            {project.hasActiveDemand ? "Em execução" : "Sem demanda ativa"}
          </span>
          <span>{project.demandCount} demanda(s)</span>
        </div>
      </summary>
      <ProjectPlan project={project} />
      <section aria-labelledby={`${project.id}-demands`} className="project-demands">
        <header className="project-section-header">
          <div>
            <p className="kicker">Operação atual</p>
            <h2 id={`${project.id}-demands`}>Demandas</h2>
          </div>
          <span>{project.demandCount - project.historicalDemandCount} demanda(s) no quadro</span>
        </header>
        <div className="project-board-columns">
          {columns.map((column) => {
            const demands = project.columns[column.key];
            return (
              <section
                aria-labelledby={`${project.id}-${column.key}`}
                className={`project-column column-${column.key}`}
                key={column.key}
              >
                <header>
                  <h2 id={`${project.id}-${column.key}`}>{column.title}</h2>
                  <span aria-label={`${String(demands.length)} demandas`}>{demands.length}</span>
                </header>
                {demands.length === 0 ? (
                  <p className="project-column-empty">{column.empty}</p>
                ) : (
                  <div className="project-demand-list">
                    {demands.map((demand) => (
                      <DemandCard demand={demand} key={demand.taskId} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <HistoricalDemands project={project} />
      </section>
    </details>
  );
}

export function ProjectsBoard({ data }: { readonly data: ProjectsBoardResponse }) {
  return (
    <main className="projects-page">
      <header className="projects-hero">
        <p className="kicker">Visão por projeto</p>
        <h1>Projetos</h1>
        <p>
          Compare o plano declarado com o que já foi feito e acompanhe as demandas operacionais.
        </p>
        <Link className="card-link" to="/projetos/gerenciar">
          Gerenciar projetos →
        </Link>
      </header>
      {data.projects.length === 0 ? (
        <section className="projects-empty">
          <h2>Nenhum projeto disponível</h2>
          <p>Quando um projeto for declarado, ele aparecerá aqui.</p>
        </section>
      ) : (
        <div className="projects-list">
          {data.projects.map((project) => (
            <ProjectLane key={project.id} project={project} />
          ))}
        </div>
      )}
    </main>
  );
}
