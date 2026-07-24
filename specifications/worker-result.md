# Contrato de Resultado do Worker

Contrato documental normativo para o schema Zod previsto no ADR-009.

## Identificação

- `contract_version`: versão do contrato.
- `task_id`: Task correspondente.
- `execution_id`: tentativa de execução.
- `specification_id`: Specification executada.
- `specification_version`: versão imutável executada.
- `specification_hash`: hash validado antes da execução.
- `worker_id`: worker que produziu o resultado.

## Estado e tempos

- `status`: `succeeded|failed|cancelled`.
- `started_at`: timestamp UTC.
- `finished_at`: timestamp UTC.
- `failure_stage`: obrigatório quando `status=failed`.
- `error`: código e mensagem sanitizada, quando aplicável.

## Entrega

- `summary`: resumo técnico sanitizado.
- `changed_paths`: lista normalizada de paths alterados.
- `diff_summary`: estatísticas e descrição curta.
- `diff_ref`: referência ao diff armazenado; o payload integral não precisa trafegar inline.
- `diff_hash`: hash do diff exato apresentado para aprovação.
- `protected_path_matches`: paths protegidos detectados.
- `risks`: riscos remanescentes.
- `pending_items`: pendências.

## Comandos e testes

- `commands`: lista ordenada com executável resolvido, argumentos sanitizados, início, fim, exit code e status. Não contém strings de shell arbitrárias.
- `tests`: lista com nome, comando referenciado, status (`passed|failed|skipped`), duração e resumo sanitizado.

## Logs

- `log_chunks`: referências ordenadas contendo sequência, checksum, tamanho e timestamps.
- `logs_truncated`: indica truncamento por limite.
- `redaction_applied`: indica sanitização.

## Integridade e idempotência

- `result_hash`: hash da representação canônica do resultado.
- `idempotency_key`: identifica de forma única a submissão do resultado.
- `sequence`: número monotônico da atualização final para a Execution.
- `codex_estimated_cost_usd`: consumo lógico estimado atribuído à Execution para
  apuração do teto mensal separado do Codex.

## Regras

- O coordinator rejeita resultado cujo trio `specification_id`, versão e hash não corresponda à Execution.
- Reenvio com a mesma idempotency key e mesmo hash retorna o resultado anterior sem novo efeito.
- Mesma idempotency key com hash diferente é conflito e gera AuditEvent.
- Aprovação do usuário referencia `execution_id`, `result_hash` e `diff_hash`.
- Logs, erros, comandos e resumo devem estar sanitizados antes do envio.
- Paths protegidos impedem `FINALIZING` sem a aprovação exigida pelo ADR-010.
- `commands[].executable` contém o caminho resolvido do binário, nunca uma
  string interpretada por shell.
- `log_chunks` é contíguo e corresponde aos chunks persistidos pelo coordinator.
