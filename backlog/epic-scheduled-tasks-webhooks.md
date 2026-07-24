# Epic de roadmap — Tarefas agendadas e webhooks

## Status

Registrado para priorização futura. Fase ainda não definida e execução não
autorizada.

## Objetivo

Permitir que eventos temporais ou integrações autenticadas criem Tasks normais,
sempre submetidas à política de autonomia do projeto.

## Dependência

- epic de infraestrutura concluído;
- coordinator disponível em ambiente adequado;
- autenticação, secrets e observabilidade operacionais;
- política de autonomia e idempotência vigentes.

## Escopo futuro

### Agendamento

- cron interno persistente;
- expressão, projeto, payload e estado de ativação auditáveis;
- disparos idempotentes;
- atraso ou repetição não duplica a mesma ocorrência.

### Webhook

- endpoint autenticado por HMAC;
- validação de timestamp e janela contra replay;
- idempotency key por evento;
- segredo separado por integração/projeto;
- payload normalizado e sanitizado antes de criar a Task.

## Regras

- cada disparo cria uma Task pelo fluxo canônico;
- criticidade, `autonomy_level` e `always_human` são avaliados normalmente;
- agendamento ou webhook não concede autorização adicional;
- falha de autenticação, replay ou payload inválido não cria Task e é auditada;
- secrets nunca são registrados em payloads, logs ou AuditEvent.

## Aceite futuro

- uma ocorrência de cron válida cria exatamente uma Task;
- um webhook HMAC válido cria exatamente uma Task;
- replay não duplica efeito;
- a Task percorre a mesma política de autonomia de uma demanda recebida pelo
  Telegram;
- tentativas inválidas são rejeitadas e auditadas.
