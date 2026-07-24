# Estado Atual

## Fase

Fase 2 — Core mínimo do Coordinator concluída e aceita sem correções de código.
A Fase 3 foi autorizada, mas só começa após a integração sequencial da Fase 2 e
da entrega documental `idea-intake` na `main`.

## Implementado

- Correção remanescente do aceite da Fase 1: workspace Vitest morto removido.
- Compatibilidade pnpm 11.9: a base já usa `allowBuilds`; a Fase 2 ampliou a
  allowlist booleana mínima para Prisma, pois `onlyBuiltDependencies` foi
  removido nessa versão.
- Logging real do Fastify/Pino com correlation ID; `/health` não embute objeto de log.
- Package `core` independente de Fastify/Prisma com máquina de estados canônica.
- API interna para criar Task e executar transições.
- Rejeição estruturada de transições inválidas, conflitos de versão e FAILED sem `failureStage`.
- Prisma schema e migração inicial para Project, Task, Specification, Approval, Execution, Worker e AuditEvent.
- Idempotency keys, lease renovável e fencing token desde a primeira migração.
- Specification imutável e AuditEvent append-only com triggers PostgreSQL.
- Approval ligada a alvo versionado/hash e Execution ligada a `specification_id`.
- Seed validado de `.atlas/projects.yaml`, sem UI.
- Testes unitários, de API, de contrato da migração e de integração PostgreSQL.

## Testes e validações

- Prisma generate/validate: aprovado.
- Formatação: aprovada.
- Lint: 9/9 tarefas aprovadas.
- Typecheck: 15/15 tarefas aprovadas.
- Testes unitários/API/contrato estático: 13 aprovados.
- Build: 9/9 tarefas aprovadas.
- Migração inicial aplicada com sucesso no PostgreSQL 17 de desenvolvimento.
- Seed de projetos executado com sucesso.
- Testes de integração PostgreSQL: 2 aprovados.
- Nenhum deploy, credencial real ou feature das Fases 3–5 foi implementado.
- O Compose do ATLAS foi encerrado após os testes; o volume de desenvolvimento foi preservado.

## Decisões vigentes

- ADRs 001–012 aceitos.
- Transição aceita e AuditEvent são persistidos atomicamente.
- Task usa versão otimista para impedir atualização concorrente silenciosa.
- PostgreSQL local usa `127.0.0.1:5433` por padrão; o worker permanece sem Docker/banco.
- Repositório remoto canônico: GitHub privado `hcfly2x/ATLAS`, com fluxo de
  branch + PR. A proteção da `main` não está ativa por limitação do plano.
- PR #1 da Fase 1 está com CI verde após alinhar Node 22.13 e pnpm 11.9.

## Próximo passo

Integrar a Fase 2 e `docs/idea-intake` com CI verde sobre bases atualizadas.
Depois disso, iniciar a Fase 3 — Telegram MVP em branch/worktree próprios.

## Restrições ativas

- não iniciar a Fase 3 antes de concluir a sequência de integração;
- não implementar Telegram, supervisor, worker funcional ou fila ativa;
- não fazer deploy ou merge;
- não integrar credenciais reais;
- não configurar produção.
