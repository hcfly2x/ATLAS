# Epic 02 — Core mínimo do Coordinator

> Trilha 1 — Fase 2.

## Estado

Concluído em 23/07/2026. A Fase 3 permanece não autorizada.

## Tarefas
- Prisma e migrações das entidades MVP;
- seed/config validado de projetos, sem UI;
- máquina de estados conforme `docs/data-model.md`;
- versões imutáveis de Specification;
- Approval ligada a alvo versionado e hash;
- Execution ligada a `specification_id`;
- auditoria append-only desde o primeiro dia.

## Aceite
Uma Task percorre estados válidos via API interna, com integridade de hashes e auditoria.
