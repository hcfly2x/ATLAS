# Epic 07 — Conselho multiagente

> Trilha 2 — Fase 7. Executar somente após o MVP validado (ver `docs/implementation-plan.md`).

## Tarefas
- registro de papéis;
- roteador;
- parecer independente;
- garantir que o agente revisor não seja o mesmo agente que emitiu a
  Specification;
- permitir modelos distintos para revisor e supervisor;
- divergências;
- supervisor;
- especificação final;
- auditoria;
- emitir `AuditEvent` por parecer de agente e por rodada de deliberação, com
  `task_id` e `correlation_id`, sem limitar a trilha à decisão final do
  supervisor, para sustentar a visualização do fluxo multiagente no dashboard
  da Fase 10.

## Aceite

Uma demanda crítica gera pareceres, decisão e especificação rastreável; cada
parecer e rodada emite AuditEvent correlacionado. O revisor é independente do
agente que emitiu a Specification, e revisor e supervisor podem usar modelos
distintos.
