import type { DashboardProjectConfig } from "@atlas/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";

import {
  createProject,
  detectProjectRepository,
  fetchProjectConfigs,
  ProjectConfigClientError,
  setProjectActive,
  updateProject,
  type ProjectConfigsClient,
} from "./project-config.js";

function newKey(): string {
  return crypto.randomUUID();
}

function ProjectEditor({ project }: { readonly project: DashboardProjectConfig }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [repository, setRepository] = useState("");
  const [command, setCommand] = useState("");
  const [autonomy, setAutonomy] = useState(project.autonomyLevel);
  const [logsDays, setLogsDays] = useState(project.retention.logs_days);
  const [filesDays, setFilesDays] = useState(project.retention.files_days);
  const [sensitiveDays, setSensitiveDays] = useState(project.retention.sensitive_days ?? 30);
  const updateKey = useRef(newKey());
  const statusKey = useRef(newKey());

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-configs"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-board"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-projects"] }),
    ]);
  };
  const save = useMutation({
    mutationFn: () => {
      const tokens = command.trim().split(/\s+/).filter(Boolean);
      return updateProject({
        projectId: project.id,
        request: {
          ...(tokens.length === 0
            ? {}
            : { allowedCommands: [{ executable: tokens[0] ?? "", args: tokens.slice(1) }] }),
          autonomyLevel: autonomy,
          configHash: project.configHash,
          confirmed: true,
          idempotencyKey: updateKey.current,
          name,
          ...(repository.trim().length === 0 ? {} : { repository: repository.trim() }),
          retention: {
            audit_events_expire: false,
            files_days: filesDays,
            logs_days: logsDays,
            sensitive_days: sensitiveDays,
          },
        },
      });
    },
    onError: async (error) => {
      if (error instanceof ProjectConfigClientError && error.code === "unauthorized") {
        globalThis.location.assign("/dashboard/login");
      }
      if (error instanceof ProjectConfigClientError && error.code === "conflict") await refresh();
      updateKey.current = newKey();
    },
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: (active: boolean) =>
      setProjectActive({
        active,
        projectId: project.id,
        request: {
          configHash: project.configHash,
          confirmed: true,
          idempotencyKey: statusKey.current,
        },
      }),
    onError: async (error) => {
      if (error instanceof ProjectConfigClientError && error.code === "unauthorized") {
        globalThis.location.assign("/dashboard/login");
      }
      if (error instanceof ProjectConfigClientError && error.code === "conflict") await refresh();
      statusKey.current = newKey();
    },
    onSuccess: refresh,
  });
  const detect = useMutation({
    mutationFn: () => detectProjectRepository(repository.trim()),
    onSuccess: (suggestion) => {
      if (suggestion.command !== null) {
        setCommand([suggestion.command.executable, ...suggestion.command.args].join(" "));
      }
    },
  });

  return (
    <article className="project-management-card">
      <header>
        <div>
          <h2>{project.name}</h2>
          <p>
            {project.status === "active" ? "Ativo" : "Rascunho"} · {project.id}
          </p>
        </div>
        <Link to={`/projetos?projectId=${encodeURIComponent(project.id)}`}>Ver demandas</Link>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (globalThis.confirm("Confirmar as mudanças governadas deste projeto?")) save.mutate();
        }}
      >
        <label>
          Nome
          <input
            maxLength={120}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            required
            value={name}
          />
        </label>
        <label>
          Caminho absoluto no Mac
          <input
            onChange={(event) => {
              setRepository(event.currentTarget.value);
            }}
            placeholder={
              project.repositoryConfigured
                ? "Configurado — cole apenas para substituir"
                : "/Users/voce/projeto"
            }
            value={repository}
          />
        </label>
        <button
          disabled={repository.trim().length === 0 || detect.isPending}
          onClick={() => {
            detect.mutate();
          }}
          type="button"
        >
          Detectar comando de teste
        </button>
        <label>
          Substituir comandos permitidos
          <input
            onChange={(event) => {
              setCommand(event.currentTarget.value);
            }}
            placeholder={
              project.allowedExecutables.length === 0
                ? "ex.: pnpm test"
                : `Atuais: ${project.allowedExecutables.join(", ")}`
            }
            value={command}
          />
        </label>
        <label>
          Autonomia
          <select
            onChange={(event) => {
              setAutonomy(Number(event.currentTarget.value));
            }}
            value={autonomy}
          >
            <option value={0}>0 — somente manual</option>
            <option value={1}>1 — assistido</option>
            <option value={2}>2 — governado</option>
            <option value={3}>3 — ampliado</option>
          </select>
        </label>
        <div className="retention-grid">
          <label>
            Logs (dias)
            <input
              min={1}
              onChange={(event) => {
                setLogsDays(Number(event.currentTarget.value));
              }}
              type="number"
              value={logsDays}
            />
          </label>
          <label>
            Arquivos (dias)
            <input
              min={1}
              onChange={(event) => {
                setFilesDays(Number(event.currentTarget.value));
              }}
              type="number"
              value={filesDays}
            />
          </label>
          <label>
            Sensíveis (dias)
            <input
              min={1}
              onChange={(event) => {
                setSensitiveDays(Number(event.currentTarget.value));
              }}
              type="number"
              value={sensitiveDays}
            />
          </label>
        </div>
        {project.activationIssues.length === 0 ? (
          <p className="activation-ready">Pronto para ativar.</p>
        ) : (
          <ul className="activation-issues">
            {project.activationIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {save.isError || status.isError || detect.isError ? (
          <p role="alert">Não foi possível concluir. Revise os dados ou recarregue a página.</p>
        ) : null}
        <div className="management-actions">
          <button disabled={save.isPending} type="submit">
            Salvar configuração
          </button>
          {project.status === "active" ? (
            <button
              disabled={status.isPending}
              onClick={() => {
                if (globalThis.confirm("Desativar este projeto? Novas demandas serão bloqueadas."))
                  status.mutate(false);
              }}
              type="button"
            >
              Desativar
            </button>
          ) : (
            <button
              disabled={!project.activationReady || status.isPending}
              onClick={() => {
                if (globalThis.confirm("Ativar este projeto para receber demandas?"))
                  status.mutate(true);
              }}
              type="button"
            >
              Ativar projeto
            </button>
          )}
        </div>
      </form>
    </article>
  );
}

export function ProjectManagement({
  client = fetchProjectConfigs,
}: {
  readonly client?: ProjectConfigsClient;
}) {
  const queryClient = useQueryClient();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const createKey = useRef(newKey());
  const query = useQuery({
    queryFn: ({ signal }) => client(signal),
    queryKey: ["project-configs"],
    retry: false,
  });
  const create = useMutation({
    mutationFn: () =>
      createProject({ confirmed: true, id, idempotencyKey: createKey.current, name }),
    onError: async (error) => {
      if (error instanceof ProjectConfigClientError && error.code === "unauthorized") {
        globalThis.location.assign("/dashboard/login");
      }
      if (error instanceof ProjectConfigClientError && error.code === "conflict") {
        await queryClient.invalidateQueries({ queryKey: ["project-configs"] });
      }
      createKey.current = newKey();
    },
    onSuccess: async () => {
      setId("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["project-configs"] });
    },
  });
  const ordered = useMemo(
    () =>
      query.data === undefined
        ? []
        : [...query.data.projects].sort((a, b) => a.name.localeCompare(b.name)),
    [query.data],
  );

  if (query.isPending)
    return (
      <main className="projects-page">
        <p>Carregando configurações…</p>
      </main>
    );
  if (query.isError) {
    if (query.error instanceof ProjectConfigClientError && query.error.code === "unauthorized") {
      globalThis.location.assign("/dashboard/login");
    }
    return (
      <main className="projects-page">
        <h1>Gestão indisponível</h1>
        <p role="alert">A configuração não pôde ser lida com segurança.</p>
      </main>
    );
  }
  return (
    <main className="projects-page">
      <header className="projects-hero">
        <p className="kicker">Projetos</p>
        <h1>Gerenciar</h1>
        <p>Crie em rascunho, conecte o repositório local do Mac e só então ative.</p>
      </header>
      <section className="new-project-card">
        <h2>Novo projeto</h2>
        <form
          onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (globalThis.confirm("Criar este projeto como rascunho seguro?")) create.mutate();
          }}
        >
          <label>
            Identificador
            <input
              onChange={(event) => {
                setId(event.currentTarget.value);
              }}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="meu-projeto"
              required
              value={id}
            />
          </label>
          <label>
            Nome
            <input
              maxLength={120}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
              required
              value={name}
            />
          </label>
          <button disabled={create.isPending} type="submit">
            Criar rascunho
          </button>
          {create.isError ? (
            <p role="alert">Não foi possível criar. Confirme se o identificador é único.</p>
          ) : null}
        </form>
      </section>
      <section aria-label="Configurações dos projetos" className="project-management-list">
        {ordered.map((project) => (
          <ProjectEditor key={`${project.id}:${project.configHash}`} project={project} />
        ))}
      </section>
    </main>
  );
}
