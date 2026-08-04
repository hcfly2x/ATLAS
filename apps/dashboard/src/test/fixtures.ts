import type {
  DemandWorkspaceResponse,
  MissionControlResponse,
  ProjectsBoardResponse,
} from "@atlas/contracts";

const taskId = "10000000-0000-4000-8000-000000000001";
const occurredAt = "2026-07-29T12:00:00.000Z";

export const projectsBoardFixture: ProjectsBoardResponse = {
  generatedAt: occurredAt,
  projects: [
    {
      activeDemandCount: 3,
      columns: {
        completed: [
          {
            column: "completed",
            objective: "Publicar a autenticação",
            stateLabel: "Concluída",
            taskId: "40000000-0000-4000-8000-000000000004",
            updatedAt: occurredAt,
          },
        ],
        inProgress: [
          {
            column: "in_progress",
            objective: "Construir o quadro de projetos",
            stateLabel: "Em execução",
            taskId,
            updatedAt: occurredAt,
          },
        ],
        needsAttention: [
          {
            column: "needs_attention",
            objective: "Revisar a entrega do dashboard",
            stateLabel: "Aguardando revisão",
            taskId: "20000000-0000-4000-8000-000000000002",
            updatedAt: occurredAt,
          },
        ],
        stopped: [
          {
            column: "stopped",
            objective: "Retomar a integração externa",
            stateLabel: "Pausada",
            taskId: "30000000-0000-4000-8000-000000000003",
            updatedAt: occurredAt,
          },
        ],
      },
      demandCount: 4,
      description: "Coordena o trabalho da empresa de agentes.",
      hasActiveDemand: true,
      id: "atlas",
      isActive: true,
      name: "ATLAS",
    },
    {
      activeDemandCount: 0,
      columns: {
        completed: [],
        inProgress: [],
        needsAttention: [],
        stopped: [],
      },
      demandCount: 0,
      description: "sem descrição",
      hasActiveDemand: false,
      id: "future",
      isActive: false,
      name: "Projeto futuro",
    },
  ],
};

const workItem = {
  complexity: "MODERATE",
  eta: "indeterminado",
  progress: {
    methodology: "task_state",
    stage: "RUNNING",
  },
  projectId: "atlas",
  state: "RUNNING",
  taskId,
  updatedAt: occurredAt,
  version: 4,
} as const;

const proactiveItem = {
  id: "delivery:delivery-1",
  kind: "delivery_failed",
  label: "Entrega terminal precisa de atenção",
  occurredAt,
  projectId: "atlas",
  severity: "high",
  source: {
    id: "delivery-1",
    type: "delivery",
  },
  taskId,
} as const;

export const missionControlFixture: MissionControlResponse = {
  blocked: {
    count: 1,
    items: [
      {
        ...workItem,
        progress: { ...workItem.progress, stage: "WAITING_APPROVAL" },
        state: "WAITING_APPROVAL",
      },
    ],
    status: "available",
  },
  generatedAt: occurredAt,
  inProgress: {
    count: 1,
    items: [workItem],
    status: "available",
  },
  intelligence: {
    facts: [
      { code: "needs_attention", label: "Precisam de você", value: 1 },
      { code: "in_progress", label: "Em execução", value: 1 },
      { code: "blocked", label: "Paradas ou bloqueadas", value: 1 },
      { code: "recently_completed", label: "Concluídas recentemente", value: 1 },
      { code: "risks", label: "Riscos ativos", value: 1 },
      { code: "pending_questions", label: "Dúvidas pendentes", value: "indeterminado" },
    ],
    generatedBy: "deterministic_rules",
    headline: "Entrega terminal precisa de atenção",
    status: "available",
  },
  methodology: {
    cost: "declared_task_cost_limit",
    eta: "indeterminado",
    pendingQuestions: "indeterminado",
    progress: "task_state",
    recentWindowDays: 7,
  },
  needsAttention: {
    count: 1,
    items: [
      {
        ...proactiveItem,
        id: "approval:approval-1",
        kind: "approval_pending",
        label: "Aprovação pendente",
        severity: "medium",
        source: { id: "approval-1", type: "approval" },
      },
    ],
    status: "available",
  },
  priorityNow: {
    item: proactiveItem,
    status: "available",
  },
  projectId: "atlas",
  recentlyCompleted: {
    count: 1,
    items: [
      {
        ...workItem,
        progress: { ...workItem.progress, stage: "COMPLETED" },
        state: "COMPLETED",
      },
    ],
    status: "available",
  },
  risks: {
    count: 1,
    items: [proactiveItem],
    status: "available",
  },
  unavailableSignals: [],
};

export const emptyMissionControlFixture: MissionControlResponse = {
  ...missionControlFixture,
  blocked: { count: 0, items: [], status: "available" },
  inProgress: { count: 0, items: [], status: "available" },
  intelligence: {
    ...missionControlFixture.intelligence,
    facts: missionControlFixture.intelligence.facts.map((fact) => ({ ...fact, value: 0 })),
    headline: "Nenhuma prioridade derivada dos sinais disponíveis",
  },
  needsAttention: { count: 0, items: [], status: "available" },
  priorityNow: { item: null, status: "available" },
  recentlyCompleted: { count: 0, items: [], status: "available" },
  risks: { count: 0, items: [], status: "available" },
};

export const indeterminateMissionControlFixture: MissionControlResponse = {
  ...emptyMissionControlFixture,
  blocked: {
    count: "indeterminado",
    items: [],
    reason: "signal_unavailable",
    status: "indeterminate",
  },
  inProgress: {
    count: "indeterminado",
    items: [],
    reason: "signal_unavailable",
    status: "indeterminate",
  },
  intelligence: {
    ...emptyMissionControlFixture.intelligence,
    facts: emptyMissionControlFixture.intelligence.facts.map((fact) => ({
      ...fact,
      value: "indeterminado",
    })),
    headline: "indeterminado",
    status: "indeterminate",
  },
  needsAttention: {
    count: "indeterminado",
    items: [],
    reason: "signal_unavailable",
    status: "indeterminate",
  },
  priorityNow: {
    item: null,
    status: "indeterminate",
    value: "indeterminado",
  },
  recentlyCompleted: {
    count: "indeterminado",
    items: [],
    reason: "signal_unavailable",
    status: "indeterminate",
  },
  risks: {
    count: "indeterminado",
    items: [],
    reason: "signal_unavailable",
    status: "indeterminate",
  },
  unavailableSignals: [
    "attention",
    "blocked",
    "cost",
    "delivery",
    "inProgress",
    "recentlyCompleted",
    "review",
  ],
};

export const demandWorkspaceFixture: DemandWorkspaceResponse = {
  approvals: [
    {
      actor: "USER",
      approvalId: "approval-1",
      canDecide: false,
      occurredAt,
      status: "APPROVED",
      targetType: "EXECUTION_RESULT",
      targetVersion: 4,
      taskVersion: 8,
      type: "RESULT",
    },
  ],
  cost: {
    currency: "USD",
    estimatedUsd: 2.75,
    methodology: "persisted_estimates",
  },
  demand: {
    objective: "Construir o Workspace read-only da demanda",
  },
  executions: [
    {
      attempt: 1,
      diffSummary: {
        deletions: 8,
        filesChanged: 5,
        insertions: 240,
      },
      durationMs: 42_000,
      executables: ["pnpm", "git"],
      executionId: "execution-1",
      protectedPathMatchCount: 0,
      resultStatus: "PASS",
      specificationVersion: 4,
      status: "COMPLETED",
    },
  ],
  generatedAt: occurredAt,
  header: {
    autonomyLevel: 2,
    createdAt: "2026-07-29T10:00:00.000Z",
    deliveryMode: "repository_change",
    executionState: "COMPLETED",
    originChannel: "telegram",
    project: {
      id: "atlas",
      name: "ATLAS",
    },
    risk: "LOW",
    taskId,
    taskState: "WAITING_RESULT_APPROVAL",
    taskVersion: 7,
    updatedAt: occurredAt,
  },
  memory: {
    byType: {
      DECISION: 2,
      NOTE: 1,
      SUMMARY: 1,
    },
    total: 4,
  },
  plan: {
    acceptanceCriteria: [
      "Workspace consome apenas o read-model sanitizado",
      "UI permanece GET-only",
    ],
    implementationStrategy: ["Adicionar rota tipada", "Renderizar seções independentes"],
    specificationVersion: 4,
  },
  qa: [
    {
      empiricalVerdict: "PASS",
      executionId: "execution-1",
      reconciliationReason: "qa_signals_approved",
      reviewerDecision: "APPROVED",
    },
  ],
  timeline: [
    {
      action: "task.created",
      correlationId: "correlation-1",
      eventId: "event-1",
      occurredAt: "2026-07-29T10:00:00.000Z",
    },
    {
      action: "execution.completed",
      correlationId: "correlation-1",
      eventId: "event-2",
      occurredAt,
    },
  ],
};

export const emptyDemandWorkspaceFixture: DemandWorkspaceResponse = {
  ...demandWorkspaceFixture,
  approvals: [],
  executions: [],
  memory: {
    byType: { DECISION: 0, NOTE: 0, SUMMARY: 0 },
    total: 0,
  },
  plan: {
    acceptanceCriteria: [],
    implementationStrategy: [],
    specificationVersion: "indeterminado",
  },
  qa: [],
  timeline: [],
};

export const indeterminateDemandWorkspaceFixture: DemandWorkspaceResponse = {
  ...emptyDemandWorkspaceFixture,
  cost: {
    ...emptyDemandWorkspaceFixture.cost,
    estimatedUsd: "indeterminado",
  },
  demand: { objective: "indeterminado" },
  header: {
    ...emptyDemandWorkspaceFixture.header,
    autonomyLevel: "indeterminado",
    deliveryMode: "indeterminado",
    executionState: "indeterminado",
    originChannel: "indeterminado",
    risk: "indeterminado",
  },
  plan: {
    acceptanceCriteria: "indeterminado",
    implementationStrategy: "indeterminado",
    specificationVersion: "indeterminado",
  },
};
