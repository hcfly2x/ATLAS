# Operação do loop-breaker de retrabalho

## Sinal

O limiar usa `ATLAS_MAX_AUTOMATIC_REWORK`, com default 3. O coordinator falha no
startup se o valor não for inteiro positivo.

Quando o mesmo código de reconciliação alcança o limiar:

- a Task permanece em `WAITING_RESULT_APPROVAL`;
- a Execution termina com `failureStage=post_execution_rework_limit`;
- a Approval pendente passa a exigir ator humano;
- o AuditEvent `post_execution_rework.escalated` registra somente motivo
  estável, contagem, limiar, estado, versão e IDs correlacionáveis;
- o Telegram recebe uma notificação at-most-once no chat derivado de
  `Task.origin`.

## Decisão humana

1. Abra a Task em “Precisam de você” e confira Specification, Execution, QA e
   evidência empírica sanitizados.
2. Para reespecificar, rejeite a Approval de resultado e forneça uma nova
   orientação explícita.
3. Para cancelar, solicite explicitamente o cancelamento da Task e confirme o
   estado terminal antes de considerar o caso encerrado.
4. Não aprove um resultado cujo QA permanece rejeitado ou indisponível.

## Limites

- a escalada não inicia nova Specification ou Execution;
- não existe auto-cancelamento;
- falha de notificação não muda a decisão persistida;
- corrigir diff vazio ou ausência de evidência empírica pertence a diagnóstico
  separado;
- C2 e ações pela Dashboard não fazem parte desta entrega.
