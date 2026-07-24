# Resumo técnico — Fase 2

## Objetivo executado

Implementar o Core mínimo persistente do Coordinator: modelo Prisma, seed/config, máquina de estados, API interna e auditoria append-only, sem antecipar Telegram, supervisor, execução do worker ou deploy.

## Decisões aplicadas

- PostgreSQL + Prisma conforme o manifesto canônico.
- A base integrada da Fase 1 já usa `allowBuilds`, exigido pelo pnpm 11.9 no
  lugar de `onlyBuiltDependencies`; a Fase 2 apenas ampliou a allowlist booleana
  mínima para os pacotes Prisma, preservando o install congelado.
- Package `core` contém o domínio e não depende de Fastify ou Prisma.
- Task usa versão otimista para concorrência.
- Transição aceita e AuditEvent são gravados na mesma transação.
- Rejeições também geram AuditEvent sem alterar a Task.
- Specification e AuditEvent recebem enforcement adicional por triggers PostgreSQL.
- ADR-012 está presente desde a primeira migração.
- PostgreSQL local publicado em 5433 por padrão para não conflitar com outro projeto já presente na máquina.

## Estrutura criada

- `packages/core`: grafo de estados, erros e serviço de transição.
- `apps/coordinator/prisma/schema.prisma`: entidades e relações MVP.
- Migração SQL inicial com índices, FKs, idempotência, lease, fencing e triggers.
- Seed validado a partir de `.atlas/projects.yaml`.
- Prisma store com criação/transição idempotente e transacional.
- Rotas internas `POST /internal/tasks` e `POST /internal/tasks/:taskId/transitions`.
- Logging Fastify/Pino por request com correlation ID.
- CI com serviço PostgreSQL, migração, seed e testes de integração.

## Testes executados

- Formatação, lint (9/9 tarefas), typecheck (15/15 tarefas) e build (9/9 tarefas).
- 13 testes unitários, de API e de contrato estático.
- Máquina de estados, idempotência, rejeição, conflito de versão e `failureStage`.
- Fluxo completo NEW → COMPLETED pela API interna.
- Rejeição de transição inválida pela API.
- Presença das colunas obrigatórias do ADR-012 na migração.
- Relações de Approval, Execution e Specification.
- Migração e seed contra PostgreSQL 17 real.
- 2 testes de integração PostgreSQL.
- Persistência atômica de transição/auditoria.
- Rejeição de UPDATE em AuditEvent e Specification por triggers.

## Riscos remanescentes

- O target polimórfico de Approval é validado pela aplicação; PostgreSQL não possui FK polimórfica nativa.
- O endpoint interno ainda não possui autenticação, pois autorização Telegram pertence à Fase 3; ele deve permanecer em rede interna.
- A reconciliação operacional de leases será implementada com o worker/fila, não nesta fase.
- O seed usa upsert e deve ser executado apenas em ambientes controlados.
- Backups, RPO/RTO e operação Render permanecem para fases posteriores.

## Próxima tarefa recomendada

Revisar a entrega e autorizar separadamente, se aprovada, a Fase 3 — Telegram MVP.
