# ADR-019 — Entrega durável do resultado terminal

## Status

Proposto.

## Contexto

A aprovação do conteúdo e a conclusão da Task não comprovam que o resultado foi
entregue ao canal. O publisher anterior fazia claim antes do envio para evitar
duplicação, mas uma falha de transporte podia deixar uma Task terminal sem
resposta visível e sem nova tentativa.

Telegram não fornece uma transação comum com o PostgreSQL. Depois que uma
requisição pode ter sido despachada, repetir automaticamente arrisca duplicar a
mensagem. Portanto, durabilidade precisa preservar a fronteira `at-most-once` e
tratar desfechos ambíguos de forma explícita.

## Proposta

- persistir uma linha de outbox por `task_id + version`, depois de a Task chegar
  a `COMPLETED` ou `FAILED`;
- derivar e congelar o destino exclusivamente de `Task.origin`;
- referenciar o conteúdo terminal aprovado e guardar seu hash canônico;
- separar os estados da entrega (`PENDING|DELIVERED|DELIVERY_FAILED`) dos
  estados canônicos da Task;
- registrar o início de cada tentativa antes de chamar o Telegram;
- repetir com backoff e limite somente quando o canal comprovar que nada foi
  despachado;
- converter falha ambígua ou claim expirado em `DELIVERY_FAILED`, sem retry;
- registrar AuditEvent idempotente por Task, versão, tentativa e desfecho;
- manter os campos do publisher legado para impedir duplicação durante
  rollback ou coexistência de versões.

`DELIVERED` é confirmação do transporte pelo Telegram. Não substitui a Approval
de resultado, o parecer de QA ou a conclusão da Task.

## Consequências

- uma falha comprovadamente anterior ao despacho pode se recuperar sem repetir
  o trabalho;
- crash depois do início do despacho nunca reenvia automaticamente: a linha
  permanece durável e é reconciliada para `DELIVERY_FAILED`;
- o operador pode distinguir conteúdo aprovado de transporte confirmado;
- a máquina de estados, fencing, lease, finalização e retry técnico do trabalho
  permanecem inalterados;
- watchdog/SLA e exposição operacional de `DELIVERY_FAILED` ficam para a Fase C.
