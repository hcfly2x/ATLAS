# Pendências

## Fases 4–5

- Fazer `/status` e `/cancel` sem argumento respeitarem o projeto selecionado na
  sessão.

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
