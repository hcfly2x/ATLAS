import type { MissionControlResponse } from "@atlas/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";

import {
  DemandWorkspaceReadError,
  fetchDemandWorkspace,
  type DemandWorkspaceClient,
} from "./demand-workspace.js";
import {
  DashboardReadError,
  fetchMissionControl,
  type MissionControlClient,
} from "./mission-control.js";
import {
  createDashboardSession,
  DashboardSessionError,
  type DashboardSessionClient,
} from "./session.js";
import { DemandWorkspace } from "./Workspace.js";

type ProactiveItem = MissionControlResponse["risks"]["items"][number];
type WorkItem = MissionControlResponse["inProgress"]["items"][number];

const severityLabels = {
  critical: "Crítico",
  high: "Alto",
  info: "Informativo",
  medium: "Atenção",
} as const;

const stateLabels: Record<string, string> = {
  CANCEL_REQUESTED: "Cancelamento solicitado",
  FAILED: "Falhou",
  FINALIZING: "Finalizando",
  NORMALIZING: "Entendendo demanda",
  QUEUED: "Na fila",
  ROUTING: "Definindo rota",
  RUNNING: "Em execução",
  SPECIFYING: "Planejando",
  TESTING: "Em testes",
  WAITING_APPROVAL: "Aguardando aprovação",
  WAITING_RESULT_APPROVAL: "Aguardando revisão",
};

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function demandLocation(taskId: string) {
  return {
    pathname: `/demand/${encodeURIComponent(taskId)}`,
  };
}

function formatDate(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function Icon({
  children,
  viewBox = "0 0 24 24",
}: {
  readonly children: ReactNode;
  readonly viewBox?: string;
}) {
  return (
    <svg aria-hidden="true" className="icon" fill="none" viewBox={viewBox}>
      {children}
    </svg>
  );
}

function AtlasMark() {
  return (
    <span aria-hidden="true" className="atlas-mark">
      <span />
      <span />
      <span />
    </span>
  );
}

function AccessGate({
  error,
  onAuthenticate,
}: {
  readonly error?: string;
  readonly onAuthenticate: (credential: string) => Promise<void>;
}) {
  const [credential, setCredential] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (credential.trim().length === 0 || pending) return;
    setPending(true);
    setLocalError(undefined);
    try {
      await onAuthenticate(credential);
      setCredential("");
    } catch (authenticationError) {
      setCredential("");
      setLocalError(
        authenticationError instanceof DashboardSessionError &&
          authenticationError.code === "unauthorized"
          ? "Credencial inválida."
          : "Não foi possível criar a sessão.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="access-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section aria-labelledby="access-title" className="access-card">
        <div className="brand-lockup">
          <AtlasMark />
          <span>ATLAS</span>
        </div>
        <p className="kicker">Acesso protegido</p>
        <h1 id="access-title">Mission Control</h1>
        <p className="access-copy">
          A credencial é usada uma vez para criar uma sessão temporária em cookie HttpOnly. Ela não
          é guardada no navegador.
        </p>
        <form
          className="access-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor="dashboard-credential">Credencial do dono</label>
          <input
            autoComplete="current-password"
            disabled={pending}
            id="dashboard-credential"
            onChange={(event) => {
              setCredential(event.currentTarget.value);
            }}
            placeholder="Informe sua credencial"
            type="password"
            value={credential}
          />
          <button disabled={pending} type="submit">
            {pending ? "Criando sessão…" : "Abrir Mission Control"}
          </button>
        </form>
        {error === undefined && localError === undefined ? null : (
          <p aria-live="polite" className="form-error" role="alert">
            {localError ?? error}
          </p>
        )}
        <p className="read-only-note">
          <span aria-hidden="true" className="status-dot" />
          Ambiente somente leitura
        </p>
      </section>
    </main>
  );
}

function ShellHeader({ generatedAt }: { readonly generatedAt?: string }) {
  return (
    <header className="topbar">
      <div className="brand-lockup brand-lockup-small">
        <AtlasMark />
        <span>ATLAS</span>
      </div>
      <div className="topbar-context">
        <span className="context-title">Mission Control</span>
        <span className="context-divider" />
        <span className="context-status">
          <span aria-hidden="true" className="status-dot" />
          Somente leitura
        </span>
      </div>
      <div className="sync-time">
        <span>Última leitura</span>
        <strong>{generatedAt === undefined ? "sincronizando" : formatDate(generatedAt)}</strong>
      </div>
    </header>
  );
}

function LoadingHome() {
  return (
    <div aria-busy="true" aria-live="polite">
      <ShellHeader />
      <main className="mission-page">
        <section className="intelligence-panel skeleton-panel">
          <p className="kicker">Atlas Intelligence</p>
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-copy" />
          <p className="loading-label">Sincronizando sinais do Mission Control…</p>
        </section>
        <div className="dashboard-grid">
          {["a", "b", "c", "d"].map((item) => (
            <div className="section-card skeleton-card" key={item}>
              <div className="skeleton skeleton-heading" />
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function ErrorHome() {
  return (
    <>
      <ShellHeader />
      <main className="mission-page">
        <section aria-labelledby="error-title" className="system-state-card">
          <span className="state-symbol">!</span>
          <p className="kicker">Leitura indisponível</p>
          <h1 id="error-title">Mission Control está indeterminado</h1>
          <p>
            Não foi possível validar a projeção agora. Nenhum progresso, custo ou prioridade foi
            inferido. A leitura será tentada novamente pelo polling seguro.
          </p>
        </section>
      </main>
    </>
  );
}

function FactStrip({ facts }: { readonly facts: MissionControlResponse["intelligence"]["facts"] }) {
  return (
    <dl aria-label="Resumo dos sinais" className="fact-strip">
      {facts.map((fact) => (
        <div className="fact-item" key={fact.code}>
          <dt>{fact.label}</dt>
          <dd className={fact.value === "indeterminado" ? "value-indeterminate" : undefined}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PriorityPanel({ priority }: { readonly priority: MissionControlResponse["priorityNow"] }) {
  if (priority.status === "indeterminate") {
    return (
      <aside className="priority-panel priority-indeterminate">
        <p className="kicker">Próxima prioridade</p>
        <strong>Indeterminado</strong>
        <p>Os sinais disponíveis não sustentam uma recomendação.</p>
      </aside>
    );
  }

  if (priority.item === null) {
    return (
      <aside className="priority-panel">
        <p className="kicker">Próxima prioridade</p>
        <strong>Nenhuma ação pendente</strong>
        <p>Não há prioridade derivada dos sinais disponíveis.</p>
      </aside>
    );
  }

  return (
    <aside className="priority-panel">
      <p className="kicker">Próxima prioridade</p>
      <strong>{priority.item.label}</strong>
      <p>
        Task <span className="mono">{shortId(priority.item.taskId)}</span>
      </p>
      <span className={`severity severity-${priority.item.severity}`}>
        {severityLabels[priority.item.severity]}
      </span>
      <Link className="card-link" to={demandLocation(priority.item.taskId)}>
        Abrir Workspace <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}

function Intelligence({ data }: { readonly data: MissionControlResponse }) {
  return (
    <section aria-labelledby="intelligence-title" className="intelligence-panel">
      <div className="intelligence-main">
        <div className="intelligence-heading">
          <span className="intelligence-orbit">
            <Icon>
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />
              <circle cx="12" cy="12" r="4" />
            </Icon>
          </span>
          <div>
            <p className="kicker">Atlas Intelligence · regras determinísticas</p>
            <h1 id="intelligence-title">{data.intelligence.headline}</h1>
          </div>
        </div>
        <FactStrip facts={data.intelligence.facts} />
        <p className="coverage-note">
          <span
            aria-hidden="true"
            className={`coverage-dot coverage-${data.intelligence.status}`}
          />
          {data.unavailableSignals.length === 0
            ? "Todos os sinais consultados estão disponíveis."
            : `Cobertura parcial · ${String(data.unavailableSignals.length)} sinal(is) indeterminado(s).`}
        </p>
      </div>
      <PriorityPanel priority={data.priorityNow} />
    </section>
  );
}

function SectionHeading({
  count,
  eyebrow,
  icon,
  id,
  title,
}: {
  readonly count: number | "indeterminado";
  readonly eyebrow: string;
  readonly icon: ReactNode;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <header className="section-heading">
      <span className="section-icon">{icon}</span>
      <div>
        <p>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      <span className="section-count">{count}</span>
    </header>
  );
}

function IndeterminateState() {
  return (
    <div className="block-state block-indeterminate">
      <span aria-hidden="true">—</span>
      <div>
        <strong>Sinal indeterminado</strong>
        <p>Este bloco não está disponível. Os demais continuam independentes.</p>
      </div>
    </div>
  );
}

function EmptyState({ message }: { readonly message: string }) {
  return (
    <div className="block-state block-empty">
      <span aria-hidden="true">✓</span>
      <div>
        <strong>Nada por aqui</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

function WorkCard({ item }: { readonly item: WorkItem }) {
  return (
    <article className="work-card">
      <div className="work-card-top">
        <span className="state-pill">{stateLabels[item.state] ?? item.state}</span>
        <span className="complexity-pill">{item.complexity ?? "Não classificada"}</span>
      </div>
      <p className="task-reference">
        <span>Task</span>
        <strong className="mono" title={item.taskId}>
          {shortId(item.taskId)}
        </strong>
        <span>· v{item.version}</span>
      </p>
      <div className="work-metadata">
        <span>
          <Icon>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l3 2" />
          </Icon>
          ETA {item.eta}
        </span>
        <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
      </div>
      <Link className="card-link" to={demandLocation(item.taskId)}>
        Abrir Workspace <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

function ProactiveCard({ item }: { readonly item: ProactiveItem }) {
  return (
    <article className={`proactive-card proactive-${item.severity}`}>
      <div className="proactive-header">
        <span className={`severity severity-${item.severity}`}>
          {severityLabels[item.severity]}
        </span>
        <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
      </div>
      <h3>{item.label}</h3>
      <p className="task-reference">
        <span>Task</span>
        <strong className="mono" title={item.taskId}>
          {shortId(item.taskId)}
        </strong>
      </p>
      <p className="source-line">
        Sinal {item.source.type} · <span className="mono">{shortId(item.source.id)}</span>
      </p>
      <Link className="card-link" to={demandLocation(item.taskId)}>
        Abrir Workspace <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

function WorkSection({
  block,
  className,
  emptyMessage,
  eyebrow,
  icon,
  title,
}: {
  readonly block: MissionControlResponse["inProgress"];
  readonly className: string;
  readonly emptyMessage: string;
  readonly eyebrow: string;
  readonly icon: ReactNode;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={`${className}-title`} className={`section-card ${className}`}>
      <SectionHeading
        count={block.count}
        eyebrow={eyebrow}
        icon={icon}
        id={`${className}-title`}
        title={title}
      />
      {block.status === "indeterminate" ? (
        <IndeterminateState />
      ) : block.items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="card-list">
          {block.items.map((item) => (
            <WorkCard item={item} key={`${item.taskId}:${String(item.version)}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProactiveSection({
  block,
  className,
  emptyMessage,
  eyebrow,
  icon,
  title,
}: {
  readonly block: MissionControlResponse["risks"];
  readonly className: string;
  readonly emptyMessage: string;
  readonly eyebrow: string;
  readonly icon: ReactNode;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={`${className}-title`} className={`section-card ${className}`}>
      <SectionHeading
        count={block.count}
        eyebrow={eyebrow}
        icon={icon}
        id={`${className}-title`}
        title={title}
      />
      {block.status === "indeterminate" ? (
        <IndeterminateState />
      ) : block.items.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="card-list">
          {block.items.map((item) => (
            <ProactiveCard item={item} key={item.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function MissionControlHome({ data }: { readonly data: MissionControlResponse }) {
  return (
    <>
      <ShellHeader generatedAt={data.generatedAt} />
      <main className="mission-page">
        <Intelligence data={data} />
        <div className="dashboard-grid">
          <ProactiveSection
            block={data.needsAttention}
            className="attention-section"
            emptyMessage="Nenhuma decisão humana está aguardando você."
            eyebrow="Decisões"
            icon={
              <Icon>
                <path d="M12 3a7 7 0 0 0-4 12.7V20l4-2 4 2v-4.3A7 7 0 0 0 12 3Z" />
                <path d="m9.5 11 1.6 1.6 3.4-3.5" />
              </Icon>
            }
            title="Precisa de mim"
          />
          <WorkSection
            block={data.inProgress}
            className="progress-section"
            emptyMessage="Nenhum trabalho está em execução agora."
            eyebrow="Agora"
            icon={
              <Icon>
                <path d="M4 12h16M12 4l8 8-8 8" />
              </Icon>
            }
            title="Em execução"
          />
          <WorkSection
            block={data.blocked}
            className="blocked-section"
            emptyMessage="Nenhum trabalho está parado ou bloqueado."
            eyebrow="Atenção operacional"
            icon={
              <Icon>
                <path d="M12 4 3.5 19h17L12 4Z" />
                <path d="M12 9v4m0 3h.01" />
              </Icon>
            }
            title="Parado ou bloqueado"
          />
          <WorkSection
            block={data.recentlyCompleted}
            className="completed-section"
            emptyMessage="Nenhuma conclusão foi registrada na janela recente."
            eyebrow={`Últimos ${String(data.methodology.recentWindowDays)} dias`}
            icon={
              <Icon>
                <circle cx="12" cy="12" r="8" />
                <path d="m8.5 12 2.2 2.2 4.8-5" />
              </Icon>
            }
            title="Concluído recentemente"
          />
          <ProactiveSection
            block={data.risks}
            className="risks-section"
            emptyMessage="Nenhum risco foi derivado dos sinais disponíveis."
            eyebrow="Proatividade"
            icon={
              <Icon>
                <path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-3Z" />
                <path d="M12 8v4m0 3h.01" />
              </Icon>
            }
            title="Riscos & Proatividade"
          />
        </div>
        <footer className="mission-footer">
          <span>
            <span aria-hidden="true" className="status-dot" />
            Leitura derivada do estado canônico
          </span>
          <span>Sem LLM · sem ações · sem progresso inferido</span>
        </footer>
      </main>
    </>
  );
}

export interface AppProps {
  readonly demandWorkspaceClient?: DemandWorkspaceClient;
  readonly missionControlClient?: MissionControlClient;
  readonly sessionClient?: DashboardSessionClient;
}

function MissionControlRoute({
  authEpoch,
  client,
  onAuthenticate,
}: {
  readonly authEpoch: number;
  readonly client: MissionControlClient;
  readonly onAuthenticate: (credential: string) => Promise<void>;
}) {
  const projectId = new URLSearchParams(globalThis.location.search).get("projectId") ?? undefined;
  const query = useQuery({
    queryFn: ({ signal }) =>
      client({
        ...(projectId === undefined ? {} : { projectId }),
        signal,
      }),
    queryKey: ["mission-control", projectId ?? "all", authEpoch],
    refetchInterval: 30_000,
    retry: false,
  });

  if (query.isPending) return <LoadingHome />;
  if (query.isError) {
    if (query.error instanceof DashboardReadError && query.error.code === "unauthorized") {
      return <AccessGate error="Sessão ausente ou expirada." onAuthenticate={onAuthenticate} />;
    }
    return <ErrorHome />;
  }
  return <MissionControlHome data={query.data} />;
}

function LoadingWorkspace() {
  return (
    <div aria-busy="true" aria-live="polite">
      <ShellHeader />
      <main className="workspace-page">
        <section className="workspace-hero skeleton-panel">
          <p className="kicker">Workspace da demanda</p>
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-copy" />
          <p className="loading-label">Carregando a projeção segura da demanda…</p>
        </section>
      </main>
    </div>
  );
}

function WorkspaceError({ notFound = false }: { readonly notFound?: boolean }) {
  return (
    <>
      <ShellHeader />
      <main className="workspace-page">
        <section aria-labelledby="workspace-error-title" className="system-state-card">
          <span className="state-symbol">{notFound ? "404" : "!"}</span>
          <p className="kicker">Workspace indisponível</p>
          <h1 id="workspace-error-title">
            {notFound ? "Demanda não encontrada" : "Demanda indeterminada"}
          </h1>
          <p>
            {notFound
              ? "Não existe uma demanda visível para este identificador."
              : "A projeção segura não pôde ser validada. Nenhum conteúdo ou progresso foi inferido."}
          </p>
          <Link className="card-link" to="/">
            Voltar ao Mission Control
          </Link>
        </section>
      </main>
    </>
  );
}

function DemandWorkspaceRoute({
  authEpoch,
  client,
  onAuthenticate,
}: {
  readonly authEpoch: number;
  readonly client: DemandWorkspaceClient;
  readonly onAuthenticate: (credential: string) => Promise<void>;
}) {
  const { taskId = "" } = useParams();
  const query = useQuery({
    queryFn: ({ signal }) => client({ signal, taskId }),
    queryKey: ["demand-workspace", taskId, authEpoch],
    refetchInterval: 30_000,
    retry: false,
  });

  if (query.isPending) return <LoadingWorkspace />;
  if (query.isError) {
    if (query.error instanceof DemandWorkspaceReadError && query.error.code === "unauthorized") {
      return <AccessGate error="Sessão ausente ou expirada." onAuthenticate={onAuthenticate} />;
    }
    return (
      <WorkspaceError
        notFound={
          query.error instanceof DemandWorkspaceReadError && query.error.code === "not_found"
        }
      />
    );
  }
  return <DemandWorkspace data={query.data} />;
}

export function App({
  demandWorkspaceClient = fetchDemandWorkspace,
  missionControlClient = fetchMissionControl,
  sessionClient = createDashboardSession,
}: AppProps) {
  const [authEpoch, setAuthEpoch] = useState(0);

  useEffect(() => {
    const legacyFragment = new URLSearchParams(globalThis.location.hash.replace(/^#/, ""));
    if (legacyFragment.has("token")) {
      globalThis.history.replaceState(
        null,
        "",
        `${globalThis.location.pathname}${globalThis.location.search}`,
      );
    }
  }, []);

  async function authenticate(credential: string) {
    await sessionClient({ credential });
    setAuthEpoch((current) => current + 1);
  }

  return (
    <Routes>
      <Route
        element={
          <MissionControlRoute
            authEpoch={authEpoch}
            client={missionControlClient}
            onAuthenticate={authenticate}
          />
        }
        path="/"
      />
      <Route
        element={
          <DemandWorkspaceRoute
            authEpoch={authEpoch}
            client={demandWorkspaceClient}
            onAuthenticate={authenticate}
          />
        }
        path="/demand/:taskId"
      />
      <Route element={<WorkspaceError notFound />} path="*" />
    </Routes>
  );
}
