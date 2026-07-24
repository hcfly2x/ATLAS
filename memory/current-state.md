# Estado Atual

## Fase

Fase 1 aceita com ressalvas não bloqueadoras. Fase 2 — Core mínimo do Coordinator autorizada e iniciada em 23/07/2026 na branch `phase-2-core`.

## Implementado

- Monorepo pnpm 11.9.0 + Turborepo.
- TypeScript estrito compartilhado.
- Apps `coordinator` e `worker`.
- Packages `shared`, `queue`, `codex-adapter`, `git-adapter`, `agent-runtime` e `audit`.
- Coordinator Fastify com healthcheck técnico e correlation ID.
- Interfaces mínimas dos adapters, sem execução de negócio.
- Logging estruturado básico.
- PostgreSQL 17 em Docker Compose somente para desenvolvimento do coordinator.
- ESLint, Prettier, Vitest, build TypeScript e GitHub Actions.

## Testes e validações

- `pnpm format:check`: aprovado.
- `pnpm lint`: 8/8 projetos aprovados.
- `pnpm typecheck`: 13/13 tarefas aprovadas, incluindo builds de dependências.
- `pnpm test`: 13/13 tarefas aprovadas; 3 testes passando.
- `pnpm build`: 8/8 projetos compilados.
- Nenhum container, banco, deploy ou credencial real foi utilizado.

## Decisões vigentes

- ADRs 001–012 aceitos.
- O schema da Fase 2 deverá incluir desde a primeira migração os campos de idempotência, lease renovável e fencing token do ADR-012.
- Worker permanece sem Docker/banco e com concorrência padrão 1.

## Próximo passo

Executar exclusivamente o backlog da Fase 2. A Fase 3 permanece não autorizada.

## Restrições ativas

- não iniciar a Fase 3;
- não implementar feature de negócio;
- não fazer deploy ou merge;
- não integrar credenciais reais;
- não iniciar Docker ou PostgreSQL no worker;
- não configurar produção.
