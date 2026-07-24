# Epic 06 — Memória por projeto

## Objetivo

Persistir decisões, notas e resumos de tarefa com isolamento obrigatório por
projeto e fornecer contexto limitado e determinístico ao supervisor.

## Tarefas

- Criar `MemoryItem` no PostgreSQL com `project_id` obrigatório, tipo
  `decision|summary|note`, conteúdo, Task/agente opcionais, hash e idempotency key.
- Expor criação e listagem manual pela API interna autenticada.
- Gravar AuditEvent na criação e em conflitos de idempotência.
- Criar resumo automático e auditado quando uma Execution conclui a finalização.
- Implementar context builder com orçamento de itens/caracteres, prioridade para
  a Task atual e decisões, e falha fechada diante de item de outro projeto.
- Injetar somente a memória do Project da Task na normalização e na Specification.
- Cobrir isolamento, replay, conflito, orçamento e migração em PostgreSQL real.

## Aceite

- Nenhuma memória pode existir sem Project ou ser retornada no escopo de outro.
- Repetição com mesma chave e payload retorna replay; payload diferente gera
  conflito auditado.
- Summary exige `task_id`; conclusão do worker gera exatamente um resumo.
- O supervisor recebe contexto limitado exclusivamente ao Project da Task.
- Migrações, seed, unitários, integração, lint, typecheck e build passam.

## Fora de escopo

- memória global persistente;
- edição ou exclusão de memória;
- embeddings, busca vetorial ou ranking semântico;
- interface visual/dashboard;
- conselho multiagente;
- anexos, deploy ou staging.
