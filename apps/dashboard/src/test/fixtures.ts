import type { MissionControlResponse } from "@atlas/contracts";

const taskId = "10000000-0000-4000-8000-000000000001";
const occurredAt = "2026-07-29T12:00:00.000Z";

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
