# ADR-009 — Contratos validados com Zod

## Status
Aceito.

## Decisão
Todos os contratos entre componentes (task request, parecer de especialista, especificação executável, resultado do worker) são schemas Zod em `packages/shared`, com JSON Schema gerado a partir deles.

## Motivo
Templates YAML são convenção, não garantia. Zod dá validação em runtime, tipos TypeScript inferidos e um único ponto de verdade.

## Consequências
Saída de LLM que não validar contra o schema é rejeitada e re-solicitada (até 2 tentativas) antes de falhar a tarefa.
