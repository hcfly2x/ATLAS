# C2c — Esboço de migração aditiva

## Status e limite

Plano subordinado ao ADR-030 Proposto. Os passos 1–5 foram autorizados,
implementados em entregas isoladas e preservam os gates descritos abaixo. Este
documento continua sendo histórico de desenho, não uma migration executável nem
autorização para rollout, merge ou deploy.

## Forma proposta do schema

O delta futuro é estritamente aditivo:

```prisma
enum TaskState {
  // todos os 14 valores atuais permanecem
  PAUSED
}

enum TaskPauseOrigin {
  WAITING_APPROVAL
  QUEUED
}

enum DashboardCommandType {
  CREATE_DEMAND
  CANCEL_TASK
  PAUSE_TASK
  RESUME_TASK
  SET_TASK_PRIORITY
}

model Task {
  // campos atuais permanecem
  pausedFromState TaskPauseOrigin? @map("paused_from_state")
  priority        Int              @default(0) @db.SmallInt
}
```

O SQL será equivalente a:

```sql
ALTER TYPE "TaskState" ADD VALUE 'PAUSED';
CREATE TYPE "TaskPauseOrigin" AS ENUM ('WAITING_APPROVAL', 'QUEUED');
ALTER TYPE "DashboardCommandType" ADD VALUE 'PAUSE_TASK';
ALTER TYPE "DashboardCommandType" ADD VALUE 'RESUME_TASK';
ALTER TYPE "DashboardCommandType" ADD VALUE 'SET_TASK_PRIORITY';

ALTER TABLE "tasks"
  ADD COLUMN "paused_from_state" "TaskPauseOrigin",
  ADD COLUMN "priority" SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_priority_allowed"
    CHECK ("priority" IN (0, 10, 20)),
  ADD CONSTRAINT "tasks_paused_origin_consistent"
    CHECK (
      ("state" = 'PAUSED' AND "paused_from_state" IS NOT NULL)
      OR ("state" <> 'PAUSED' AND "paused_from_state" IS NULL)
    );

CREATE INDEX "tasks_state_priority_created_at_id_idx"
  ON "tasks" ("state", "priority" DESC, "created_at", "id");
```

Não há `UPDATE`, backfill ou reescrita de Task. Registros existentes recebem
`priority=0` pelo default e continuam com `paused_from_state=NULL`. Nenhum valor
ou aresta atual é removido.

## Sequência segura de implementação

1. **Caracterização:** congelar por testes a topologia atual, as duas formas de
   claim, decisões concorrentes de Approval e recibos C2b1.
2. **Schema e core:** aplicar somente a migração aditiva; gerar o client;
   acrescentar `PAUSED`, origem e regras puras condicionais. Ainda sem rotas.
3. **Scheduler:** unificar seleção por Task, adicionar aging/prioridade e tornar
   os dois caminhos de claim CAS transacionais. Provar corrida pause/claim com
   PostgreSQL real antes de expor o comando.
4. **Serviço de comandos:** estender o recibo e implementar pausa, retomada e
   prioridade com replay aceito/rejeitado, versão otimista e auditoria
   sanitizada. Ainda sem UI.
5. **Read-model e UI:** classificar `PAUSED` como bloqueado e só então expor os
   controles sob RBAC/CSRF existentes. A UI recarrega Workspace e Mission
   Control em conflito.
6. **Rollout:** habilitar primeiro em staging sintético, verificar que nenhuma
   Task pausada recebe Assignment e só depois solicitar autorização de merge da
   fase de comportamento.

Cada passo é um PR próprio ou uma entrega claramente isolada e para para revisão
completa. A fase de comportamento não pode combinar schema, scheduler e UI sem
gates intermediários.

**Estado:** passos 1–5 concluídos. O rollout e qualquer decisão operacional
continuam sujeitos a revisão e autorização próprias.

## Compatibilidade e rollback

- A migração pode preceder o código: enquanto nenhuma rota escreve `PAUSED`, o
  runtime antigo observa os mesmos 14 estados e prioridade normal.
- Depois de ativar a função, rollback de aplicação exige desabilitar os comandos
  e resolver todas as Tasks `PAUSED` para seu estado gravado ou `CANCELLED`.
- Enum, colunas e índices permanecem no banco em rollback; removê-los seria
  destrutivo e exige fase própria.
- Falha de validação, origem ausente, versão divergente ou corrida retorna
  conflito/rejeição e não altera Task, Execution, Approval, lease ou fencing.

## Provas obrigatórias antes de autorizar comportamento

- as arestas antigas permanecem byte a byte e somente as cinco arestas do
  ADR-030 são acrescentadas;
- `PAUSED` nunca é selecionado nos dois caminhos de claim;
- corrida `pause × claim` produz exatamente um vencedor, sem Execution/lease
  parcial;
- corrida `pause × Approval` produz exatamente um vencedor e rollback integral
  do perdedor;
- retomada sempre retorna ao `pausedFromState`, nunca ao destino enviado pelo
  cliente;
- prioridade não pula Approval, orçamento, projeto ativo, enforcement ou
  escopo do worker;
- aging impede uma sequência contínua de urgentes de ultrapassar para sempre a
  Task normal mais antiga;
- replay e conflito de pausa/retomada/prioridade seguem a semântica durável do
  recibo C2b1, inclusive para rejeições;
- auditoria e respostas não contêm conteúdo livre, prompt, payload ou segredo;
- integração PostgreSQL, `pnpm validate`, testes de concorrência e staging estão
  verdes antes da UI ou do merge.
