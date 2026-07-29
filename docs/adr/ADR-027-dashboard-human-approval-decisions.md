# ADR-027 — Decisões humanas de Approval pela Dashboard

## Status

Proposto

## Contexto

A Trilha C1 introduziu sessão expirável e RBAC deny-by-default sem permitir
escrita. O dono ainda precisava alternar para o Telegram para decidir uma
`Approval` humana já pendente. Criar um resolvedor específico da Dashboard
duplicaria regras de hash, QA, versão e transição e poderia produzir duas fontes
de verdade.

## Decisão proposta

A Dashboard pode submeter `approve`, `reject` ou `request_change` somente para
`Approval` pendente com `actor = USER`. Telegram e Dashboard reutilizam um único
resolvedor transacional, que valida alvo/hash, QA, ator, estado e versões antes
de atualizar a Approval e aplicar a transição canônica correspondente.

A rota exige a permissão `dashboard:approval:decide`, sessão válida, token CSRF
derivado e vinculado à sessão, chave de idempotência e versões esperadas do alvo
e da Task. Ausência, divergência ou erro falham fechado. `request_change` usa a
mesma rejeição canônica e registra somente comentário do dono sanitizado.

Approvals `SYSTEM` não são decididas pela rota. Aprovar alvo
`SENSITIVE_ACTION` também é negado nesta fase. Merge, deploy, pagamento,
tracking, segredo de produção, migração destrutiva e demais ações
`always_human` não ganham exceção.

Na interface, `request_change` aparece somente para Approval de resultado
(`RESULT`/`EXECUTION_RESULT`). Em `PRE_EXECUTION`, a Dashboard oferece apenas
aprovar ou rejeitar. Essa restrição é da UI: o resolvedor e o contrato canônicos
permanecem inalterados.

## Consequências

- Esta é a primeira superfície de escrita da Dashboard.
- Não há entidade, estado canônico ou migração nova.
- O cookie continua HttpOnly; o frontend obtém apenas evidência CSRF efêmera da
  sessão e nunca recebe a credencial.
- Reenvio idêntico produz replay; reuso da chave com outra decisão é conflito.
- Auditoria contém ator, canal, decisão, alvo, versões e comentário sanitizado,
  sem credencial, token, prompt, payload, `messageText` ou argumentos.
- Criar e cancelar seguem o ADR-028. Pausar, retomar e priorizar continuam
  reservados à C2c.
