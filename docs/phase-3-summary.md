# Resumo técnico — Fase 3

## Objetivo executado

Implementar o gateway Telegram MVP do coordinator: entrada por webhook ou
long-polling, autorização por um único Telegram ID, criação e acompanhamento de
Task, seleção de projeto, aprovações versionadas e cancelamento cooperativo.

## Decisões aplicadas

- Webhook e polling usam o mesmo `TelegramGateway`, independente do transporte.
- Long-polling com `getUpdates` é o modo de desenvolvimento manual enquanto não
  existe URL HTTPS pública nem autorização de deploy.
- Webhook permanece testável localmente por injeção Fastify, só é registrado com
  secret não vazio e sempre valida o secret token do Telegram.
- Replay idempotente não reenvia mensagens; callbacks repetidos continuam sendo
  reconhecidos para encerrar o estado visual do botão.
- Updates e callbacks são persistidos para replay idempotente.
- Botões carregam apenas o ID opaco da Approval; tipo, ID, versão e hash do alvo
  são recuperados e auditados no servidor.
- Tasks em execução usam `CANCEL_REQUESTED`; estados anteriores canceláveis vão
  diretamente para `CANCELLED` conforme a máquina canônica.
- Rotas `/internal/*` exigem Bearer token antes de qualquer exposição de rede.

## Estrutura criada

- `telegram/types.ts`: schemas Zod dos updates e respostas.
- `telegram/service.ts`: autorização, comandos, callbacks e orquestração.
- `telegram/store.ts`: sessão, status, replay e decisão de Approval no Prisma.
- `telegram/client.ts`: cliente mínimo da Bot API.
- `telegram/polling.ts`: loop de desenvolvimento por `getUpdates`.
- Migração para `telegram_sessions` e `telegram_updates`.

## Testes executados

- Pipeline completa: formatação, Prisma generate/validate, lint (9/9),
  typecheck (15/15), 22 testes unitários/API/contrato e build (9/9).
- Três testes de integração contra PostgreSQL 17.
- usuário autorizado e bloqueio de usuário divergente;
- seleção de projeto e texto para Task sem duplicação;
- status e botões vinculados a alvo, versão e hash;
- aprovação e transição da Task;
- cancelamento cooperativo com `CANCEL_REQUESTED`;
- secret do webhook e handler por injeção local;
- autenticação Bearer das rotas internas;
- migração, sessão, replay e decisão auditada contra PostgreSQL.

## Riscos remanescentes

- Não houve chamada real à Bot API, pois não foram usadas credenciais reais.
- O webhook não foi registrado e não existe URL pública nesta fase.
- Long-polling é adequado ao desenvolvimento, mas o ambiente futuro deve escolher
  uma única instância consumidora ou migrar para webhook.
- Aprovações são consumidas pelo Telegram, mas serão produzidas pelo supervisor
  somente na Fase 4.
- O hash canônico de Specification continua como obrigação da Fase 4.
- `/status` e `/cancel` sem argumento ainda não filtram pelo projeto selecionado.
- Approval já decidida ainda pode resultar em mensagem interna genérica.

## Próxima tarefa recomendada

Auditar o PR da Fase 3. A Fase 4 permanece não autorizada.
