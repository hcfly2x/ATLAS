# Pendências

## Dashboard — após C2b1

- Revisar empiricamente o quadro de Projetos: agrupamento completo de estados,
  precedência de Approval humana pendente, projeto inativo recolhido, navegação
  para Workspace e ausência de conteúdo sensível no contrato e na renderização.
- Validar visualmente em staging o tema claro na Home, Projetos, Workspace e
  login, em desktop e mobile, mantendo contraste AA e foco de teclado visível.

- Revisar empiricamente o C2c-4: `pause × Approval`, restauração por
  `pausedFromState`, prioridade limitada e replay aceito/rejeitado pelo recibo
  C2b1.
- Confirmar em staging que uma Task pausada pelo comando não recebe Assignment
  e que sessão, RBAC, CSRF e versões divergentes falham sem mutação.
- Manter o passo 5 não autorizado: read-model/UI de pausa, retomada e prioridade
  exige fase própria depois da revisão completa do backend.

- Revisar empiricamente approve/reject/request_change pelo mesmo resolvedor do
  Telegram, incluindo idempotência, conflito de versão e atomicidade PostgreSQL.
- Validar em staging que `/dashboard`, o Workspace por deep link e os assets
  hasheados são servidos pelo coordinator sob sessão válida, sem fallback para
  a antiga página inline.
- Confirmar em staging que sessão expirada, falta de permissão e CSRF
  ausente/inválido não produzem mutação.
- Revalidar empiricamente a correção de criação e cancelamento: recibo atômico,
  replay de rejeição, conflito divergente após rejeição, Task/Project ausente,
  versões concorrentes e auditoria sem conteúdo cru.
- Definir retenção operacional dos recibos de comandos da Dashboard em fase
  própria; nenhuma limpeza automática é autorizada nesta entrega.
- Validar em staging que criação nova aciona o supervisor uma vez e que
  cancelamento ativo passa por `CANCEL_REQUESTED` até o worker confirmar
  `CANCELLED`.
- Definir em fase própria a entrega terminal de `answer_only` originada na
  Dashboard. Até existir um destino governado, o guard atual continua
  fail-closed e não trata `dashboard:owner` como destino Telegram.
- Manter a UI de pausa, retomada e prioridade sem implementação até o passo 5
  receber autorização explícita.
- Manter merge, deploy e ações `always_human` sem exceção na Dashboard.

## Entrega durável — acompanhamento após a Fase B

- A revisão empírica da outbox, da migração e dos cenários de crash foi
  concluída; manter a Fase C condicionada a autorização explícita.
- Revisar empiricamente o watchdog/SLA, a projeção da dashboard e a ausência de
  qualquer rota de reenvio antes do merge.
- Validar no piloto que `DELIVERY_FAILED`, SLA excedido e ausência de outbox
  aparecem na dashboard e geram exatamente um alerta auditado.
- Definir somente em fase futura, com autorização própria, se algum desfecho
  comprovadamente não despachado admite ação administrativa manual.
- Manter modo consulta, bypass de worker e reclassificação de complexidade fora
  da Fase A.

## QA pós-execução — acompanhamento após integração

- Revisar empiricamente o loop-breaker: N-1 retorna a `SPECIFYING`, N mantém
  `WAITING_RESULT_APPROVAL`, motivo diferente reinicia a contagem e
  reprocessamento não duplica escalada ou notificação.
- Validar no piloto que a Approval escalada aparece uma vez em “Precisam de
  você” e que o chat de `Task.origin` recebe somente códigos e instruções
  sanitizados.
- Manter cancelamento e reespecificação como decisões humanas; C2 não é
  autorizado por esta entrega.
- Manter a revisão empírica do QA v1 como baseline: instalação congelada,
  allowlist, diff scope, sanitização, `PASS` advisory e falha fechada para
  `FAIL|UNAVAILABLE`.
- Revisar empiricamente a matriz reconciliada: somente `PASS + approved`
  alcança a Approval existente; `FAIL`, `UNAVAILABLE`, rejeição, sinal ausente
  ou erro permanecem fechados e voltam para revisão humana/retrabalho.
- Medir divergência por código de reconciliação, sem guardar conteúdo bruto, e
  manter qualquer ampliação de autonomia condicionada a evals próprios.
- Medir concordância entre `EmpiricalReview` e PostExecutionReview antes de
  considerar probes gerados, outro provedor ou qualquer papel autoritativo.
- Revisar empiricamente o adaptador Claude antes do merge: endpoint único,
  seleção restrita ao revisor, fallback default OpenAI, falha fechada e ausência
  de prompt, resposta, corpo de erro e credencial na trilha persistida.
- Medir qualidade, latência, custo e concordância OpenAI/Claude em amostra
  versionada antes de qualquer mudança de autonomia ou expansão de provedor.

- Definir e executar a amostra mensurável de resultados reais para comprovar
  100% de parecer pós-execução antes de considerar o loop autônomo confiável.
- Validar no piloto que cada retorno a `SPECIFYING` entrega exatamente uma
  orientação de retrabalho ao chat de origem e que uma nova versão permite uma
  orientação posterior distinta.
- Na etapa de observabilidade, expor métricas de falhas consecutivas dos
  reconciliadores duráveis e do QA pós-execução.

## Enforcement determinístico — escopo definido

- Para paths, a decisão pura e o shadow estão integrados; coletar amostra real
  versionada e bloquear o cutover enquanto houver qualquer `MORE_PERMISSIVE`.
- Autorizar o cutover do caller de paths somente em fase própria, depois de
  amostra shadow com zero divergência mais permissiva.
- Para comandos, a paridade, a revisão e o shadow estão integrados; coletar
  amostra real versionada e bloquear o cutover enquanto houver qualquer
  `MORE_PERMISSIVE`.
- Manter `parseSpecificationCommand` no caller até fase própria; a decisão pura
  recebe somente comandos já estruturados.
- Migrar `authorizeCommands`/`authorizeRuntimeCommands` somente depois da
  amostra shadow com zero divergência mais permissiva, em fase e autorização
  próprias.
- Manter explícito que o caller legado é case-sensitive até sua migração para a
  decisão pura; não misturar essa migração com a correção de configuração.
- Planejar resolução física de symlinks dentro da worktree em entrega própria;
  a decisão atual permanece lexical e não pode considerar symlink seguro por
  ausência de match.
- Persistir AuditEvent somente depois da equivalência dos callers.
- Definir a amostra versionada que comprovará hashes idênticos para a mesma
  entrada e configuração.

## Fases 4–5

- Fazer `/status` e `/cancel` sem argumento respeitarem o projeto selecionado na
  sessão.
- Reduzir o ambiente herdado pelo processo Codex ao mínimo necessário; hoje o
  adapter não precisa expor o token do worker ao executor.
- Validar o Bloco 2 em um projeto real com `runtime` declarado, worktree limpa
  e dependências preparadas somente pelos comandos explícitos do manifesto.
  Nenhum bootstrap pode ser inferido ou executado fora da allowlist/negações do
  próprio Project.
- Cobrir por teste explícito que uma falha de `validate` declarada em
  `Project.runtime` reprova a Task com o estágio correto, além do caminho já
  coberto de bootstrap e timeout.

## Epic de infraestrutura — após o fechamento da Fase 3

- Provisionar staging no Render com banco e secrets próprios.
- Configurar deploy automático de staging após merge na `main` com CI verde.
- Criar bot Telegram exclusivo de staging.
- Implementar smoke tests pós-deploy para health, criação de Task, transição e
  AuditEvent; falha deve bloquear promoção.
- Validar o webhook real do Telegram em staging.
- Manter produção com promoção manual e sem hibernação.

## Telegram — melhoria de erro

- Retornar mensagem útil para Approval já decidida, em vez de erro interno
  genérico.

## Telegram — saída de resultado

- A entrega terminal ao autor existe somente para a própria Task e o `chat_id`
  de sua origem. Manter bloqueados envio genérico, destinos arbitrários e
  mensagens iniciadas fora do ciclo de conclusão; qualquer ampliação exige
  política e autorização explícitas.

## Visibilidade Telegram — melhorias não bloqueadoras

- A publicação de progresso é `at-least-once`: envio ao Telegram e avanço do
  cursor local não são atômicos. Um crash entre as duas operações pode duplicar
  uma fatia de log, marco ou resultado final; tratar a duplicação como tolerável
  no MVP e definir deduplicação operacional antes de exigir `exactly-once`.
- Otimizar `listCandidates`: hoje todos os `worker_log_chunks` da última
  Execution são carregados a cada poll, inclusive em verbosity 0. Filtrar no
  banco por `sequence > lastLogSequence` e limitar a leitura ao próximo chunk.

## Antes de ativar cada projeto

- Usar o Pilot Setup Wizard ou editar manualmente `.atlas/projects.yaml` para
  preencher repositório, allowlist de comandos, classificação e retenção.
- Declarar versões mínimas em `required_tools` somente quando o projeto realmente
  exigir; a ausência não bloqueia ativação.
- Revisar o diff do arquivo protegido, iniciar o PostgreSQL, executar migrações e
  seed antes da primeira tarefa real.

## Pilot Setup Wizard — melhorias não bloqueadoras

- Substituir a heurística por substring da classificação sensível por uma
  taxonomia explícita ou uma política conservadora para classificações futuras.
- Evitar commit acidental de temporários órfãos do salvamento atômico, cobrindo
  `.atlas/*.tmp-*` no `.gitignore` ou removendo-os de forma segura no startup.

## Roadmap documental — sem autorização de execução

- Decidir o ADR-016 somente quando skills anexáveis entrarem em uma fase
  autorizada, incluindo formato, versionamento, RBAC, confiança e auditoria.
- Decidir o ADR-017 em conjunto com a persistência do ADR-013 quando a edição de
  personas for autorizada.
- Priorizar e atribuir fase ao epic de modo consulta depois do piloto, sem
  acionar Specification, Approval ou worker.
- Priorizar e atribuir fase ao epic de tarefas agendadas/webhooks somente após o
  epic de infraestrutura.

## Dashboard operacional — plano oficial

- O read-model backend da Trilha A v1 está implementado: Atlas Intelligence
  determinística, Mission Control e Proatividade sobre sinais existentes,
  somente leitura.
- Manter a UI da Trilha A sob regressão de contrato, estados
  loading/vazio/erro/indeterminado, ausência de conteúdo sensível e ausência
  real de ações de escrita.
- Validar em uso real a ordem de prioridade, a utilidade dos alertas e a
  apresentação de sinais `indeterminado` antes de ampliar a inteligência.
- Narrativa por LLM para o papel de Chief of Staff continua não autorizada.
- Trilha B1 backend está implementada: revisar empiricamente o contrato,
  sanitização, 404 estável e ausência de escritas do Workspace por demanda.
- Trilha B2 está implementada: revisar empiricamente a UI do Workspace, o Replay
  operacional sem chain-of-thought, a navegação por URL, os estados
  loading/vazio/erro/404/indeterminado e o não-vazamento.
- Revisar empiricamente a Trilha C1: expiração, deny-by-default rota a rota,
  loopback/flag, auditoria sanitizada e ausência de credencial/token no
  bundle, respostas ou logs.
- Trilha C2a, seu serving e C2b1 (criar/cancelar) estão implementados. C2c-2
  adicionou schema/core, C2c-3 endureceu o scheduler e C2c-4 acrescenta os
  comandos governados; read-model/UI permanecem no passo 5, sem exceção a
  `always_human`.
- Trilha D: projeto como empresa independente, entregáveis e custo real/Budget.
- Trilha E: OTel/observabilidade, saúde, notificações, conhecimento, decisões,
  roadmap, templates e analytics.
- Nenhum item ainda pendente acima constitui fase antes de ADR e autorização
  explícita. A Fase 0 implementada não autoriza features, ampliação de stack ou
  escrita.

## Alinhamento de mercado — registrado, não autorizado

- Decidir ADR de MCP como interface padrão de ferramenta e ação, mantendo no
  ATLAS a decisão `allow|deny|require_human` e as regras de `always_human`.
- Decidir a camada de conhecimento documental entre `pgvector` com retrieval
  fino e LlamaIndex, com ingestão via MarkItDown.
- Definir “RH de agentes” — custo, qualidade e desempenho — como extensão de
  evals, com substituição de agente sempre humana.
- Avaliar OpenHands como worker adicional somente depois da abstração de
  provedor.
- Nenhum item acima constitui fase antes de ADR e autorização explícita.

## Loop de auto-desenvolvimento — registrado, não autorizado

- O QA empírico v1 está integrado; probes gerados e papel autoritativo continuam
  sem autorização.
- O provedor Claude está restrito à entrega autorizada do revisor
  pós-execução; abstração genérica e uso por outros agentes continuam sem
  autorização.
- A reconciliação independente e a autonomia proporcional v1 estão integradas:
  somente `PASS + approved` permite decisão de política, e risco crítico
  permanece humano.
- Definir um corpus de evals versionado, métricas, tamanho mínimo de amostra e
  limiares conservadores antes de sequer propor abertura do gate crítico.
- Manter merge e deploy em `always_human` e revisão humana adicional em pull
  requests de alto risco até evals comprovarem a confiabilidade do revisor.
- Nenhum item acima constitui fase antes de ADR e autorização explícita.

## Fase 11 — hardening da deliberação

- Tornar a orquestração do conselho retomável após queda do coordinator: hoje
  chamadas e pareceres já concluídos permanecem auditados, mas uma interrupção
  entre agentes pode deixar a Deliberation em `RUNNING` e a Task em
  `SPECIFYING`, exigindo reconciliação operacional.
- Definir retry idempotente de falha de provedor por agente sem repetir
  pareceres já persistidos nem ultrapassar o limite de duas rodadas.
- Limitar a concorrência das chamadas de parecer por rodada, evitando que um
  pico de rate limit do provedor derrube toda a deliberação.
- Resolver symlinks para o destino real em `assertInsideRoot` antes de ler
  instruções de agente, mantendo a fronteira física dentro do repositório.
