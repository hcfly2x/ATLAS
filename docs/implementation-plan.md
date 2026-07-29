# Implementation Plan

## Regra de execução

Não implementar tudo de uma vez. Trabalhar na ordem abaixo e parar ao final de cada entrega. Princípio de Pareto: a Trilha 1 entrega o ciclo completo de valor (Telegram → execução → aprovação) com o mínimo de componentes. Tudo que não bloqueia esse ciclo vai para a Trilha 2.

## Fase 0 — Documentação e decisões ✅

Concluída com o kit v0.0.4: stack canônica definida, ADRs 001–012 aceitos, modelo de dados conceitual e contratos documentais revisados e plano em duas trilhas confirmado como fonte canônica da numeração. A Fase 1 foi autorizada explicitamente em 23/07/2026.

---

## TRILHA 1 — Fatia vertical (MVP)

Objetivo: uma demanda enviada pelo Telegram vira tarefa, é interpretada pelo supervisor, executada pelo worker com Codex em worktree isolada, e o resultado (diff + testes) volta ao Telegram para aprovação. **Sem conselho multiagente ainda** — apenas normalização + supervisor.

### Fase 1 — Foundation mínima ✅

- Monorepo pnpm + Turborepo + TypeScript estrito.
- Apps: `coordinator` (inclui gateway Telegram como módulo) e `worker`. Dashboard NÃO entra no MVP.
- Packages: `shared` (contratos Zod), `queue` (pg-boss), `codex-adapter`, `git-adapter`, `agent-runtime`, `audit`.
- Docker Compose para desenvolvimento do coordinator: PostgreSQL apenas. Sem Redis (ADR-005). O worker não executa Docker ou banco.
- ESLint, Prettier, Vitest, CI (lint + typecheck + test + build).
- Logs estruturados com correlation ID (task_id em tudo).

Critério: pipeline verde, tudo compilando.

### Fase 2 — Core mínimo do Coordinator ✅

- Prisma + migrações para: Project, Task, Specification, Approval, Execution, Worker, AuditEvent, incluindo desde o primeiro schema as idempotency keys, lease renovável e fencing token do ADR-012.
- CRUD de projetos via seed/config (sem UI).
- Máquina de estados da Task conforme `docs/data-model.md`, com transições, hashes e alvos versionados validados.
- Auditoria append-only desde o primeiro dia.

Critério: uma Task percorre estados via API interna, com auditoria.

### Fase 3 — Telegram MVP

**Status:** concluída.

- Webhook + autorização por Telegram ID único.
- Texto → Task; seleção de projeto; botões de aprovação; comando de status; cancelamento.

Critério: criar, aprovar e acompanhar uma tarefa pelo Telegram.

### Fase 4 — Supervisor mínimo (sem conselho)

**Status:** concluída, aceita e integrada na `main`.

- `agent-runtime` com interface de LLM (ADR-008), teto de custo por tarefa.
- Normalização da demanda + supervisor gera Specification validada (Zod).
- Roteador de complexidade apenas classifica e registra (não roteia para conselho ainda); nível crítico força WAITING_APPROVAL.

Critério: demanda vira especificação executável rastreável e auditada.

### Fase 5 — Worker + Codex + Git

**Status:** concluída, aceita e integrada na `main` como v0.0.8.

- Registro do worker, token Bearer, long-polling, heartbeat (ADR-007), preflight e concorrência 1 (ADR-011).
- Worktree + branch por tarefa, cleanup, diff.
- Codex CLI via adapter (ADR-006), streaming de logs em chunks, cancelamento, timeout.
- Verificação de paths protegidos no diff antes de commit (ADR-010).
- Testes do projeto-alvo executados; resultado conforme `specifications/worker-result.md` de volta ao Telegram.
- Commit e PR somente após aprovação do resultado.

Critério: **ciclo completo de valor funcionando de ponta a ponta.** Marco do MVP.

### Preparação local do piloto ✅

- Assistente local em `/setup` para configurar, validar e salvar projetos em
  `.atlas/projects.yaml`.
- Fronteira restrita ao loopback, sem banco, credenciais, deploy ou funções do
  dashboard.
- Ativação condicionada aos requisitos canônicos do projeto e revisão humana do
  diff do arquivo protegido.
- Configuração mínima pede somente repositório e comandos de teste; opções
  avançadas permanecem editáveis e recolhidas por padrão.
- Nome e comando podem ser sugeridos por arquivos conhecidos do repositório,
  sem executar código.

Esta preparação operacional não cria uma nova fase e não autoriza a Fase 6.

---

## TRILHA 2 — Expansão (somente após MVP validado em uso real)

### Fase 6 — Memória por projeto

**Status:** concluída, aceita e integrada na `main` como v0.0.10.

Memória manual, decisões, resumos de tarefa, context builder com isolamento por
projeto (ADR-004). Contrato e aceite detalhados em
`backlog/epic-06-memory.md` e `specifications/project-memory.md`.

### Fase 7 — Conselho multiagente

**Status:** concluída e aprovada para integração na `main` como v0.0.14.

Registro de papéis, roteamento por complexidade acionando conselho (simple: contexto+supervisor; moderate: +arquiteto+qa; critical: conselho completo), pareceres independentes, detecção de divergências, segunda rodada, consolidação. ADR-003.

### Sequência de estabilização e controle de qualidade — precede expansão de autonomia

Cada item só cria uma entidade nova quando `docs/gap-analysis.md` comprovar que
não existe mecanismo equivalente a estender.

- **Bloco 1 — fechar bloqueios do piloto:** consolidar os bloqueios observados
  no fluxo real; conclusão mensurável: uma Task de piloto percorre entrada,
  supervisão, execução e término sem intervenção operacional não documentada.
- **Bloco 2 — runtime reproduzível por projeto:** implementação em revisão no
  PR próprio; tornar o ambiente de execução previsível sem instalar dependências
  fora de política. Conclusão mensurável: preflight e bootstrap explicitamente
  autorizados produzem o mesmo resultado para um projeto configurado em worktree
  limpa.
- **Bloco 3 — recuperação durável:** concluído e integrado;
  reconciliar Tasks `NEW`, leases e execuções após queda. Conclusão mensurável:
  cenários de queda definidos retomam ou falham de forma auditada sem
  reexecutar Codex sob lease ambíguo.
- **QA pós-execução:** em implementação e revisão de risco, depois dos Blocos 2 e 3, revisar o resultado do worker
  com revisor distinto do emissor da Specification; conclusão mensurável:
  todos os resultados da amostra definida recebem parecer pós-execução
  correlacionado antes da entrega final. Só depois desta peça o loop "até a
  entrega" possui ponto de parada confiável.
- **Enforcement determinístico:** estender allowlist e proteção de paths já
  existentes; conclusão mensurável: decisões de política repetidas sobre a
  mesma entrada geram o mesmo resultado auditado.
- **Observabilidade:** estender AuditEvent, logs e dashboard somente-leitura;
  conclusão mensurável: uma Task pode ser reconstruída ponta a ponta por
  `correlation_id`, sem trilha paralela.
- **Evals:** medir a qualidade e o custo sobre conjunto versionado de cenários;
  conclusão mensurável: baseline de aprovação, latência e custo é publicado
  antes de mudança de política ou ampliação de autonomia.

Nenhuma ampliação de autonomia além da política vigente será iniciada antes de
runtime reproduzível, recuperação durável e QA pós-execução estarem concluídos.

### Fase 8 — Políticas e segurança avançadas

Matriz de permissões completa, self-modification restricted fim a fim, proteção de secrets, auditoria completa revisada.

### Fase 9 — Mídia e documentos

Áudio, imagens, PDF, DOCX, anexos vinculados à tarefa.

### Dashboard — plano operacional oficial

A antiga “Fase 10 — Dashboard” monolítica está superada. O plano oficial passa
a ser `docs/dashboard-operational-plan.md`, organizado por workflow nas trilhas:

- A — Atlas Intelligence, Mission Control e Proatividade, somente leitura;
- B — Workspace da Demanda e Replay operacional, leitura primeiro;
- C — autenticação/RBAC, Command Center, escrita e Approval contextual;
- D — projeto como empresa, entregáveis e custo real/Budget;
- E — observabilidade, saúde, conhecimento, decisões e analytics.

Esta é uma trilha paralela priorizada, mas nenhuma etapa está autorizada para
execução. Cada fase exige ADR e autorização próprios, sem atropelar enforcement,
evals ou o loop de auto-desenvolvimento.

### Fase 11 — Hardening

E2E, idempotência, retries, recuperação de falhas, performance, backups, documentação operacional.

### Fase 12 — Times operacionais

Marketing e financeiro, com autonomia progressiva por níveis (0 a 4) e tetos de gasto.
