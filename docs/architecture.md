# Arquitetura

## Componentes

### Gateway Telegram

O módulo Telegram vive no coordinator e separa transporte de comportamento. O
mesmo serviço recebe updates entregues pelo webhook Fastify ou obtidos por
long-polling. O webhook não é registrado automaticamente. Sessão de projeto e
respostas processadas são persistidas no PostgreSQL para autorização e replay
idempotente.

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

### Dashboard operacional

Há uma única dashboard web operacional no coordinator hospedado. Ela consulta o
mesmo PostgreSQL das Tasks recebidas pelo Telegram e é somente leitura. A
exposição pública no Render é desabilitada por default e depende de flag
explícita e Bearer token de alta entropia; não cria um segundo banco, dashboard
local concorrente ou rota de escrita. Approval continua no fluxo governado
existente, fora da Home.

A Trilha A projeta Mission Control, Proatividade e Atlas Intelligence
determinística diretamente de Task, Execution, Approval, revisões, custos e
outbox existentes. Cada bloco de leitura falha de forma independente para
`indeterminado`; progresso usa apenas o estado real da Task, ETA sem metodologia
permanece indeterminado e custo anormal significa somente ultrapassar o teto
declarado do projeto. A Home não usa LLM, não persiste cache e não expõe
conteúdo bruto.

### Agent Runtime

Expõe uma interface própria, independente do provedor, para executar agentes com
saída estruturada validada por Zod. A implementação operacional inicial usa a
Responses API da OpenAI, sem persistir prompts no provedor (`store: false`).
Normalizador e roteador usam GPT-5.6 Luna; o supervisor usa GPT-5.6 Terra.
Opcionalmente, somente o revisor pós-execução pode usar o adaptador Claude,
selecionado por configuração e com endpoint Anthropic fixo. Sem essa seleção, o
runtime OpenAI atual permanece o default; os demais agentes não mudam.

### Supervisor

Na Fase 4, normaliza a demanda, classifica a complexidade e produz uma
Specification executável, versionada e com hash canônico. A política combina
`Project.autonomy_level`, criticidade e `.atlas/policies.yaml#always_human` para
encaminhar a Task a `QUEUED` ou `WAITING_APPROVAL`. Dispensa de aprovação humana
gera Approval explícita de sistema e AuditEvent; não reduz a auditabilidade.

Após o worker entregar testes e diff, o coordinator aplica um QA pós-execução
independente antes da finalização. Ele reutiliza `AgentRuntime`, `Execution`,
`Approval`, `AuditEvent` e a fila de estados existentes: não cria segundo worker,
canal de entrega ou máquina de estados. A reconciliação determinística libera o
gate somente quando a evidência empírica é `PASS` e o revisor decide
`approved`; ainda assim, a Approval de resultado existente precisa ser válida.
Rejeição, divergência, sinal ausente ou indisponibilidade retornam a demanda
para retrabalho versionado.

Toda Approval de resultado nasce pendente. Para trabalho reversível
`simple|moderate`, uma decisão pura pode marcá-la como candidata à política com
base no nível de autonomia, testes, evidência empírica, paths protegidos e ações
sensíveis. A decisão automática só ocorre depois da reconciliação
`PASS + approved`. Resultado crítico permanece humano enquanto o gate de evals
estiver fechado; não existe configuração que contorne essa fronteira.

Falha, timeout, recusa ou resposta inválida do provedor do revisor são tratados
como QA indisponível com código sanitizado. A diversidade de provedor não
transforma o parecer em autorização de merge ou deploy.

Antes da submissão do resultado bem-sucedido, o worker produz uma evidência
empírica na própria worktree: repete somente instalação congelada e
`runtime.validate` já declarados/autorizados e confere o diff contra o escopo da
Specification. O coordinator persiste essa evidência de forma imutável e a
inclui na entrada do revisor pós-execução. `PASS` nunca decide sozinho;
`FAIL|UNAVAILABLE` impedem a liberação automática do gate. O probe não altera
resultado, lease, fencing, Approval ou finalização.

A Specification explicita `delivery_mode`. Planejamentos, análises e respostas
sem mudança solicitada usam `answer_only`; pedidos de alteração e casos
ambíguos usam `repository_change`. O primeiro admite diff vazio após validação
de conteúdo pelo QA e finaliza sem artefato Git. O texto aprovado segue pelo
result-publisher existente, sempre para `Task.origin`. Antes da fila, um guard
rejeita contratos sem destino autorizado.

O result-publisher persiste uma outbox por Task e versão antes do despacho. Um
reconciliador confirma `DELIVERED`, agenda backoff limitado somente para falha
comprovadamente anterior ao envio e marca desfechos ambíguos como
`DELIVERY_FAILED`. Esses estados pertencem à entrega e não alteram a máquina de
estados da Task.

Um watchdog de entrega observa a outbox sem mutá-la. Ele audita
idempotentemente `DELIVERY_FAILED`, `PENDING` além do SLA e Tasks Telegram
terminais sem outbox da versão vigente. A mesma condição é exposta na dashboard
somente-leitura; não existe rota de reenvio ou retry manual.

Quando a origem é Telegram, o coordinator publica de forma idempotente o resumo
do QA, as ações requeridas e o próximo passo no chat codificado em `Task.origin`.
Essa publicação não cria Specification, Execution ou retry funcional.

Na Fase 7, o roteamento versionado de `.atlas/routing.yaml` seleciona pareceres
independentes dos papéis registrados em `.atlas/agents.yaml`: contexto no fluxo
simples, contexto+arquitetura+qualidade no moderado e conselho completo no
crítico. O supervisor não emite parecer sobre a própria Specification. Ele
identifica somente divergências materiais, pode solicitar uma segunda e última
rodada focada e então consolida uma única Specification sem votação por maioria.
Pareceres e rodadas são persistidos e auditados individualmente.

### Queue

Gerencia tarefas, prioridade, retry, timeout e cancelamento. Implementação: pg-boss sobre PostgreSQL (ADR-005).

### Worker Local

Executa tarefas em Mac mini ou MacBook M1 com 8 GB de RAM e macOS Tahoe 26.4. Mantém uma execução concorrente por padrão, conforme ADR-011. Não executa Docker nem banco de dados; requer somente Node.js, Git, Codex CLI e os repositórios dos projetos.

O worker registra capacidades reais em preflight, faz long-polling HTTPS e
mantém heartbeat separado da renovação do lease. Cada execução valida
Specification, lease e fencing token, opera em worktree isolada, transmite
chunks sanitizados com backpressure e produz o contrato Zod de resultado.

### Codex Adapter

Isola `codex exec` não interativo, sem shell, com saída incremental e resumo JSON
estruturado. Cancelamento encerra o grupo de processos com grace period antes de
forçar término.

### Git Adapter

Cria worktree e branch por Execution, calcula diff, commita, faz push e abre PR
draft quando a política permite. PR é consultado antes da criação para tornar a
finalização repetível; merge continua exclusivamente humano.

### Memory Service

O package `@atlas/memory` monta contexto limitado e determinístico, falhando
fechado se receber item de outro projeto. O coordinator persiste decisões,
notas e resumos sempre vinculados a um Project (ADR-004), opcionalmente também a
agente e Task. Resumos de conclusão são criados atomicamente com a finalização
do worker. Contexto comum ao sistema é configuração estática versionada, não
memória global persistente.

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
- Deliberation agrupa no máximo duas rodadas; AgentOpinion preserva cada parecer
  estruturado, modelo e consumo, com proteção append-only no banco.
- Specification imutável por versão e hash, com proteção adicional por trigger no banco.
- AuditEvent append-only, também protegido contra UPDATE/DELETE por trigger.
- Execution referencia obrigatoriamente `specification_id`.
- Approval registra tipo, ID, versão e hash do alvo aprovado.
- Approval distingue ator `USER|SYSTEM` e canal `TELEGRAM|DASHBOARD|POLICY`.
- Cada chamada deliberativa registra agente, modelo, tokens, custo estimado e
  latência em `llm_calls`.
- Chunks do worker e consumo lógico Codex são persistidos separadamente.
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
