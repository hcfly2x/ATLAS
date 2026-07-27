# ADR-018 — Modo de entrega da Specification

## Status

Proposto.

## Contexto

O fluxo vigente presume que toda Specification produz uma mudança no
repositório. Uma demanda de planejamento pode, porém, exigir apenas texto,
produzir diff vazio e ainda precisar retornar ao autor. Sem um contrato
explícito, o resultado pode passar pela execução e ficar sem destino autorizado.

## Proposta

- toda Specification declara `delivery_mode` como `answer_only` ou
  `repository_change`;
- registros legados e valores ausentes ou inválidos preservam
  `repository_change`;
- `answer_only` continua passando por Specification, Approval, worker e QA
  pós-execução;
- o QA aceita diff vazio em `answer_only`, mas continua validando o conteúdo
  contra os critérios de aceite;
- após aprovação, o worker finaliza `answer_only` sem commit ou pull request e
  o result-publisher entrega o resumo exclusivamente ao destino derivado de
  `Task.origin`;
- o guard anterior à fila rejeita `answer_only` sem origem Telegram válida e
  `repository_change` sem repositório absoluto configurado;
- ambiguidade de intenção resulta em `repository_change`.

## Consequências

- respostas textuais tornam-se uma entrega de primeira classe sem criar canal,
  estado ou máquina de estados paralela;
- a trava anti-exfiltração da entrega Telegram permanece única;
- a semântica `at-most-once` permanece; outbox, retry durável,
  `DELIVERY_FAILED`, watchdog e modo consulta continuam fora desta proposta;
- aceitar este ADR exigirá revisão da experiência real antes de ampliar os
  modos de entrega.
