# Resumo técnico — Fase 1

## Objetivo executado

Criar a Foundation mínima do ATLAS como monorepo compilável, sem features de negócio, deploy, produção ou credenciais reais.

## Decisões aplicadas

- pnpm 11.9.0 e Turborepo.
- Node.js 20 ou superior e TypeScript estrito.
- Apps `coordinator` e `worker`.
- Packages mínimos: `shared`, `queue`, `codex-adapter`, `git-adapter`, `agent-runtime` e `audit`.
- Fastify no coordinator, pg-boss para a futura fila e Zod para contratos.
- PostgreSQL 17 via Docker Compose somente no desenvolvimento do coordinator.
- Worker sem Docker/banco, concorrência 1 e perfil macOS/ARM64.
- ADR-012 aceito; o schema da Fase 2 deverá incluir idempotência, lease e fencing desde a primeira migração.

## Estrutura criada

- Configuração raiz de workspace, TypeScript, Turborepo, ESLint, Prettier e Vitest.
- Workflow de CI com instalação congelada e pipeline completa.
- Healthcheck técnico do coordinator com correlation ID.
- Status técnico testável do worker.
- Interfaces vazias de implementação para as fronteiras futuras; nenhuma ação externa é executada.
- Documentação de desenvolvimento e `.env.example` apenas com valores locais.

## Testes executados

```text
pnpm format:check  — aprovado
pnpm lint          — 8/8 projetos
pnpm typecheck     — 13/13 tarefas
pnpm test          — 13/13 tarefas; 3 testes
pnpm build         — 8/8 projetos
```

O Docker Compose foi validado estaticamente quando o CLI estava disponível; nenhum container ou banco foi iniciado.

## Riscos remanescentes

- A CI foi configurada, mas sua execução remota depende de o repositório ser publicado no GitHub.
- PostgreSQL e pg-boss ainda não possuem integração: isso pertence à Fase 2.
- Interfaces de adapters são fundação tipada, não implementações funcionais.
- O healthcheck não verifica banco ou fila, pois esses componentes ainda não foram implementados.
- Dependências deverão receber política de atualização e auditoria contínua em fase posterior.

## Próxima tarefa recomendada

Revisar a pipeline e esta entrega. A Fase 2 — Core mínimo do Coordinator só pode começar após autorização explícita separada.
