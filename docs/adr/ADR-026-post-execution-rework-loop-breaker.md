# ADR-026 — Loop-breaker de retrabalho pós-execução

## Status

Proposto

## Contexto

O QA pós-execução falha fechado e devolve a Task para `SPECIFYING` quando os
sinais não liberam a Approval. Repetir esse caminho sem limite para o mesmo
motivo determinístico pode criar novas versões indefinidamente sem produzir
informação nova nem pedir uma decisão ao dono.

## Decisão proposta

Limitar os retrabalhos automáticos consecutivos pelo mesmo
`reconciliationReason`. `ATLAS_MAX_AUTOMATIC_REWORK` aceita somente inteiro
positivo e usa 3 por default. A validação ocorre no startup.

O coordinator conta os reviews terminais mais recentes em ordem determinística.
Um review aprovado ou um código de reconciliação diferente interrompe a
sequência. A própria N-ésima rejeição faz parte da contagem:

- abaixo do limiar, o comportamento existente permanece: Approval de resultado
  rejeitada, Execution encerrada e Task devolvida para `SPECIFYING`;
- no limiar, a Task permanece em `WAITING_RESULT_APPROVAL`, a Execution é
  encerrada, o worker é liberado e a Approval pendente passa a exigir ator
  humano;
- a escalada cria um único AuditEvent sanitizado e uma única notificação
  at-most-once para o destino derivado exclusivamente de `Task.origin`.

O Approval existente continua vinculado ao resultado e aos hashes. Aprovar um
resultado rejeitado pelo QA permanece bloqueado; rejeitá-lo permite
reespecificação humana. Cancelamento também exige solicitação humana explícita.

## Consequências

- Nenhum estado canônico novo, entidade ou migração é necessário.
- Reprocessar o mesmo review terminal não incrementa a contagem nem duplica
  escalada ou notificação.
- A escalada nunca aprova, finaliza, executa, faz merge, deploy ou cancelamento.
- `always_human`, autonomia, enforcement, fencing, lease e máquina de estados
  permanecem inalterados.
- Motivos, auditoria e mensagens usam apenas códigos estáveis e contagens; não
  incluem prompt, payload, resposta de modelo, argumento de comando ou segredo.
