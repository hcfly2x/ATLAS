# ATLAS

Plataforma pessoal de coordenação de agentes para planejar, desenvolver, revisar e operar projetos de software a partir do Telegram.

## Objetivo

Transformar mensagens enviadas pelo Telegram em demandas estruturadas, analisadas por um conselho de agentes especializados, consolidadas por um supervisor e executadas por um worker local com Codex, Git worktrees, testes e aprovação humana.

## Projetos inicialmente gerenciados

1. Conciliador financeiro pessoal.
2. Plataforma própria de venda de curso online.
3. O próprio ATLAS.
4. Futuro time multiagente de marketing.

## Princípio central

> Agentes analisam. O supervisor decide. O worker executa. O usuário aprova ações sensíveis.

## Como iniciar

1. Leia `AGENTS.md`.
2. Leia `docs/master-implementation-specification.md`.
3. Leia `docs/implementation-plan.md`.
4. Leia `memory/current-state.md`.
5. Execute apenas a fase e a tarefa autorizadas.
6. Não implemente todo o sistema de uma vez.

## Estado atual

Este repositório contém o ATLAS v0.0.6: Fases 0–3 concluídas, com ADRs
001–012 aceitos e ADR-013 Proposto. Supervisor, LLM e execução do worker não
foram antecipados; a Fase 4 exige autorização separada.

## Foundation

- monorepo pnpm + Turborepo + TypeScript estrito;
- apps `coordinator` e `worker`;
- packages `shared`, `queue`, `codex-adapter`, `git-adapter`, `agent-runtime` e `audit`;
- Fastify no coordinator e pg-boss sobre PostgreSQL como dependências canônicas;
- lint, formatação, typecheck, testes, build e CI;
- Docker Compose somente para o PostgreSQL de desenvolvimento do coordinator.

Consulte `docs/development.md` para executar a validação local.

## Core mínimo do Coordinator

- Prisma e migração PostgreSQL inicial;
- seed/config validado de projetos, sem UI;
- máquina de estados canônica no package `core`;
- API interna para criação e transição de Task;
- Specification imutável e Approval com alvo versionado/hash;
- Execution ligada a Specification;
- idempotência, lease e fencing desde o primeiro schema;
- auditoria append-only e logging real com correlation ID.

## Telegram MVP

- webhook testável localmente por injeção Fastify;
- long-polling como modo de desenvolvimento sem URL pública;
- autorização por um único Telegram ID;
- seleção de projeto e mensagem de texto para Task;
- status, aprovações ligadas a alvo/version/hash e cancelamento cooperativo;
- idempotência persistida para updates e callbacks;
- Bearer token obrigatório nas rotas internas.
