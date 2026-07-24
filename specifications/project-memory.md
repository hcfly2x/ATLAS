# Contrato de memória por projeto

## Tipos

- `decision`: decisão durável do projeto;
- `note`: contexto manual relevante;
- `summary`: resumo vinculado obrigatoriamente a uma Task.

Todo item contém `id`, `project_id`, `type`, `content`, `created_at`,
`idempotency_key` e `payload_hash`; `task_id` e `agent_id` são opcionais, exceto
`task_id` obrigatório para `summary`.

## Fronteira interna

- `POST /internal/projects/:projectId/memory`: cria item manual.
- `GET /internal/projects/:projectId/memory`: lista até 100 itens, com filtros
  opcionais de tipo, Task e cursor temporal.
- `GET /internal/projects/:projectId/memory/context`: retorna contexto montado,
  opcionalmente priorizado para uma Task.

Todas exigem o Bearer token interno. Não existem rotas de update/delete nesta
fase.

## Idempotência e auditoria

A chave é globalmente única. Mesmo payload retorna o item anterior; payload
divergente retorna `409` e gera `memory.idempotency_conflict`. Criação gera
`memory.created`; resumo automático gera `memory.task_summary.created`.

## Context builder

- consulta somente pelo `project_id` selecionado;
- rejeita qualquer item de outro projeto que alcance a fronteira pura;
- prioriza memória ligada à Task, depois decisões, notas e resumos;
- desempata por data descendente e ID;
- default de 20 itens e 12.000 caracteres;
- trunca deterministicamente e informa `truncated`.

O supervisor recebe o texto limitado na normalização e na produção da
Specification. Memória não amplia escopo nem substitui a mensagem atual.
