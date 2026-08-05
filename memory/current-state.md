# Estado Atual

## Fase

Bloco C e Fase 7 — Conselho multiagente — estão integrados na `main` como
v0.0.14. A Fase 8 não está autorizada. Correções pós-piloto e a entrega de
resultado terminal ao autor via Telegram estão integradas na `main`.

A política de entrega proporcional ao risco e `autonomy_level: 3` para o
projeto ATLAS estão integrados na `main`. O Bloco 2 — runtime reproduzível por
projeto — também está integrado. O Bloco 3 — recuperação durável — está
integrado. QA pós-execução também está integrado; isso não autoriza Fase 8 ou
ampliação de autonomia.

O QA empírico v1 está integrado: repete apenas verificações
declaradas/autorizadas na worktree e alimenta o revisor existente. `PASS`
permanece advisory; `FAIL|UNAVAILABLE` bloqueiam a liberação automática. Ele não
substitui Approval nem amplia autonomia. O
provedor Claude para o revisor pós-execução está integrado, com OpenAI
preservado como default e sem extensão a outros agentes. A reconciliação
independente entre os dois sinais está integrada: somente `PASS + approved`
libera o gate da Approval existente; divergência ou indisponibilidade falham
fechado. A autonomia proporcional de resultado está nesta entrega: Approval
nasce pendente, risco simples ou moderado elegível só é aprovado pela política
depois dos dois sinais, e risco crítico continua humano sem baseline de evals.

A Fase A de `delivery_mode` está integrada na `main` pelo PR #38. A Fase 1 da
paridade de comandos, a Fase B de entrega durável e a Fase C de watchdog/SLA
também estão integradas. Para paths, a decisão pura e o shadow estão integrados;
para comandos, a paridade e o shadow estão integrados e revisados. Nos dois
casos, o caller legado permanece autoritativo e o cutover está pendente.

As decisões documentais de alinhamento com o mercado e sua sequência de
avaliação estão registradas em `docs/market-alignment.md`. Esse registro não
declara capacidade concluída nem autoriza adoção, dependência, fase ou execução.

A direção documental para internalizar o papel de arquiteto e revisor está em
`docs/self-development-loop.md`. O QA empírico v1 está integrado e o provedor
Claude do revisor foi autorizado nesta entrega; as demais peças continuam sem
autorização.

O plano operacional oficial da Dashboard está em
`docs/dashboard-operational-plan.md`. Ele substitui a antiga Fase 10 monolítica
por trilhas orientadas ao workflow. A Trilha A read-only está implementada:
Mission Control, Proatividade v1 e resumo executivo determinístico
consultam somente sinais existentes, falham por bloco para `indeterminado` e não
criam rota de escrita. Narrativa por LLM continua sem autorização.
O guia subordinado `docs/dashboard-tooling.md` registra o núcleo adotável,
tooling e skills de desenvolvimento. A UI frontend da Trilha A consome esse
read-model sem refazê-lo, por GET autenticado e validação estrita de
`@atlas/contracts`. A Fase 0 permanece registrada com ADR-024 Proposto, três
skills versionadas e tooling do Codex. A Home cobre dados, vazio, erro e sinais
indeterminados sem inventar progresso e sem rota de escrita.

O backend da Trilha B1 expõe um Workspace sanitizado por demanda em
`GET /dashboard/api/demand/:taskId`, validado por `@atlas/contracts`. Ele agrega
somente conteúdo próprio permitido da demanda e metadados/códigos derivados dos
registros existentes; memória fica limitada a tipo/contagem e comandos ao
executável. A Trilha B2 também está implementada: itens do Mission Control
abrem o Workspace por URL, e a UI apresenta as seções read-only e um Replay
passo a passo somente dos eventos sanitizados. Estados loading, vazio,
indeterminado, erro e 404 são explícitos.

A Trilha C1 está implementada: o dono usa credencial exclusiva do
ambiente para criar sessão assinada e expirável em cookie HttpOnly. Toda rota
`/dashboard` exige sessão e permissão de leitura declarada no backend; rota sem
permissão falha fechado. Loopback por default e flag de acesso remoto foram
preservados. ADR-025 permanece Proposto. A Trilha C2a acrescenta a primeira
escrita governada: o dono pode decidir somente Approvals `USER` pendentes pela
Dashboard, com RBAC de escrita, CSRF por sessão, idempotência e versões
otimistas, usando o mesmo resolvedor transacional do Telegram. ADR-027 permanece
Proposto. Na UI, `request_change` fica restrito a Approval de resultado.

A C2·Serving está implementada: o coordinator publica o build React das Trilhas
A, B e C2a em `/dashboard`, com base Vite correta, deep links autenticados,
assets hasheados sob cache imutável e shell sem cache. O catch-all não sombreia
APIs ou assets inexistentes, e a página inline de Mission Control foi
aposentada. ADR-029 permanece Proposto.

Nesta entrega, a Dashboard recebe a visão read-only “Projetos” em
`/dashboard/projetos`. Cada faixa representa um projeto e organiza as demandas
em quatro situações operacionais derivadas do estado persistido e de Approval
humana pendente. Cards abrem o Workspace existente; projetos inativos ou sem
demanda ativa ficam recolhidos. A mesma entrega aplica uma paleta clara e
centralizada ao app React e ao login inline, sem alterar os gates de sessão,
RBAC ou qualquer escrita governada.

A aba Projetos agora separa o Plano vindo do contexto declarado das Demandas.
Checklist Markdown gera somente os estados explícitos feito e pendente; formato
livre aparece como texto sanitizado e ausência aparece como indisponível. Um
marco opcional `DASHBOARD_GO_LIVE_AT` desloca Tasks anteriores apenas para um
histórico visual recolhido. Nenhuma Task ou AuditEvent é removida ou alterada.

A gestão governada de projetos pela Dashboard está nesta entrega. Em
`/dashboard/projetos/gerenciar`, o dono pode criar rascunho seguro, conectar e
validar um repositório Git visível pelo Mac-servidor, configurar comandos,
autonomia e retenção e ativar/desativar explicitamente. O fluxo usa C1, CSRF,
recibo idempotente e auditoria sanitizada; `.atlas/projects.yaml` segue como
fonte de verdade. Retry com a mesma intenção e o boot reconciliam a projeção
PostgreSQL pelo YAML; intenção divergente continua em conflito, e YAML inválido
aborta o startup sem alterar o banco. Qualquer projeção não arquivada ausente do
YAML — rascunho, ativa ou futura — é arquivada com auditoria sanitizada, sem
deletar Project, Task ou AuditEvent. As listagens operacionais usam os IDs
declarados e excluem arquivados, de modo que a board mostra somente projetos
reais da fonte de verdade. ADR-031 permanece Proposto. Criar demanda continua
no C2b1 e exige projeto ativo.

Nesta entrega, títulos `##` no Plano declarado passam a formar um roadmap com
seções, contagens exatas e uma barra baseada somente na razão feito/total dos
checklists. O projeto `atlas` declara em `.atlas/projects.yaml` seu roadmap
curado de Motor, Escritório, Operação e Objetivo. O read-model não consulta
Tasks nem varre repositórios para deduzir progresso; atualizar o plano continua
sendo uma edição explícita do contexto protegido.

A C2b1 está implementada sob o ADR-028 Proposto. Criar demanda pela Dashboard
usa o mesmo intake, `TaskCoreStore.createTask` e disparo do supervisor usados
pelo Telegram, com origem fixa `dashboard:owner`. Cancelar usa somente a
máquina de estados: estados pré-execução e `FAILED` terminam em `CANCELLED`;
estados ativos passam por `CANCEL_REQUESTED` e o worker continua responsável
pelo encerramento cooperativo. As rotas exigem sessão, RBAC, CSRF, idempotência
vinculada a hash e versão otimista. Um recibo mínimo, aditivo e transacional
vincula a chave tanto ao aceite quanto à rejeição, inclusive sem Task ou Project
existente, sem guardar objetivo ou motivo bruto. Conflitos atualizam o Workspace
e o Mission Control antes de uma nova tentativa; a criação também renova a lista
de projetos. C2c (pausa/retomada/prioridade) permanece separada.

O spike documental da C2c está registrado no ADR-030 e em
`docs/dashboard-c2c-migration-plan.md`. O desenho limita a pausa inicial a
`WAITING_APPROVAL|QUEUED`, restaura deterministicamente o estado anterior,
reusa o recibo C2b1 e trata prioridade com aging.

O passo C2c-1 acrescentou a rede de testes de caracterização. O passo C2c-2
acrescentou de forma inerte `PAUSED`, `pausedFromState`, `priority`,
as cinco arestas do ADR-030 e a regra pura que deriva e valida o destino de
retomada. O enum PostgreSQL é adicionado numa migration isolada; uma segunda
migration cria os metadados, constraints e índice sem `UPDATE` ou backfill.
O passo C2c-3 agora seleciona a Task antes da Execution, aplica CAS
`id+QUEUED+version` nos dois caminhos e ordena por aging fixo de 24 horas ou,
na faixa normal, por prioridade e FIFO determinísticos. `PAUSED` nunca é
selecionado. Lease e fencing preservam os valores anteriores. O passo C2c-4
passa a ser o primeiro produtor governado de `PAUSED`: pausa, retomada e
prioridade usam o recibo C2b1, RBAC/CSRF, versão otimista e auditoria
transacional. O passo C2c-5 conclui a trilha: o Workspace exibe somente os
controles válidos para o estado atual, confirma pausa/retomada e envia CSRF,
chave idempotente e versão pelos contratos existentes. Conflitos recarregam
Workspace, Mission Control e Projetos. A criação aceita somente projetos
`ACTIVE`; projetos não ativos são apresentados como rascunho com orientação
para o setup local, sem ativação automática. Próximas decisões operacionais são
ativar explicitamente os projetos necessários e decidir os cutovers de
enforcement; nenhuma delas é autorizada por esta entrega.

O loop-breaker de retrabalho pós-execução está nesta entrega. Rejeições
consecutivas pelo mesmo `reconciliationReason` continuam retornando a
`SPECIFYING` somente abaixo do limite configurado. No limiar, a Task permanece
em `WAITING_RESULT_APPROVAL`, a Approval passa a exigir humano, o worker é
liberado e uma notificação at-most-once é derivada de `Task.origin`. ADR-026
permanece Proposto; nenhuma ação é aprovada, executada ou cancelada
automaticamente.

## Implementado

- Trilha 1 (Fases 1–5), memória por projeto, Pilot Setup Wizard, visibilidade
  Telegram e dashboard somente-leitura permanecem integrados.
- A hierarquia de comando efetivamente implementada está resumida, com fontes
  rastreáveis, em `docs/command-hierarchy.md`; o documento não amplia as
  permissões, a política de aprovação ou os canais de saída existentes.
- Registro de papéis e instruções carregado de `.atlas/agents.yaml` e `agents/`;
  roteamento canônico carregado de `.atlas/routing.yaml`.
- Rotas: simples usa contexto+supervisor; moderada acrescenta arquitetura e QA;
  crítica usa Produto, contexto, arquitetura, segurança e QA antes do supervisor.
- Primeira rodada produz pareceres independentes validados por Zod.
- Supervisor detecta somente divergências materiais, solicita no máximo uma
  segunda rodada focada e consolida sem votação por maioria.
- Revisor e emissor da Specification são papéis distintos; modelos de parecer e
  supervisor podem ser configurados separadamente.
- `Deliberation` e `AgentOpinion` persistidos; pareceres são append-only e cada
  parecer/início/conclusão de rodada gera AuditEvent com `task_id` e
  `correlation_id`.
- A máquina de estados não mudou: o conselho ocorre dentro de `SPECIFYING`.
- O piloto confirmou entrada Telegram, supervisão, allowlist e execução do
  worker; bloqueios de disparo do supervisor, falha LLM terminal, reconexão do
  worker e sandbox de escrita do Codex foram tratados em correções pós-piloto.
- O coordinator passa a publicar o resultado terminal de uma Task Telegram no
  chat codificado em sua origem: resumo, paths alterados, PR quando existir e
  `failure_stage` em falhas. A chave de entrega é persistida antes do envio para
  impedir duplicação após reinício; origens legadas de conversa privada usam o
  `user_id` como chat. Ausência de canal também gera AuditEvent.
- A entrega terminal usa outbox persistente por Task e versão, separando
  aprovação do conteúdo de confirmação do transporte. Somente falha
  comprovadamente anterior ao despacho recebe retry limitado; ambiguidade ou
  claim expirado resulta em `DELIVERY_FAILED` sem alterar o estado da Task.
- O watchdog da Fase C observa falha, SLA vencido e Task terminal sem outbox,
  cria alerta auditado idempotente e expõe metadados seguros na dashboard. Ele
  não altera estados nem reenvia mensagens.
- A seleção do result-publisher compara a claim legada com a versão terminal
  atual; uma chave de versão anterior não impede a criação da nova outbox.
- A direção de longo prazo está registrada como organização autônoma de agentes.
  A única peça estrutural ausente é QA pós-execução; runtime reproduzível e
  recuperação durável devem precedê-la, e ela deve preceder qualquer ampliação
  de autonomia.
- A profundidade de revisão passa a ser proporcional ao risco, com CI verde em
  toda integração e merge em lote apenas para PRs independentes já aprovados.
- O runtime opcional por Project declara bootstrap, validate, allowlist,
  `forbidden_commands` e timeout. O worker executa bootstrap antes do Codex e
  limpa a worktree em sucesso, falha e cancelamento; nenhum bootstrap é inferido.
- O Bloco 3 retoma idempotentemente Tasks ainda em `NEW` no startup
  do coordinator. Ele também reconcilia leases expirados de Execuções em
  `RUNNING`, `TESTING`, `CANCEL_REQUESTED` e `FINALIZING`: cerca o executor,
  encerra Task e Execution de forma auditada e libera capacidade sem reexecutar
  Codex nem assumir estado externo de Git/PR.
- QA pós-execução persiste um parecer versionado e correlacionado por Execution
  antes de liberar `FINALIZING`. O revisor usa papel distinto do supervisor;
  rejeição ou indisponibilidade retornam a Task a `SPECIFYING`, preservando o
  retrabalho por nova Specification e impedindo entrega final do resultado.
- A evidência `EmpiricalReview` é imutável e sanitizada; seu veredito
  `pass|fail|unavailable` é reconciliado com a decisão do revisor. `PASS` nunca
  aprova sozinho; `FAIL|UNAVAILABLE` impedem a liberação automática.
- O `PostExecutionReview` final registra os dois sinais e um motivo estável.
  Somente `PASS + approved` produz status aprovado; rejeição, divergência, sinal
  ausente ou erro retornam para revisão humana/retrabalho. A Approval de
  resultado continua sendo um gate separado.
- A Approval de resultado nasce pendente. Em risco `simple|moderate`, níveis
  2–3, testes verdes, evidência `PASS`, ausência de paths protegidos e ações
  sensíveis permitem candidata de política, decidida somente depois do reviewer
  aprovado. Resultado crítico continua humano até evals versionados e
  autorização próprios.
- O revisor pós-execução pode selecionar Claude por configuração própria. A
  ausência da seleção mantém OpenAI; Claude usa endpoint fixo, saída estruturada
  revalidada por Zod e erros sanitizados. Supervisor, conselho, normalizador e
  roteador continuam no runtime OpenAI.
- O retorno do QA a `SPECIFYING` publica ao autor Telegram uma mensagem
  idempotente por Task e versão, com resumo, ações requeridas e próximo passo.
  A publicação não dispara supervisor, não cria Specification e não repete a
  Execution rejeitada.
- A perda de lease pelo worker encerra a execução local de forma fail-closed,
  interrompe Codex quando necessário e limpa a worktree. O worker não continua
  renovando, finalizando ou repetindo uma Assignment cuja posse deixou de poder
  comprovar; o reconciliador durável do coordinator trata o estado ambíguo.
- A dashboard usa um único destino web no coordinator do Render, exige flag
  explícita para acesso remoto, sessão expirável e RBAC backend
  deny-by-default. Dados e rotas de domínio permanecem somente leitura; ela não
  autoriza escrita de configuração, agentes ou times.
- A Home Mission Control expõe somente metadados seguros de trabalho: aprovações
  humanas pendentes, etapas reais, bloqueios, conclusões recentes, entrega,
  retrabalho, revisão indisponível e custo contra teto declarado. O resumo não usa LLM,
  progresso não vira percentual inventado e ETA/dúvidas sem sinal ficam
  `indeterminado`.
- O primeiro caller de paths protegidos executa a decisão pura em modo shadow.
  `findProtectedPathMatches` continua autoritativo e produz o mesmo
  `protected_path_matches`; o shadow apenas registra decisão, hashes e se a
  divergência é igual, mais estrita ou indevidamente mais permissiva. Falha do
  shadow não afeta execução, finalização ou lease.
- O perfil protegido `atlas` cobre arquivos `.env*` na raiz e em subdiretórios
  com `**/.env*`, de forma equivalente na área semântica `secrets` e em
  `effective_globs`. O caller legado permanece case-sensitive até cutover
  próprio.
- A decisão pura de enforcement está integrada em `@atlas/core`, com
  `allow|deny|require_human`, precedência fail-closed, matching protegido
  case-insensitive, evidência normalizada e hashes canônicos. Nenhum AuditEvent
  novo foi introduzido.
- A decisão pura de comandos reproduz o gate legado de ferramentas GNU
  declaradas, além de token seguro, precedência da negação e allowlist exata.
  `parseSpecificationCommand` continua no caller e
  `authorizeCommands`/`authorizeRuntimeCommands` permanecem autoritativos. O
  shadow de comandos apenas compara cada decisão, não registra argumentos crus
  e falha sem afetar o caminho legado.
- O classificador de `delivery_mode` usa uma única fonte de formas verbais para
  detectar mudança e neutralizar negações. Entregáveis textuais com mudança
  apenas futura usam `answer_only`; mudança efetiva não negada e ambiguidade
  continuam em `repository_change`.

## Testes e validações

- Migração aplicada sobre PostgreSQL local e testes de integração aprovados.
- `pnpm validate` aprovado com 72 testes unitários/contrato; 8 testes de
  integração PostgreSQL também aprovados.
- Persistência de pareceres, AuditEvents e trigger append-only exercitadas no
  banco real.
- Testes unitários cobrem configuração, roteamento moderado, independência do
  supervisor, segunda rodada focada, contratos Zod e limite de rodadas.
- No PR do Bloco 2, `pnpm test`, typecheck, lint, formatação e build passaram.
- No Bloco 3, testes unitários e typecheck do coordinator passaram; os cenários
  de recuperação com PostgreSQL fazem parte de `test:integration` e serão
  executados pela CI em PostgreSQL limpo.
- Na correção do classificador da Fase A, o corpus adversarial e a propriedade
  afirmativa/negada passam em 26 testes focados; `pnpm validate` também passa,
  incluindo 104 testes do coordinator.
- Na Fase B, testes unitários cobrem retry limitado, backoff, ambiguidade,
  crash entre despacho e persistência, idempotência e sanitização; a integração
  PostgreSQL cobre unicidade, tentativas, confirmação e reconciliação.
- Na Fase 1 de comandos, testes de paridade exercitam a decisão pura contra os
  autorizadores legados, incluindo GNU declarado/não declarado, tokens
  inseguros, negação e allowlist exata.
- No shadow de comandos, o corpus cobre os dois callers, decisões permitidas e
  negadas, múltiplos comandos, divergências artificiais nas duas direções,
  falha da decisão/logger, ausência de mutação e não-vazamento de argumentos.
- No adaptador Claude do revisor, testes cobrem endpoint único, saída
  estruturada, seleção default, diversidade de runtime, timeout,
  indisponibilidade, recusa, resposta inválida e ausência de conteúdo remoto
  nos erros.
- Na reconciliação independente, testes cobrem a matriz completa, sinal ausente,
  códigos sanitizados e mensagem de retrabalho não contraditória. O PostgreSQL
  real validou a migração aditiva, a persistência dos dois sinais e a
  imutabilidade do review final; as 15 integrações passaram.
- Na Fase C, testes unitários cobrem SLA, idempotência, projeção segura da
  dashboard e ausência de mutação; integração PostgreSQL cobre os três sinais
  operacionais e a unicidade do alerta.

## Decisões vigentes

- ADRs 001–012 aceitos; ADRs 013–023 permanecem Propostos.
- ADR-003 é aplicado com pareceres independentes, supervisor consolidando e no
  máximo duas rodadas.
- GPT-5.6 Luna é o default configurável dos pareceristas; GPT-5.6 Terra permanece
  o modelo do supervisor.

## Riscos remanescentes

- A classificação de `delivery_mode` é conservadora e lexical: formulações
  incomuns podem cair em `repository_change`, mas nunca ampliam o canal de
  entrega; o guard então exige repositório configurado.
- A dashboard não oferece resolução ou reenvio; qualquer ação administrativa
  futura exige fase própria.
- Os shadows de paths e comandos ainda precisam de amostras reais versionadas
  com zero `MORE_PERMISSIVE`. Até cutovers separados, os autorizadores legados
  continuam sendo as únicas decisões efetivas do worker.
- A diversidade de provedor do revisor ainda precisa de avaliação real de
  qualidade, latência, custo e concordância antes de influenciar autonomia.
- O gate crítico de autonomia proporcional permanece fechado: não há baseline
  versionado de evals nem configuração capaz de liberá-lo.
- A reconciliação independente continua conservadora: indisponibilidade de
  qualquer sinal exige revisão humana/retrabalho e pode gerar falso negativo,
  mas nunca libera resultado sem as duas confirmações.
- Queda do coordinator no meio de uma rodada pode deixar Deliberation em
  `RUNNING` e Task em `SPECIFYING`; reconciliação retomável foi registrada para
  a Fase 11.
- O custo e a latência crescem com a complexidade e com a segunda rodada; o teto
  mensal existente continua bloqueando novas deliberações, sem interromper uma
  Task já iniciada.
- A escrita real do Codex em worktree exigiu rebuild dos packages: a tentativa
  anterior executou o `dist` antigo do adapter.
- A validação em worktree limpa de um projeto real ainda depende de configurar
  explicitamente seu `runtime`; a ausência desse bloco mantém o modo legado e
  nunca autoriza instalação implícita de dependências.
- A recuperação de deliberação interrompida permanece planejada para a Fase 11;
  o Bloco 3 não redelibera Tasks que já saíram de `NEW`.

## Próximo passo

Revisar empiricamente o C2c-4: recibos aceitos e rejeitados, restauração por
`pausedFromState`, CAS, `pause × claim`, `pause × Approval`, RBAC/CSRF e
sanitização. O passo 5 — read-model e UI — continua sem autorização.

## Restrições ativas

- não iniciar a Fase 8;
- não iniciar a Fase 8 nem ampliar autonomia além da decisão proporcional
  autorizada nesta entrega;
- não iniciar trabalho além das fases de comandos e entrega durável
  explicitamente autorizadas;
- não adicionar retry ou reenvio administrativo à Fase C;
- não iniciar cutover de paths ou comandos sem amostra limpa, fase própria e
  autorização explícita;
- não implementar skills, personas, modo consulta, scheduler ou webhooks;
- não provisionar staging/produção nem criar `render.yaml`;
- não alterar ADRs aceitos ou os status Propostos dos ADRs 013–023;
- não executar deploy nem integrar credenciais reais.
- não usar o adaptador Claude em supervisor, conselho ou qualquer agente fora
  do revisor pós-execução;
- não iniciar abstração genérica de provedor ou ampliar a autoridade do QA.
- não liberar Approval automática de resultado crítico sem evals versionados,
  ADR e autorização próprios.
