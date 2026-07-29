# Changelog

## Unreleased — loop-breaker de retrabalho pós-execução

- `ATLAS_MAX_AUTOMATIC_REWORK` limita rejeições consecutivas pelo mesmo código
  determinístico e falha no startup quando não é inteiro positivo.
- Abaixo do limiar, o QA mantém o retorno atual para `SPECIFYING`; no limiar, a
  Task permanece em `WAITING_RESULT_APPROVAL`, o worker é liberado e a Approval
  pendente passa a exigir decisão humana.
- A escalada gera AuditEvent sanitizado, aparece em “Precisam de você” pela
  Approval e notifica uma única vez o destino derivado de `Task.origin`.
- ADR-026 permanece Proposto. Não há estado, entidade ou migração nova e não há
  autoaprovação, finalização, execução, cancelamento, merge ou deploy.

## Unreleased — Dashboard Trilha C1 autenticação e RBAC

- A credencial do dono passa a existir somente em
  `DASHBOARD_OWNER_CREDENTIAL`; ela cria uma sessão assinada e expirável
  transportada em cookie `HttpOnly`, `SameSite=Strict` e `Secure` no acesso
  remoto.
- Um gate backend cobre toda rota `/dashboard`, exige permissão de leitura
  declarada e nega por default rotas sem declaração. Não autenticado e sessão
  expirada retornam 401; falta de permissão retorna 403 antes dos dados.
- Home Mission Control e Workspace/Replay preservam seus read-models, agora sem
  Bearer no fragmento, bundle ou JavaScript. Logs e auditoria registram somente
  desfechos sanitizados de autenticação.
- ADR-025 permanece Proposto. Não há migração, nova entidade, rota de escrita de
  domínio ou mudança em Task, Approval, máquina de estados, `always_human`,
  autonomia, enforcement, worker ou `.atlas/**`; C2 continua não autorizada.

## Unreleased — Dashboard Trilha B2 Workspace e Replay

- A Home Mission Control passa a abrir o Workspace read-only por demanda em
  `/demand/:taskId`, preservando o fragmento de autenticação na navegação.
- `apps/dashboard` consome somente `GET /dashboard/api/demand/:taskId` e valida a
  resposta estrita com `demandWorkspaceResponseSchema`.
- O Workspace apresenta cabeçalho, visão geral, plano, execuções limitadas ao
  executável, aprovações, QA, evidências de entrega, custos estimados e Replay
  passo a passo de eventos persistidos.
- Loading, vazio, erro, 404 e sinais `indeterminado` são explícitos. Campos
  extras ou conteúdo bruto invalidam o contrato e nunca são renderizados.
- Não há rota ou controle de aprovação, edição, pausa ou cancelamento. Backend,
  schema, `.atlas/**`, estados, autonomia, `always_human` e enforcement
  permanecem inalterados; a escrita segue exclusiva da Trilha C não autorizada.

## Unreleased — Dashboard Trilha B1 read-model do Workspace

- O coordinator passa a expor `GET /dashboard/api/demand/:taskId` sob a mesma
  autenticação e exposição da Dashboard, sem rota de escrita.
- `@atlas/contracts` define uma resposta estrita para cabeçalho, plano,
  execuções, aprovações, QA, timeline, memória por contagem e custo estimado.
- Objetivo, estratégia e critérios próprios da demanda são projetados; comandos
  ficam limitados ao executável e payloads, argumentos, prompts, respostas,
  saídas cruas, conteúdo de memória e destinos permanecem excluídos.
- Demanda inexistente produz 404 estável e sinais ausentes aparecem como
  `indeterminado`.
- Worker, core, enforcement, schema, `.atlas/**`, TaskState, autonomia e
  `always_human` permanecem inalterados. A UI e o Replay ficam para a Trilha B2.

## Unreleased — Dashboard Trilha A UI

- `apps/dashboard` passa a consumir somente
  `GET /dashboard/api/mission-control` com Bearer token mantido no fragmento do
  navegador e resposta validada estritamente por `@atlas/contracts`.
- A Home read-only apresenta Atlas Intelligence determinística, prioridade,
  atenção humana, execução, bloqueios, conclusões e riscos/proatividade.
- Loading, vazio, erro e indisponibilidade por bloco são explícitos; ausência de
  sinal nunca vira progresso, custo ou ETA inventado.
- Testes cobrem contrato, não-vazamento, ausência de ações, acessibilidade em
  Chromium, comportamento responsivo e diagnóstico do React Doctor.
- Coordinator, worker, core, schema, `.atlas/**`, TaskState, `always_human`,
  autonomia e enforcement permanecem inalterados.

## Unreleased — Dashboard Fase 0

- ADR-024 registra como Proposto o stack frontend autorizado para a preparação.
- `apps/dashboard` builda e testa um shell React/Vite estritamente sem dados,
  ações ou feature da Trilha A.
- `@atlas/contracts` valida com Zod o wire format real do Mission Control e
  rejeita campos inesperados.
- Três skills de desenvolvimento e o shadcn MCP ficam versionados com
  guardrails de escopo, contratos e QA.
- Coordinator, worker, core, schema, `.atlas/**`, TaskState, `always_human`,
  autonomia e enforcement permanecem inalterados.

## Unreleased — tooling, stack e skills da Dashboard

- O plano oficial passa a registrar o núcleo adotável de frontend, o pacote
  compartilhado `@atlas/contracts`, o tooling de desenvolvimento e três skills
  próprias do ATLAS para o Codex.
- A Fase 0 — ADR do stack, scaffolds, contratos, skills e tooling — fica
  registrada como o próximo passo anterior à UI, sem autorização de execução.
- A UI planejada consumirá o read-model do PR #52; não o reimplementará nem
  criará backend, banco ou fonte de verdade paralelos.
- `docs/dashboard-tooling.md` é guia subordinado aos documentos canônicos.
  Nenhum código, dependência, instalação, skill executável, schema, ADR aceito,
  política, autonomia, `.atlas/**` ou estado foi alterado.

## Unreleased — Dashboard Trilha A read-only

- Mission Control reúne atenção humana, trabalho em execução, bloqueios,
  conclusões recentes, riscos e prioridade em uma projeção GET.
- Proatividade v1 deriva aprovações humanas, entrega/SLA, retrabalho, QA
  indisponível e custo acima do teto declarado somente de registros existentes.
- Atlas Intelligence v1 usa regras determinísticas, sem LLM; ausência de sinal,
  ETA e dúvidas sem fonte verificável aparecem como `indeterminado`.
- Queries antigas da dashboard passam a omitir conteúdo bruto e retornam apenas
  metadados seguros.
- Não há schema, migração, cache, rota de escrita ou mudança em TaskState,
  `always_human`, autonomia, enforcement, QA ou entrega.

## Unreleased — autonomia proporcional de resultado

- Toda Approval de resultado nasce pendente; a decisão automática ocorre
  somente depois de `EmpiricalReview.PASS + reviewer approved`.
- Uma decisão pura limita a candidata de política a risco `simple|moderate`,
  níveis 2–3, testes verdes, ausência de paths protegidos e ausência de ações
  sensíveis.
- Resultado crítico permanece humano enquanto não houver baseline versionado
  de evals, ADR e autorização próprios.
- QA rejeitado ou indisponível invalida a Approval pendente antes do retrabalho.
- ADR-023 registrado como Proposto. `always_human`, TaskState, merge, deploy,
  retry e `.atlas/**` permanecem inalterados.

## Unreleased — reconciliação independente do QA pós-execução

- `PostExecutionReview` persiste separadamente o veredito empírico, a decisão
  do revisor e um código estável de reconciliação.
- Somente `PASS + approved` produz review aprovado e alcança a Approval de
  resultado já existente. `FAIL`, `UNAVAILABLE`, rejeição, sinal ausente ou
  erro falham fechado e seguem para revisão humana/retrabalho.
- Falhas persistem somente códigos sanitizados; a notificação de retrabalho não
  apresenta como aprovado um resultado bloqueado pela evidência empírica.
- A migração é aditiva e os campos permanecem nulos para registros históricos.
  Máquina de estados, lease, fencing, enforcement, `always_human`, merge e
  deploy não mudaram.
- ADR-022 registrado como Proposto.

## Unreleased — plano operacional oficial da Dashboard

- A Dashboard passa a ser o produto e ambiente operacional principal; Telegram
  e outros canais permanecem como entrada e notificação.
- O roadmap substitui a antiga Fase 10 monolítica por um plano orientado ao
  workflow, com Mission Control, Workspace da Demanda e trilhas A–E.
- Atlas Intelligence, Proatividade e a Home começam pelo desenho somente
  leitura; escrita e aprovações pela UI permanecem atrás de autenticação, RBAC,
  auditoria, `Approval` e `always_human`.
- O plano é oficial, mas nenhuma trilha, ADR ou implementação foi autorizada.
  Código, schema, dependências, política, autonomia, `.atlas/**`, enforcement e
  estados permanecem inalterados.

## Unreleased — provedor Claude para o revisor pós-execução

- O revisor pós-execução pode selecionar Claude por configuração, enquanto
  supervisor, normalizador, roteador e conselho permanecem no runtime OpenAI.
- Sem seleção, o comportamento OpenAI atual é preservado. Seleção Claude exige
  chave somente no ambiente do coordinator e usa endpoint Anthropic fixo.
- Saída JSON estruturada é revalidada por Zod; timeout, indisponibilidade,
  recusa, truncamento ou resposta inválida seguem o fluxo de QA indisponível com
  código sanitizado e sem aprovação automática.
- ADR-021 registrado como Proposto. Não há mudança em máquina de estados,
  `always_human`, autonomia, enforcement, `.atlas/**`, merge ou deploy.

## Unreleased — QA empírico v1 advisory

- O worker repete instalação com lockfile congelado e validação declarada na
  worktree entregue, usando a allowlist/enforcement existentes, e confere o diff
  contra o escopo da Specification.
- A evidência limitada é persistida em `EmpiricalReview` imutável com veredito
  `pass|fail|unavailable` e alimenta o revisor pós-execução existente.
- Falha, timeout ou indisponibilidade do probe não altera execução, lease,
  fencing, máquina de estados ou finalização e nunca aprova sozinho.
- ADR-020 registrado como Proposto. Não há mudança de autonomia, `always_human`,
  `.atlas/**`, merge ou deploy.

## Unreleased — reconciliação documental do enforcement

- O estado documentado passa a refletir os callers reais do worker: paths usam
  decisão pura em shadow e comandos usam a decisão com paridade em shadow.
- Nos dois fluxos, o autorizador legado continua sendo a decisão efetiva; os
  cutovers de paths e comandos permanecem pendentes de amostra real versionada
  sem `MORE_PERMISSIVE`, fase própria e autorização explícita.
- Nenhum código, caller, enforcement, política, autonomia, `.atlas/**` ou estado
  foi alterado.

## Unreleased — loop de auto-desenvolvimento

- Registrada em `docs/self-development-loop.md` a direção para internalizar o
  papel hoje externo de arquiteto e revisor sem autorizar implementação.
- O QA empírico proposto combina modelo e sandbox para instalar com lockfile
  congelado, executar testes e probes e comparar o diff contra a base.
- Diversidade de provedor permanece uma direção de avaliação; merge, deploy e
  revisão humana adicional de alto risco continuam como gates.
- Nenhum código, dependência, ADR, política, autonomia, `.atlas/**` ou estado
  foi alterado.

## Unreleased — alinhamento de mercado

- Registradas em `docs/market-alignment.md` as direções de avaliação para MCP,
  conhecimento documental, modelos de grafo, workers adicionais e papéis do
  escritório virtual.
- O roadmap prioriza fechar enforcement, observabilidade e evals antes de Tool
  Gateway, conhecimento documental ou expansão de workers e provedores.
- O registro não autoriza framework, dependência, ADR, fase ou implementação e
  não altera código, `.atlas/**`, política, autonomia ou máquina de estados.

## Unreleased — comandos, Fase 2: shadow dos callers

- `authorizeCommands` e `authorizeRuntimeCommands` continuam sendo a única
  decisão autoritativa; o runner devolve ou relança exatamente seu resultado.
- `decideEnforcement` observa cada comando já estruturado e registra divergência
  `none|stricter|MORE_PERMISSIVE`, executável, hashes e código de motivo.
- Argumentos, allowlists e mensagens de erro não entram no log do shadow.
  Exceção da decisão ou do logger é absorvida sem afetar execução, lease ou
  finalização.
- `parseSpecificationCommand` permanece no caller. Não há cutover, AuditEvent,
  mudança de política, estado ou `.atlas/**`.

## Unreleased — Fase C: watchdog e visibilidade da entrega

- Watchdog idempotente observa `DELIVERY_FAILED`, pendência além do SLA e Task
  Telegram terminal sem outbox da versão vigente.
- Alertas usam AuditEvent sanitizado e não alteram Task, outbox, retry ou
  máquina de estados.
- Dashboard somente-leitura passa a exibir resumo e lista segura da saúde das
  entregas, sem mensagem, destino ou ação de reenvio.
- O publisher distingue a chave legada por versão: uma claim antiga não
  mascara a outbox da versão terminal atual, que continua sendo enfileirada uma
  única vez.
- Procedimento operacional documenta inspeção humana e mantém desfechos
  ambíguos sem retry automático.

## Unreleased — Fase B: outbox de entrega durável

- O resultado terminal passa por uma outbox persistente, única por Task e
  versão, com destino derivado somente de `Task.origin`.
- Cada tentativa é registrada antes da chamada ao Telegram. Falha comprovada
  antes do despacho recebe backoff limitado; desfecho ambíguo ou claim expirado
  termina em `DELIVERY_FAILED` sem reenvio.
- Approval do conteúdo e confirmação `DELIVERED` permanecem registros
  distintos, com AuditEvents idempotentes por tentativa e desfecho.
- A migração é aditiva e preserva os campos legados para rollback sem
  duplicação. Máquina de estados, finalização, lease, fencing e retry do
  trabalho permanecem inalterados.
- ADR-019 foi criado como Proposto. Watchdog/SLA e dashboard da falha ficam para
  a Fase C.

## Unreleased — comandos, Fase 1: paridade da decisão pura

- `decideEnforcement` passa a receber a lista de ferramentas GNU declaradas e o
  conjunto de executáveis GNU-only para reproduzir o gate do autorizador legado.
- A precedência de comandos permanece fail-closed: token seguro, gate GNU,
  negação por executável ou match exato e, por fim, allowlist exata.
- Testes de paridade executam a decisão pura e
  `authorizeCommands`/`authorizeRuntimeCommands` sobre o mesmo corpus, incluindo
  a propriedade de nunca liberar o que o legado nega.
- `parseSpecificationCommand` permanece no caller. Nenhum caller, shadow,
  cutover, AuditEvent, path, política ou estado foi alterado.

## Unreleased — Fase A: delivery mode

- Specification passa a persistir `delivery_mode=answer_only|repository_change`
  com migração aditiva e default legado `repository_change`.
- O supervisor classifica planejamento/análise sem mudança como `answer_only`,
  mantém pedidos de alteração e ambiguidades em `repository_change` e rejeita
  contratos sem destino antes da fila.
- O classificador deriva detecção e neutralização de negações do mesmo léxico;
  imperativos negados e implementação citada como objetivo futuro de um
  entregável textual não são tratados como mudança efetiva.
- QA aceita diff vazio em `answer_only`; o worker finaliza sem commit/PR e o
  result-publisher entrega o texto aprovado somente ao chat de `Task.origin`,
  com chave por Task, versão e estado.
- ADR-018 foi criado como Proposto. Máquina de estados, autonomia,
  `always_human`, enforcement e `.atlas/**` permanecem inalterados.

## Unreleased — cobertura de `.env*` aninhado

- O perfil protegido `atlas` substitui `.env*` por `**/.env*` na área semântica
  `secrets` e em `effective_globs`, cobrindo raiz e subdiretórios sem alterar
  `matchBase` globalmente.
- Testes de contrato comprovam equivalência dos dois pontos, carregamento pelo
  coordinator, cobertura do matching legado e não-match de controle.
- Nenhum conteúdo `.env*`, caller, política, autonomia ou estado foi alterado.

## Unreleased — shadow do caller de paths protegidos

- O runner mantém `findProtectedPathMatches` como decisão autoritativa e observa
  `decideEnforcement` em paralelo nos caminhos de sucesso e falha.
- Cada avaliação bem-sucedida gera log estruturado local correlacionado à Task e
  Execution, com decisão, motivo, hashes e divergência
  `none|stricter|MORE_PERMISSIVE`; erro do shadow ou do logger não afeta o
  resultado do worker.
- Testes adversariais comprovam que `protected_path_matches` permanece
  byte-idêntico e que as divergências esperadas ocorrem somente na direção mais
  estrita.
- Nenhum cutover, caller de comandos, AuditEvent, política, estado ou `.atlas/**`
  foi alterado.

## Unreleased — escopo de cobertura de `.env*`

- Documentado o gap de `.env*` aninhado causado pela combinação do glob atual
  com `matchBase: false`.
- Proposta uma entrega separada para substituir `.env*` por `**/.env*` nos dois
  pontos equivalentes do perfil `atlas`, com testes de contrato.
- `.atlas/**`, callers, política, autonomia e runtime não foram alterados.

## Unreleased — decisão pura de enforcement

- `@atlas/core` passa a expor decisão pura `allow|deny|require_human` com códigos
  estáveis, evidência normalizada e hashes via `canonicalPayloadHash`.
- Paths absolutos, traversal externo e separadores não POSIX falham fechados;
  globs protegidos são avaliados sem distinção de maiúsculas/minúsculas.
- A entrada é ordenada e deduplicada deterministicamente, preservando os paths
  originais como evidência.
- Nenhum caller, AuditEvent, política, nível de autonomia ou estado foi alterado.

## Unreleased — caracterização do enforcement atual

- Testes registram repetibilidade e imutabilidade da autorização de comandos,
  precedência de negação e matching exato da allowlist.
- Matching de paths fica caracterizado como lexical, sensível a separadores,
  sem normalização de traversal e preservando ordem/duplicatas.
- Nenhum caller ou comportamento de runtime foi alterado.

## Unreleased — escopo de enforcement determinístico

- Corrigido o gap analysis para refletir QA pós-execução e entregas Telegram já
  integrados.
- Definidos objetivo, precedência, critérios mensuráveis, fora de escopo e plano
  incremental do próximo bloco, sem alteração comportamental ou de política.

## Unreleased — feedback Telegram de retrabalho do QA

- Tasks Telegram devolvidas pelo QA a `SPECIFYING` recebem resumo, ações
  requeridas e próximo passo no chat derivado exclusivamente de `Task.origin`.
- A claim usa AuditEvent idempotente por Task e versão antes do envio; falha,
  ausência de canal e sucesso também são auditados.
- A publicação não cria nova Specification ou Execution, não chama o supervisor
  e não introduz retry funcional automático.

## Unreleased — dashboard web única

- Dashboard somente-leitura pode ser exposta no Render somente mediante flag
  explícita e Bearer token com pelo menos 32 caracteres; sem a flag, permanece
  restrita ao loopback.
- A dashboard web usa o mesmo banco do fluxo Telegram, sem segunda instância
  operacional local, sem rotas de escrita e com headers adicionais de proteção.

## Unreleased — hotfix de perda de lease do worker

- Falha de renovação de lease agora encerra a execução local de forma
  fail-closed, interrompe Codex se necessário e para o timer de renovação.
- O worker não entra mais em loop de `409`, não finaliza nem reexecuta uma
  Assignment após perder a capacidade de provar posse do lease; a reconciliação
  durável do coordinator continua sendo a autoridade para o estado ambíguo.

## Unreleased — QA pós-execução

- Adicionado parecer pós-execução persistido, versionado e correlacionado à
  Task, Execution e Specification; o revisor é distinto do supervisor e usa o
  contrato Zod compartilhado.
- Resultados de worker passam por `WAITING_RESULT_APPROVAL` para QA antes de
  `FINALIZING`; QA reprovado ou indisponível retorna a Task a `SPECIFYING` sem
  entregar resultado nem reexecutar a mesma Execution.
- Registrado consumo de LLM, hash canônico, AuditEvents e claim com expiração
  do parecer para preservar custo, idempotência e recuperação segura.

## Unreleased — Bloco 3: recuperação durável

- Startup do coordinator retoma idempotentemente Tasks ainda em `NEW`, cobrindo
  a queda entre a captura Telegram e o disparo do supervisor.
- Leases expirados em execução, teste, cancelamento ou finalização são cercados
  com fencing e convertidos em falha auditada; nenhuma Execution é criada e
  Codex nunca é reexecutado sob lease ambíguo.
- A recuperação libera a capacidade do worker somente após a transação de Task,
  Execution e AuditEvents; cenários `RUNNING` e `FINALIZING` entraram na suíte
  de integração PostgreSQL.

## Unreleased — Bloco 2: runtime reproduzível por projeto

- `Project.runtime` opcional passou a declarar package manager, bootstrap,
  validate, allowlist, comandos proibidos e timeout por projeto.
- Worker reutiliza a allowlist existente para bootstrap e validate; negações
  duras prevalecem e não há inferência de instalação de dependências.
- Bootstrap ocorre antes do Codex, registra comandos/exit codes no resultado
  auditável, classifica falha como `bootstrap` e timeout como falha técnica.
- Worktree é removida em sucesso, falha e cancelamento; projeto sem runtime
  mantém o comportamento legado.

## Unreleased — fluxo de entrega proporcional ao risco

- Projeto `atlas` configurado com `autonomy_level: 3`; a lista `always_human`
  permanece inalterada.
- Política de merge proporcional ao risco e procedimento de merge em lote
  documentados, mantendo CI verde obrigatório.
- Aceleração do fluxo não autoriza pular runtime reproduzível ou recuperação
  durável.

## Unreleased — entrega de resultado Telegram

- Coordinator publica o resumo terminal no chat Telegram de origem, incluindo
  estado, paths, PR e estágio de falha quando aplicável.
- A publicação recebe chave persistida por Task/estado e AuditEvents para claim,
  envio, falha ou ausência de canal; envio genérico permanece bloqueado.
- Origens legadas de conversa privada (`telegram:user_id`) permanecem entregáveis
  ao usar o `user_id` como `chat_id`; a publicação limita-se a `COMPLETED` e
  `FAILED` e adota `at-most-once` para não duplicar após reinício.

## Unreleased — estabilização e direção de organização

- Disparo automático de supervisão para Tasks Telegram e falha LLM terminal
  foram corrigidos e integrados na `main`.
- Supervisor passou a limitar comandos da Specification à allowlist persistida
  do Project.
- Worker ganhou recuperação com backoff exponencial para indisponibilidade
  transitória do coordinator e término explícito em erros permanentes.
- Codex adapter passou a iniciar em sandbox `workspace-write` limitado à
  worktree, sem bypass.
- Procedimento de piloto passou a exigir rebuild dos packages antes de validar o
  worker manualmente.
- Planejamento passou a registrar a organização-alvo de agentes e a sequência
  obrigatória: runtime reproduzível e recuperação durável, QA pós-execução e só
  então ampliação de autonomia. O epic de QA pós-execução foi registrado sem
  autorização de implementação.

## 0.0.14

- Fase 7 — Conselho multiagente implementada em branch própria.
- Registro de papéis e roteamento por complexidade passaram a ser carregados de
  `.atlas/agents.yaml`, `agents/` e `.atlas/routing.yaml`.
- Pareceres independentes validados por Zod, detecção de divergências, segunda
  rodada focada e consolidação sem maioria simples foram adicionados.
- `Deliberation` e `AgentOpinion` foram persistidos com limite de duas rodadas,
  métricas de modelo/consumo, constraints e pareceres append-only.
- Cada parecer e cada rodada passou a gerar AuditEvent com Task e correlation
  ID; o supervisor que emite a Specification não atua como revisor.
- Modelo dos pareceristas tornou-se configurável e distinto do supervisor por
  default.

## 0.0.13

- ADR-016 criado como Proposto para skills versionadas e anexáveis a agentes.
- ADR-017 criado como Proposto para personas declaradas em documentos
  versionados.
- Epics de roadmap adicionados para modo consulta e tarefas
  agendadas/webhooks, ambos sem fase ou execução autorizada.
- Epic 07 passou a exigir revisor diferente do emissor da Specification,
  modelos distintos para revisor/supervisor e AuditEvent por parecer e rodada
  no critério de aceite.

## 0.0.12

- Preferência `/verbose 0|1|2` persistida em `TelegramSession`.
- Publicador Telegram idempotente adicionado para atividade, marcos, chunks
  persistidos com throttling e resultado final.
- Dashboard operacional somente-leitura criado em `/dashboard`, restrito ao
  loopback e com APIs protegidas por token.
- Painel passou a exibir estados canônicos, detalhe completo de Task, AuditEvent,
  custos LLM/Codex e memória por projeto.
- Sexta migração adicionou nível de verbosidade e cursores de entrega Telegram.
- Independência entre o dashboard somente-leitura e o ADR-013 registrada.
- Auditoria registrou a semântica `at-least-once` da publicação Telegram e a
  futura otimização da consulta de chunks como pendências não bloqueadoras.

## 0.0.11

- Pilot Setup Wizard simplificado para repositório e comandos de teste no fluxo
  principal, com opções avançadas recolhidas.
- Defaults alterados para US$ 2 por tarefa e retenção sensível de 7 dias.
- Versões mínimas em `required_tools` deixaram de bloquear a ativação.
- Autodetecção segura adicionada para nome/ID e comando editável a partir de
  `package.json`, `pyproject.toml` ou `Makefile`.
- Fase 6 registrada como integrada na `main` v0.0.10.

## 0.0.10

- Fase 6 — memória por projeto implementada.
- `MemoryItem` adicionado ao Prisma com Project obrigatório, Task/agente
  opcionais, hash e idempotência.
- API interna autenticada criada para memória manual, listagem e contexto.
- Context builder determinístico, limitado e fail-closed extraído em
  `@atlas/memory`.
- Supervisor passou a receber somente a memória do Project da Task.
- Finalização do worker passou a criar resumo de Task auditado atomicamente.
- Quinta migração, contratos, Epic 06 e testes de isolamento adicionados.
- Teste de integração Telegram deixou de reutilizar callback fixo entre runs.

## 0.0.9

- Pilot Setup Wizard local adicionado em `/setup`, sem antecipar o dashboard.
- Configuração lê, valida e salva `.atlas/projects.yaml` de forma atômica,
  preservando campos fora do formulário.
- Ativação exige repositório Git absoluto, ferramentas mínimas, allowlist
  estruturada, teto por tarefa e retenção coerente.
- Escritas HTTP exigem intenção explícita e toda a fronteira permanece restrita
  ao loopback.
- Seed unificado com o mesmo schema de configuração usado pelo wizard e worker.
- Scripts locais adicionados para abrir o wizard e carregar o coordinator a
  partir de `.env.local`, sem copiar ou versionar credenciais.
- Boot independente do app principal e do Prisma Client gerado, permitindo usar
  `pnpm pilot` imediatamente após a instalação das dependências.

## 0.0.8

- Fase 5 — Worker + Codex + Git concluída em branch própria.
- Divisão de responsabilidades entre Telegram e dashboard registrada.
- Worker passou a usar preflight real macOS/ARM64 e concorrência 1.
- Registro, heartbeat, long-polling, lease renovável, fencing e idempotência
  implementados.
- Resultado integral do worker validado por Zod, com chunks sanitizados,
  checksums e hashes canônicos.
- Codex CLI e Git encapsulados em adapters operacionais sem shell.
- Worktree/branch isoladas, testes, paths protegidos, cleanup e PR draft
  implementados.
- Política de resultado aplica Approval automática de sistema no nível 2 ou
  escala para aprovação humana.
- Retry técnico nível 3 condicionado a reconciliação e fencing.
- Consumo lógico Codex e teto mensal default US$ 75 persistidos separadamente.
- Quarta migração adicionou payload/hashes de resultado, chunks e uso Codex.
- Transições do resultado e da finalização passaram a usar guarda otimista de
  estado/versão e o AuditEvent canônico, preservando `CANCEL_REQUESTED`.
- Cancelamento passou a tratar também o sinal abortado antes do registro do
  listener do CodexAdapter, eliminando corrida observada no CI da `main`.

## 0.0.7

- ADR-014 criado como Proposto para níveis de autonomia 0–4 por projeto.
- Nível 2 registrado como padrão decidido para todos os projetos.
- Aprovação automática definida com Approval `actor=system`, alvo versionado,
  hashes e AuditEvent.
- Máquina conceitual ganhou apenas `TESTING → FINALIZING` quando a política
  dispensa aprovação humana de resultado.
- `autonomy_level` adicionado à configuração de projetos, com default 2.
- Política `always_human` consolidada; staging e produção passaram a ser tipos de
  deploy distintos.
- ADR-015 criado como Proposto para staging e produção separados no Render.
- Enforcement distribuído como obrigação das Fases 4–5 e infraestrutura
  pós-Fase 3, sem implementação ou provisionamento.
- Fase 4 — Supervisor mínimo concluída em branch própria.
- Interface `AgentRuntime` e implementação OpenAI adicionadas com Luna para
  normalização/classificação e Terra para Specification.
- Fluxo NEW → NORMALIZING → ROUTING → SPECIFYING implementado com auditabilidade.
- Specification passou a usar schema Zod, versão e hash canônico determinístico.
- Política de nível 2 aplicada com Approval explícita de sistema quando a
  aprovação prévia é dispensada.
- Decisão Telegram valida o `target_hash` canônico vigente e audita divergências.
- Migração adicionou autonomia do Project, ator/canal da Approval e consumo de
  LLM por chamada.
- Teto deliberativo mensal configurável bloqueia novas deliberações ao atingir o
  limite, sem interromper tarefas iniciadas.
- Grafo de código alinhado com `TESTING → FINALIZING`.

## 0.0.6

- Fase 3 — Telegram MVP concluída.
- Webhook passou a exigir secret não vazio para ser registrado; polling continua
  disponível sem expor a rota.
- Replay idempotente deixou de reenviar mensagens, preservando o
  `answerCallbackQuery` de callbacks repetidos.
- Webhook validado por handler Fastify injetável e long-polling escolhido para
  desenvolvimento sem URL pública.
- Autorização restrita a um único Telegram ID.
- Seleção de projeto, texto para Task, status, aprovação e cancelamento
  cooperativo implementados.
- Updates e callbacks persistidos com idempotência conforme ADR-012.
- Approval consumida pelo Telegram com alvo, ID, versão e hash preservados.
- Rotas internas protegidas por Bearer token obrigatório.
- Semântica de 409/retry concorrente documentada.
- Migração adicionada para sessões Telegram e replay de updates.
- `@types/node` alinhado à linha 22.

## 0.0.5

- Fase 1 aceita com ressalvas; workspace Vitest morto removido. A allowlist
  `allowBuilds` da base foi ampliada para Prisma conforme o formato exigido pelo
  pnpm 11.9.
- Fase 2 — Core mínimo do Coordinator concluída.
- Logging real Fastify/Pino com correlation ID substituiu log embutido no `/health`.
- Package `core` criado com máquina de estados canônica e concorrência otimista.
- Prisma schema e migração inicial adicionados para as sete entidades MVP.
- Idempotency keys, lease renovável e fencing token incluídos desde a primeira migração.
- Specification imutável e AuditEvent append-only protegidos por triggers PostgreSQL.
- API interna de Task criada com transições auditadas e idempotentes.
- Seed validado de projetos adicionado.
- CI ampliada com PostgreSQL, migração, seed e testes de integração.
- PostgreSQL local do ATLAS passou a usar a porta configurável 5433 por padrão.
- Repositório privado canônico registrado como `hcfly2x/ATLAS`, com fluxo de
  branch + PR e limitação atual de branch protection documentada.
- Node.js mínimo e CI alinhados em 22.13 para compatibilidade com pnpm 11.9.0.
- Fase 2 aceita sem correções de código e Fase 3 autorizada para começar somente
  após a integração sequencial das branches anteriores.
- Obrigações vinculantes registradas para autenticação interna na Fase 3, replay
  idempotente concorrente na documentação e hash canônico na Fase 4.
- Fluxo documental de ideias registrado: GitHub Issue, triagem externa, memória
  oficial e execução somente na fase correspondente.
- Fase 10 passou a registrar criação/edição de agentes e organização em times
  via interface.
- ADR-013 criado como Proposto para decidir, apenas na Fase 10, onde persistir a
  configuração de agentes editada pela UI.

## 0.0.4

- Codex confirmado no plano ChatGPT Pro.
- Teto lógico do Codex de US$ 75/mês definido para rastreamento pelo ATLAS; consumo incluído na assinatura Pro.
- Teto de US$ 25/mês da API OpenAI definido também como hard limit no dashboard do provedor.
- ADR-012 aceito na opção 1: idempotency keys, lease renovável e fencing token.
- Schema da Fase 2 obrigado a contemplar idempotência, lease e fencing desde a primeira migração.
- Epic 00 encerrado e Fase 1 — Foundation mínima autorizada explicitamente.
- Fase 1 concluída em worktree/branch isolada.
- Monorepo pnpm + Turborepo + TypeScript estrito criado com dois apps e seis packages.
- Fastify, pg-boss e Zod incorporados nas fronteiras previstas, sem feature de negócio.
- Pipeline local e CI configuradas para formatação, lint, typecheck, testes e build.
- PostgreSQL de desenvolvimento definido em Docker Compose apenas para o coordinator.
- Logging estruturado com correlation ID e restrições do worker cobertos por testes.

## 0.0.3

- Epic 00 revisado e aceito; Fase 1 permanecia não autorizada.
- Numeração das fases unificada pelo plano em duas trilhas.
- Máquina de estados revisada com SPECIFYING, FINALIZING, CANCEL_REQUESTED, failure_stage, retry técnico e retrabalho versionado.
- Specification, Approval e Execution vinculadas por versão e hash.
- Contrato documental de resultado do worker adicionado.
- Memória persistente restrita ao escopo de projeto.
- Autenticação do worker alinhada ao Bearer token do ADR-007.
- ADR-011 aceito para worker M1/macOS com concorrência 1 e perfil portátil BSD/GNU.
- ADR-012 criado como Proposto para idempotência, lease renovável e fencing token.
- Render definido para coordinator persistente e PostgreSQL gerenciado.
- OpenAI definido para deliberação: GPT-5.6 Terra padrão e GPT-5.6 Luna para normalização/roteamento.
- Tetos mensais registrados: US$ 25 para deliberação e US$ 75 para Codex no plano Pro.
- Retenção configurável por classificação, default 30 dias; auditoria sem expiração no MVP.
- Áreas protegidas mapeadas por área semântica e projetos passaram a declarar mínimos/defaults de ativação.
- Backlog realinhado às Fases 1–5 da Trilha 1; conselho movido para o Epic 07.

## 0.0.2

- Stack canônica consolidada (`project-manifest.yaml` é a fonte de verdade).
- ADRs 005–010 criados e aceitos; ADR-001 aceito.
- Modelo de dados conceitual e máquina de estados adicionados (`docs/data-model.md`).
- Plano reestruturado em Trilha 1 (MVP vertical) e Trilha 2 (expansão).
- Redis removido do MVP; conselho multiagente movido para a Trilha 2.
- Conselho de engenharia fixado em seis papéis; demais papéis marcados como futuros.
- Pendências reduzidas às que dependiam do usuário.

## 0.0.1

- Criado Project Starter Kit.
- Consolidada visão multiagente.
- Registrados projetos iniciais.
- Adicionadas políticas de segurança e execução.
# 2026-07-29 — Trilha C2a: decisões humanas pela Dashboard

- Adiciona a primeira escrita governada da Dashboard para decidir Approvals
  `USER` pendentes com approve, reject ou request_change.
- Extrai um único resolvedor transacional reutilizado por Telegram e Dashboard,
  preservando validações de hash/QA e transições canônicas.
- Acrescenta RBAC de escrita, CSRF por sessão, idempotência, concorrência
  otimista, contrato Zod e confirmação contextual na UI.
- Registra ADR-027 como Proposto; C2b, merge, deploy e `always_human` permanecem
  fora do escopo.
