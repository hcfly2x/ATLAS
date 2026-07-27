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
- O retorno do QA a `SPECIFYING` publica ao autor Telegram uma mensagem
  idempotente por Task e versão, com resumo, ações requeridas e próximo passo.
  A publicação não dispara supervisor, não cria Specification e não repete a
  Execution rejeitada.
- A perda de lease pelo worker encerra a execução local de forma fail-closed,
  interrompe Codex quando necessário e limpa a worktree. O worker não continua
  renovando, finalizando ou repetindo uma Assignment cuja posse deixou de poder
  comprovar; o reconciliador durável do coordinator trata o estado ambíguo.
- A unificação da dashboard em um único destino web no coordinator do Render
  está preparada em PR próprio: exige flag explícita e Bearer token e mantém
  dados/rotas somente leitura. Ainda não está habilitada nem autoriza escrita de
  configuração, agentes ou times.

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

## Decisões vigentes

- ADRs 001–012 aceitos; ADRs 013–017 permanecem Propostos.
- ADR-003 é aplicado com pareceres independentes, supervisor consolidando e no
  máximo duas rodadas.
- GPT-5.6 Luna é o default configurável dos pareceristas; GPT-5.6 Terra permanece
  o modelo do supervisor.

## Riscos remanescentes

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

Revisar a decisão pura de enforcement em `@atlas/core`. A nova fronteira produz
`allow|deny|require_human`, códigos estáveis, evidência normalizada e hashes
canônicos, mas nenhum caller usa essa função ainda. A migração de callers e a
persistência de AuditEvent continuam entregas separadas. Não iniciar a Fase 8
ou ampliar autonomia.

## Restrições ativas

- não iniciar a Fase 8;
- não iniciar a Fase 8 ou ampliação de autonomia;
- não iniciar novos blocos de estabilização além do QA pós-execução em revisão;
- não implementar skills, personas, modo consulta, scheduler ou webhooks;
- não provisionar staging/produção nem criar `render.yaml`;
- não alterar ADRs aceitos ou os status Propostos dos ADRs 013–017;
- não executar deploy nem integrar credenciais reais.
