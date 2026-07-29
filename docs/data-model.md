# Modelo de Dados Conceitual

## Entidades

**Project** — id, nome, risco, classificação de dados, política, `autonomy_level` (`0|1|2|3|4`), repositório, paths protegidos, comandos permitidos, `runtime?` declarado (`package_manager`, bootstrap, validate, allowlist, negações e timeout), requisitos opcionais de versão das ferramentas, teto de custo por tarefa, política de retenção e status. Os campos mínimos e defaults estão definidos em `.atlas/projects.yaml`; ausência de versão mínima não elimina o registro da versão real pelo preflight. Um projeto incompleto permanece `draft` e não pode receber tarefas.

**Task** — id, project_id, origem (telegram), mensagem original, demanda normalizada, complexidade (`simple|moderate|critical`), estado, `failure_stage?`, timestamps. Uma Task é a unidade central: tudo se liga a ela.

**Deliberation** — id, task_id, rodada (`1|2`), status
(`running|completed`), resumo de divergências, timestamps. Agrupa os pareceres
de uma rodada na Trilha 2; `(task_id, rodada)` é único.

**AgentOpinion** — id, deliberation_id, agent_id, payload validado
(`understanding`, `findings`, `recommendation`, `risks`,
`acceptance_criteria`, `confidence`, `unresolved_questions`), modelo, tokens,
custo. Um agente emite no máximo um parecer por rodada; registros são
append-only.

**Specification** — id, task_id, versão, `delivery_mode`
(`answer_only|repository_change`, com default legado `repository_change`), hash
do payload canônico, payload validado conforme
`specifications/executable-specification.md`, produzida pelo supervisor,
criada_em. Cada versão é imutável; uma Task aponta para sua versão ativa.

**Approval** — id, task_id, tipo (`pre_execution|result|sensitive_action`), status (`pending|approved|rejected|expired`), actor (`user|system`), target_type (`specification|execution_result|sensitive_action`), target_id, target_version, target_hash, payload apresentado ao usuário, requested_by, decided_by?, solicitada_em, respondida_em?, expira_em?, canal (`telegram|policy`), idempotency_key. Uma aprovação só vale para o alvo e hash registrados.

**Execution** — id, task_id, specification_id, worker_id, attempt, status (`queued|running|testing|awaiting_result_approval|finalizing|succeeded|failed|cancel_requested|cancelled`), branch, worktree, comandos executados, exit codes, logs sanitizados/referenciados, diff resumido, diff_hash, resultado de testes, failure_stage?, timestamps. Retry técnico gera nova Execution para a mesma Specification.

**PostExecutionReview** — id, task_id, execution_id único, specification_id,
versão, revisor, modelo?, status (`pending|running|approved|rejected|failed`),
payload validado, hash canônico, chave idempotente, claim com expiração, motivo de
falha?, veredito empírico?, decisão do revisor?, código de reconciliação? e
timestamps. O parecer final é imutável e fica ligado ao resultado exato da
Execution; o revisor não pode ser o emissor da Specification. Os campos de
reconciliação são nulos somente para compatibilidade com registros históricos
ou enquanto o review ainda não terminou.

**EmpiricalReview** — id, task_id, execution_id único, specification_id, versão,
worker revisor, veredito (`pass|fail|unavailable`), evidência sanitizada e
limitada, hash canônico, chave idempotente e timestamps. O registro é imutável;
não contém args ou output bruto e apenas alimenta o PostExecutionReview.

**Worker** — id, nome, token hash, escopo de projetos, capacidades/preflight, limite de concorrência, último heartbeat, status.

**WorkerLogChunk** — id, execution_id, sequência, checksum, tamanho, conteúdo
sanitizado, hash do payload, idempotency_key e timestamp. Sequência é única por
Execution.

**TelegramTaskDelivery** — cursores e chaves idempotentes de publicação ligados
a uma Task Telegram. A entrega terminal guarda a chave derivada de `task_id` e
estado antes do envio; o destino vem exclusivamente de `Task.origin`
(`telegram:user_id:chat_id`), nunca da Specification, worker ou demanda. Para
compatibilidade com Tasks legadas de conversa privada, `telegram:user_id` usa o
mesmo valor como `chat_id`.

**ResultDeliveryOutbox** — registro durável por `task_id + task_version`, com
destino derivado de `Task.origin`, referência e hash do conteúdo terminal,
mensagem sanitizada, status (`PENDING|DELIVERED|DELIVERY_FAILED`), tentativas,
backoff, claim de despacho e último erro sanitizado. O status é do transporte,
nunca da Task.

O watchdog de entrega não cria entidade nem status adicional. Condições de SLA
e ausência de outbox são projeções sobre Task, ResultDeliveryOutbox e
TelegramTaskDelivery; o alerta persistente é um AuditEvent idempotente.

**CodexUsage** — id, project_id, task_id, execution_id, custo lógico estimado,
início, fim e timestamp de registro. É separado de `LlmCall`.

**MemoryItem** — id, project_id, tipo (`decision|summary|note`), conteúdo,
task_id origem?, agent_id?, idempotency_key, payload_hash, criado_em. O escopo é
sempre por projeto (ADR-004); `summary` exige Task e não existe memória global
persistente no MVP. Itens são append-only nesta fase.

**AuditEvent** — id, project_id, task_id?, target_type?, target_id?, correlation_id, ator (`user|agent|worker|system`), ação, payload, criado_em. Append-only, nunca editado.

**Attachment** — id, task_id, tipo, caminho de storage, checksum, metadados, classificação, expira_em?. Conteúdo bruto fora do banco.

## Relações principais

```text
Project 1—N Task
Task 1—N Deliberation 1—N AgentOpinion
Task 1—N Specification
Task N—1 Specification ativa
Task 1—N Approval
Task 1—N Execution
Specification 1—N Execution
Execution 1—N WorkerLogChunk
Execution 1—1 CodexUsage
Execution 1—1 PostExecutionReview
Execution 1—1 EmpiricalReview
Approval N—1 alvo versionado (Specification, Execution/result ou ação sensível)
Task 1—N AuditEvent
Task 1—N ResultDeliveryOutbox
Project 1—N MemoryItem
Project 1—N ResultDeliveryOutbox
```

## Invariantes de contratos e aprovação

- Specification é imutável depois de emitida; alteração funcional cria versão nova.
- Specification `answer_only` exige `Task.origin` Telegram válido;
  `repository_change` exige repositório absoluto configurado. O guard ocorre
  antes de enfileirar a Execution.
- O hash é calculado sobre representação canônica do payload validado.
- Execution sempre referencia exatamente uma Specification.
- Aprovação não é transferível entre versões, executions, diffs ou ações.
- Aprovação de resultado referencia `execution_id` e `diff_hash`.
- Commit e abertura de PR só ocorrem em `FINALIZING`, depois de aprovação válida do resultado.
- Em `answer_only`, `FINALIZING` conclui sem commit/PR e a entrega textual usa o
  result-publisher terminal existente; em `repository_change`, a exigência de
  artefatos Git permanece.
- A entrega terminal cria no máximo uma outbox por Task e versão. Approval do
  conteúdo e `DELIVERED` são registros distintos; desfecho de transporte
  ambíguo vira `DELIVERY_FAILED` sem alterar a Task nem repetir o trabalho.
- Todo resultado de worker aguarda QA pós-execução antes de `FINALIZING`. A
  aprovação de política ou do usuário continua necessária quando aplicável, mas
  não substitui o parecer independente. QA aprovado + Approval automática válida
  permite `FINALIZING`; QA rejeitado ou indisponível retorna a Task a
  `SPECIFYING` para retrabalho versionado, sem entregar o resultado.
- A reconciliação libera o gate somente para evidência empírica `pass` e decisão
  do revisor `approved`; ainda assim, não substitui a Approval. `fail`,
  `unavailable`, rejeição, erro ou sinal ausente fecham em retrabalho/revisão
  humana e nunca aprovam sozinhos.
- Aprovação automática também cria Approval com `actor=system`, `target_type`,
  `target_id`, `target_version` e os hashes correspondentes. Ela gera AuditEvent
  e não pode produzir trilha mais fraca que a aprovação manual.
- Approval de resultado nasce `pending`. Uma candidata de política só se torna
  `approved` depois da reconciliação `PASS + reviewer approved`; resultado
  crítico permanece pendente para decisão humana até evals versionados,
  decisão arquitetural e autorização próprias.
- QA rejeitado ou indisponível invalida a Approval pendente ligada à Execution
  antes de retornar a Task para retrabalho versionado.
- Eventos repetidos usam idempotency key; lease renovável e fencing token seguem o ADR-012 aceito.
- Cada parecer e cada início/conclusão de rodada gera AuditEvent com `task_id` e
  `correlation_id`; o supervisor que emite a Specification não ocupa o papel de
  revisor.

## Máquina de estados da Task

### Fluxo principal

```text
NEW → NORMALIZING → ROUTING → SPECIFYING

SPECIFYING → WAITING_APPROVAL    (política exige aprovação prévia)
SPECIFYING → QUEUED              (política dispensa aprovação prévia)
WAITING_APPROVAL → QUEUED        (aprovação válida para a Specification ativa)
WAITING_APPROVAL → CANCELLED     (rejeição definitiva)

QUEUED → RUNNING → TESTING
TESTING → WAITING_RESULT_APPROVAL  (resultado aguarda QA pós-execução e,
                                    quando aplicável, Approval humana)
TESTING → FINALIZING               (transição canônica preservada para fluxos
                                    explicitamente isentos de revisão)
WAITING_RESULT_APPROVAL → FINALIZING  (QA aprovado e Approval válida quando exigida)
FINALIZING → COMPLETED
```

`SPECIFYING` representa a produção da Specification pelo supervisor na Trilha 1. Na Trilha 2, deliberações e até duas rodadas de pareceres ocorrem internamente antes de o supervisor emitir a versão.

### Retrabalho e retry

```text
WAITING_RESULT_APPROVAL → SPECIFYING  (retrabalho funcional; nova Specification)
FAILED → QUEUED                      (retry técnico; automático só no nível 3 após reconciliação e fencing;
                                      mesma Specification, nova Execution)
FAILED → CANCELLED                   (encerramento sem retry)
```

Retrabalho funcional nunca reenfileira silenciosamente a mesma Specification.
Retry técnico não altera escopo nem payload e sempre cria nova Execution. No
nível 3, ele só é automático para falha técnica classificada e nunca enquanto o
lease anterior permanecer ambíguo.

### Falhas

```text
NORMALIZING | ROUTING | SPECIFYING | QUEUED | RUNNING | TESTING | FINALIZING
  → FAILED
```

Toda falha terminal registra `failure_stage`, código/motivo estruturado e AuditEvent. Falha em `FINALIZING` pode ser repetida sem executar Codex novamente, desde que a aprovação e o `diff_hash` continuem válidos.

Quando o lease de uma Execution em `FINALIZING` expira, o coordinator não assume
que o passo Git terminou e não tenta reexecutar Codex. A reconciliação cerca o
lease antigo, marca Task e Execution como `FAILED` com `failure_stage=finalizing`
e grava AuditEvents correlacionados. A recuperação humana pode então verificar o
estado externo de Git/PR sem a fila permanecer bloqueada.

O mesmo princípio vale para lease expirado em `RUNNING`, `TESTING` ou
`CANCEL_REQUESTED`: o coordinator cerca o executor pelo lease/fencing, encerra
de forma auditada e não cria nova Execution automaticamente. No startup, Tasks
que ainda estão em `NEW` são retomadas idempotentemente pelo supervisor; uma
Task que já saiu de `NEW` nunca é deliberada de novo por esse reconciliador.

### Cancelamento cooperativo

```text
NEW | NORMALIZING | ROUTING | SPECIFYING | WAITING_APPROVAL | QUEUED
  → CANCELLED

RUNNING | TESTING | WAITING_RESULT_APPROVAL | FINALIZING
  → CANCEL_REQUESTED

CANCEL_REQUESTED → CANCELLED  (worker confirma parada/limpeza)
CANCEL_REQUESTED → FAILED     (não foi possível concluir cancelamento com segurança)
```

O coordinator não marca `CANCELLED` durante execução até receber confirmação do worker ou verificar término seguro do lease. Corridas entre cancelamento, resultado e finalização são resolvidas por transição atômica e AuditEvent.

## Regras gerais

- Transições fora deste grafo são inválidas e geram erro + AuditEvent.
- Toda transição gera AuditEvent com estado anterior, novo estado, ator e correlation ID.
- Nível crítico e ações previstas nas políticas sempre passam por `WAITING_APPROVAL`.
- FAILED nunca faz retry automático de execução de código no MVP; retry é decisão humana.
- Aprovação expirada, rejeitada ou cujo hash não corresponda ao alvo não permite transição.
- O schema da Fase 2 deve incluir idempotency keys, `lease_id`, `lease_expires_at` e fencing token conforme ADR-012; esses campos não podem ser adiados para a Fase 5.
