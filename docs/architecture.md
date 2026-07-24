# Arquitetura

## Componentes

### Telegram Gateway

Responsável apenas por receber e enviar mensagens, arquivos e callbacks.

### Coordinator API

Cérebro do sistema:

- projetos;
- sessões;
- agentes;
- deliberação;
- políticas;
- aprovações;
- filas;
- memória;
- prompts.

### Agent Runtime

Executa agentes especializados de forma isolada e estruturada.

### Supervisor

Consolida pareceres e produz a especificação final.

### Queue

Gerencia tarefas, prioridade, retry, timeout e cancelamento. Implementação: pg-boss sobre PostgreSQL (ADR-005).

### Worker Local

Executa tarefas em Mac mini ou MacBook M1 com 8 GB de RAM e macOS Tahoe 26.4. Mantém uma execução concorrente por padrão, conforme ADR-011. Não executa Docker nem banco de dados; requer somente Node.js, Git, Codex CLI e os repositórios dos projetos.

### Codex Adapter

Isola a integração com Codex SDK/CLI.

### Git Adapter

Cria worktree, branch, commit, push e PR.

### Memory Service

Mantém memória persistente sempre vinculada a um projeto (ADR-004), podendo associá-la também a agente e tarefa. Contexto comum ao sistema é configuração estática versionada, não memória global persistente.

### Audit Service

Registra entrada, pareceres, decisões, aprovações, comandos e resultados.

## Monorepo

apps/ (MVP)

- coordinator (inclui o gateway Telegram como módulo)
- worker

apps/ (Trilha 2)

- dashboard
- gateway separado, apenas se necessário

packages/ (até a Fase 2)

- core
- agent-runtime
- queue
- codex-adapter
- git-adapter
- audit
- shared

`supervisor`, `memory`, `policies` e `telegram-adapter` só serão extraídos quando as fases correspondentes justificarem sua criação.

## Persistência do Core

- Prisma e PostgreSQL no coordinator.
- Migração inicial versionada em `apps/coordinator/prisma/migrations/`.
- Entidades Project, Task, Specification, Approval, Execution, Worker e AuditEvent.
- Specification imutável por versão e hash, com proteção adicional por trigger no banco.
- AuditEvent append-only, também protegido contra UPDATE/DELETE por trigger.
- Execution referencia obrigatoriamente `specification_id`.
- Approval registra tipo, ID, versão e hash do alvo aprovado.
- Idempotency keys nas fronteiras persistidas.
- Execution possui `lease_id`, `lease_expires_at`, fencing token e chaves separadas de claim/resultado desde a primeira migração (ADR-012).
- Atualização de estado e AuditEvent aceito ocorrem na mesma transação.
- Concorrência de transições usa versão otimista da Task.

## Comunicação

- Telegram → webhook HTTPS.
- Gateway → Coordinator por API interna.
- Coordinator → fila (pg-boss).
- Agentes deliberativos executam no coordinator via LLM API (ADR-008).
- Worker → long-polling HTTPS de saída com token Bearer (ADR-007).
- Notebook nunca exposto diretamente à internet.
- Eventos internos persistidos.

## Hospedagem do MVP

- Coordinator em Render Web Service persistente, sem hibernação.
- PostgreSQL gerenciado no Render.
- Backups gerenciados do provedor são suficientes no MVP.
- O worker não hospeda serviços do coordinator.

## Runtime deliberativo

- Interface multi-provedor conforme ADR-008.
- OpenAI como provedor operacional inicial.
- GPT-5.6 Terra como modelo padrão.
- GPT-5.6 Luna para normalização e roteamento.
- Teto agregado de US$ 25 por mês para agentes deliberativos, também configurado como hard limit no dashboard da OpenAI.
- Teto lógico separado de US$ 75 por mês para execução Codex, rastreado pelo ATLAS; o consumo está incluído na assinatura ChatGPT Pro.

## Estados de tarefa

NEW
NORMALIZING
ROUTING
SPECIFYING
WAITING_APPROVAL
QUEUED
RUNNING
TESTING
WAITING_RESULT_APPROVAL
FINALIZING
CANCEL_REQUESTED
COMPLETED
FAILED
CANCELLED

Transições válidas, regras e entidades: ver `docs/data-model.md`.
