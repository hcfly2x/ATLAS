# ADR-006 — Codex via CLI no MVP

## Status
Aceito.

## Decisão
O Codex Adapter usará o Codex CLI em modo não interativo (`codex exec`) no MVP, encapsulado atrás de interface própria.

## Motivo
CLI é o caminho mais curto para executar tarefas em worktree com streaming de saída via stdout. A interface abstrata (`CodexAdapter`) permite trocar por SDK depois sem afetar o restante do sistema.

## Consequências
Parse de saída do CLI é mais frágil que SDK tipado; mitigar exigindo resumo estruturado (JSON) ao final de cada execução.
