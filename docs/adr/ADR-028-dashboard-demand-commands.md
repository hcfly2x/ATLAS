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

Uma revisão empírica mostrou que `AuditEvent` sozinho não consegue vincular uma
chave quando a Task ou o Project ainda não existem, pois suas relações exigem
um Project persistido. Por isso, criar e cancelar usam um recibo mínimo de
comando, independente desses alvos. O recibo guarda chave, hash, ator,
correlação, tipo, referências opcionais, versão esperada, status e código
seguro. Recibo, mutação canônica e resultado são confirmados na mesma transação.
Uma rejeição também consome a chave: pedido idêntico reproduz o mesmo código e
pedido divergente falha fechado. Nenhum texto do objetivo ou motivo é guardado.

## Consequências

- A Dashboard passa a operar criação e cancelamento sem criar fonte de verdade
  paralela ao Telegram ou à máquina de estados.
- Há uma entidade e migração aditivas somente para recibos idempotentes da
  Dashboard; ela não referencia obrigatoriamente Task ou Project e não cria
  segunda máquina de estados.
- Falha antes do commit atômico não consome a chave nem produz mutação; após o
  commit, aceite ou rejeição são reproduzíveis.
- O cabeçalho do Workspace expõe `taskVersion` para concorrência otimista.
- O cancelamento cooperativo não interrompe lease, fencing ou execução à força.
- Pausa, retomada e prioridade permanecem reservadas à C2c.
- Merge, deploy, `always_human`, autonomia, enforcement e políticas permanecem
  inalterados.
