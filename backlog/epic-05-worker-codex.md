# Epic 05 — Worker + Codex + Git

> Trilha 1 — Fase 5.
>
> **Status:** concluído em branch própria; aguarda revisão e merge.

## Tarefas
- registro;
- heartbeat;
- long-polling com Bearer;
- preflight macOS/ARM64 e concorrência 1;
- worktree;
- branch;
- Codex Adapter;
- streaming com backpressure;
- cancelamento cooperativo;
- testes;
- resultado conforme `specifications/worker-result.md`;
- verificação de paths protegidos;
- aprovação do resultado por hashes;
- estado FINALIZING para commit e PR;
- lease, fencing token e idempotência conforme o ADR-012 aceito.

## Aceite
Uma tarefa aprovada altera um repositório isolado, retorna resultado íntegro e só cria commit/PR após aprovação válida.
