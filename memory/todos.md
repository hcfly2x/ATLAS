# Pendências

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

- Revisar empiricamente o QA empírico v1 antes de merge; confirmar instalação
  congelada, allowlist, diff scope, sanitização e natureza advisory.
- Medir concordância entre `EmpiricalReview` e PostExecutionReview antes de
  considerar probes gerados, outro provedor ou qualquer papel autoritativo.

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

- Definir ADR e escopo do QA empírico: revisor que executa instalação com
  lockfile congelado, testes, probes adversariais e diff contra a base.
- Disponibilizar o provedor Claude para o papel de revisor, preservando
  diversidade entre autor e revisor.
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
