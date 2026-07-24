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

Este repositório contém o Project Starter Kit v0.0.4: Fase 0 e Fase 1 — Foundation mínima concluídas, com ADRs 001–012 aceitos. Nenhuma feature de negócio foi implementada e a Fase 2 não está autorizada.

## Foundation

- monorepo pnpm + Turborepo + TypeScript estrito;
- apps `coordinator` e `worker`;
- packages `shared`, `queue`, `codex-adapter`, `git-adapter`, `agent-runtime` e `audit`;
- Fastify no coordinator e pg-boss sobre PostgreSQL como dependências canônicas;
- lint, formatação, typecheck, testes, build e CI;
- Docker Compose somente para o PostgreSQL de desenvolvimento do coordinator.

Consulte `docs/development.md` para executar a validação local.
