# Operação de falhas de entrega terminal

## Sinais

A dashboard somente-leitura apresenta, por projeto:

- `PENDING`: entrega ainda elegível ao reconciliador;
- `SLA_EXCEEDED`: entrega pendente há mais que o SLA configurado;
- `DELIVERY_FAILED`: transporte esgotado ou desfecho ambíguo;
- `missingOutbox`: Task Telegram terminal sem outbox da versão vigente;
- `DELIVERED`: transporte confirmado pelo Telegram.

O SLA padrão é 5 minutos. `ATLAS_DELIVERY_SLA_MS` aceita um inteiro positivo em
milissegundos. O watchdog roda no coordinator, não altera Task ou outbox e cria
um único `telegram.result_delivery.watchdog_alerted` por problema.

Uma claim legada só cobre a versão codificada em sua chave. Se a Task concluir
uma versão posterior, o publisher cria a outbox nova e o watchdog considera a
versão atual separadamente.

## Procedimento humano

1. Filtrar o projeto na dashboard e abrir a seção **Entrega terminal**.
2. Abrir a Task correspondente e conferir estado, versão, Approval, QA,
   outbox e AuditEvents correlacionados.
3. Para `SLA_EXCEEDED`, confirmar se o reconciliador continua ativo e se existe
   tentativa em andamento ou backoff futuro.
4. Para `DELIVERY_FAILED`, usar `lastError` somente como código sanitizado.
   Conferir externamente se a mensagem chegou antes de qualquer ação.
5. Para `missingOutbox`, confirmar que a Task terminal possui origem Telegram
   válida e que o result-publisher está ativo.
6. Se o desfecho permanecer ambíguo, não reenviar automaticamente. Registrar a
   decisão operacional e pedir uma nova ação explícita do usuário quando
   necessário.

## Limites

- a dashboard não possui rota de retry, reenvio ou alteração de status;
- o watchdog não chama Telegram e não repete trabalho;
- confirmação humana não transforma resultado ambíguo em `DELIVERED`;
- correção manual no banco, reabertura de Task ou reenvio administrativo não
  fazem parte desta fase.
