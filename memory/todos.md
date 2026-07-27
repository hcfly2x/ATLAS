# Pendências

## Entrega durável — fora da Fase A

- Projetar outbox persistente reutilizando `TelegramTaskDelivery`, com tentativas
  limitadas, backoff, erro sanitizado e reconciliação de claims abandonadas.
- Decidir em fase própria como representar `DELIVERY_FAILED`, sem alterar a
  máquina de estados silenciosamente.
- Separar aprovação do conteúdo da confirmação de transporte somente após
  definir o registro e a idempotência correspondentes.
- Implementar watchdog/SLA para Tasks sem resposta visível e expor a falha na
  dashboard.
- Manter modo consulta, bypass de worker e reclassificação de complexidade fora
  da Fase A.

## QA pós-execução — acompanhamento após integração

- Definir e executar a amostra mensurável de resultados reais para comprovar
  100% de parecer pós-execução antes de considerar o loop autônomo confiável.
- Validar no piloto que cada retorno a `SPECIFYING` entrega exatamente uma
  orientação de retrabalho ao chat de origem e que uma nova versão permite uma
  orientação posterior distinta.
- Na etapa de observabilidade, expor métricas de falhas consecutivas dos
  reconciliadores duráveis e do QA pós-execução.

## Enforcement determinístico — escopo definido

- Revisar o primeiro caller em modo shadow antes de qualquer cutover.
- Executar uma amostra real versionada e bloquear o cutover se houver
  `MORE_PERMISSIVE`; divergência aceitável é somente `none` ou `stricter`.
- Autorizar o cutover do caller de paths em fase própria, preservando corpus e
  fallback até a revisão completa.
- Revisar completamente a paridade de comandos antes de observar qualquer
  caller.
- Manter `parseSpecificationCommand` no caller até fase própria; a decisão pura
  recebe somente comandos já estruturados.
- Implementar shadow de comandos em entrega independente e bloquear o cutover
  enquanto houver qualquer divergência `MORE_PERMISSIVE`.
- Migrar `authorizeCommands`/`authorizeRuntimeCommands` somente depois da
  amostra shadow com zero divergência mais permissiva.
- Revisar e aprovar separadamente o merge da substituição de `.env*` por
  `**/.env*` na área `secrets` e em `effective_globs`.
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
