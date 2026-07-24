# ADR-007 — Transporte e autenticação worker ↔ nuvem

## Status
Aceito.

## Decisão
No MVP, o worker faz long-polling HTTPS de saída para o coordinator, autenticado com token Bearer exclusivo do worker, rotacionável, com escopo por projeto. Heartbeat a cada 30s. WebSocket persistente é evolução futura.

## Motivo
Polling de saída elimina exposição do notebook (reforça ADR-002), dispensa mTLS e infraestrutura de conexão persistente. Latência de segundos é aceitável para tarefas que duram minutos.

## Consequências
Streaming de logs em near-real-time via POST incremental de chunks. Cancelamento é entregue na próxima iteração de polling (aceitável no MVP).
