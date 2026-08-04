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
            {project.isActive ? <span className="project-active-label">Projeto ativo</span> : null}
          </span>
          <span className="project-description">{project.description}</span>
        </div>
        <div className="project-summary-meta">
          <span className={`project-status${project.hasActiveDemand ? " status-running" : ""}`}>
            <span aria-hidden="true">{project.hasActiveDemand ? "●" : "○"}</span>
            {project.hasActiveDemand ? "Em execução" : "Sem demanda ativa"}
          </span>
          <span>{project.demandCount} demanda(s)</span>
        </div>
      </summary>
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
    </details>
  );
}

export function ProjectsBoard({ data }: { readonly data: ProjectsBoardResponse }) {
  return (
    <main className="projects-page">
      <header className="projects-hero">
        <p className="kicker">Visão por projeto</p>
        <h1>Projetos e demandas</h1>
        <p>Veja onde cada demanda está e o que precisa da sua atenção.</p>
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
