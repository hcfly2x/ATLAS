# ADR-005 — Fila em PostgreSQL (pg-boss)

## Status
Aceito.

## Decisão
Usar pg-boss (fila sobre PostgreSQL) no MVP. Redis fica fora do MVP.

## Motivo
Um serviço a menos para operar, backup e monitorar. O volume de tarefas de um operador único não justifica Redis. Pareto: 80% do valor da fila (retry, prioridade, timeout, agendamento) com 20% da infraestrutura.

## Consequências
Migração futura para BullMQ/Redis é possível se o volume crescer; a interface da fila deve ser abstraída em `packages/queue`.
