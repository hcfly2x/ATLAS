# ADR-012 — Idempotência e lease da fila

## Status
Aceito.

## Contexto

Telegram, coordinator, pg-boss e worker operam sobre redes e entregas que podem ser repetidas. Um timeout ou heartbeat perdido não prova que a execução terminou. Sem idempotência, lease e proteção contra workers obsoletos, a mesma tarefa pode executar código duas vezes ou publicar um resultado antigo.

## Decisão

- Cada fronteira mutável usa idempotency key com escopo e unicidade definidos:
  - update/callback do Telegram;
  - criação e transição de Task;
  - solicitação e decisão de Approval;
  - claim e renovação de Execution;
  - chunks de log;
  - submissão do resultado do worker;
  - finalização Git/PR.
- O claim cria lease renovável com `lease_id`, `worker_id`, `expires_at` e fencing token monotônico.
- Somente o detentor do fencing token vigente pode renovar lease, registrar progresso, submeter resultado ou finalizar.
- Heartbeat do worker e renovação do lease são mecanismos separados.
- Lease expirado torna a tentativa elegível para reconciliação, não para reexecução automática.
- No MVP, qualquer nova tentativa após expiração exige reconciliação e decisão humana.
- Repetição com mesma chave e mesmo hash retorna o efeito anterior; mesma chave com payload/hash diferente gera conflito e AuditEvent.

## Opções consideradas

1. Idempotency keys + lease renovável + fencing token.
2. Confiar apenas no estado do pg-boss e heartbeat.
3. Lock fixo por worker sem fencing.

## Consequências

- O schema da Fase 2 deve guardar chaves, hashes, lease e fencing token; esta modelagem não pode ser postergada para a Fase 5.
- O coordinator precisa de rotina de reconciliação de leases expirados.
- Não haverá retry automático de execução de código no MVP.
- Testes deverão cobrir duplicação, timeout, partição de rede, renovação concorrente e resultado tardio.
