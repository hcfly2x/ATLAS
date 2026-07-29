# ADR-028 — Criar e cancelar demandas pela Dashboard

## Status

Proposto

## Contexto

A Dashboard autenticada já permitia inspecionar demandas e decidir Approvals
humanas não sensíveis, mas criar ou cancelar uma demanda ainda exigia outro
canal. Implementar comandos paralelos na interface criaria uma segunda regra de
intake, supervisão ou transição.

## Decisão proposta

A Dashboard pode criar uma demanda por `POST /dashboard/api/demands` e cancelar
uma Task por `POST /dashboard/api/tasks/:taskId/cancel`. As duas rotas exigem
sessão, permissão RBAC específica, CSRF, contrato estrito, idempotência e
auditoria `USER`.

A criação usa o mesmo `TaskCoreStore.createTask` e o mesmo serviço de intake que
o Telegram. O texto do dono vira `originalMessage` da Task, com origem fixa
`dashboard:owner`; somente uma criação nova aciona o supervisor. Projeto
inexistente ou não ativo falha antes da criação.

O cancelamento usa exclusivamente `TaskStateMachine` e `TaskCoreStore`.
`NEW|NORMALIZING|ROUTING|SPECIFYING|WAITING_APPROVAL|QUEUED|FAILED` transitam
diretamente para `CANCELLED`.
`RUNNING|TESTING|WAITING_RESULT_APPROVAL|FINALIZING` transitam para
`CANCEL_REQUESTED`, preservando o encerramento cooperativo pelo worker.
`CANCEL_REQUESTED|COMPLETED|CANCELLED`, versão divergente e transição inválida
falham fechado.

Chaves idempotentes são vinculadas ao hash canônico do comando. Reenvio
idêntico reproduz o efeito; reuso divergente é conflito. A auditoria persiste o
hash, ator, correlação, transição e códigos seguros, nunca objetivo, motivo,
payload, prompt, resposta, credencial, token ou argumentos crus.

## Consequências

- A Dashboard passa a operar criação e cancelamento sem criar fonte de verdade
  paralela ao Telegram ou à máquina de estados.
- Não há entidade, migração ou estado canônico novo.
- O cabeçalho do Workspace expõe `taskVersion` para concorrência otimista.
- O cancelamento cooperativo não interrompe lease, fencing ou execução à força.
- Pausa, retomada e prioridade permanecem reservadas à C2c.
- Merge, deploy, `always_human`, autonomia, enforcement e políticas permanecem
  inalterados.
