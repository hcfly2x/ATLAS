# ADR-022 — Reconciliação independente do QA pós-execução

## Status

Proposto.

## Contexto

O QA empírico v1 e o revisor LLM pós-execução produzem sinais independentes,
mas o fluxo anterior deixava somente a decisão do revisor definir o status do
`PostExecutionReview`. Assim, um parecer `approved` podia liberar o gate mesmo
quando a verificação empírica havia retornado `FAIL` ou `UNAVAILABLE`.

Conectar os sinais não pode transformar qualquer um deles em autorização de
merge ou deploy, nem criar uma segunda máquina de estados. A reconciliação deve
ser determinística, persistida e negativa por padrão.

## Proposta

- persistir no `PostExecutionReview` final o veredito empírico, a decisão do
  revisor e um código de reconciliação estável;
- marcar o review como `APPROVED` somente para
  `EmpiricalReview.PASS + reviewer.approved`;
- manter o review rejeitado quando o revisor rejeitar, independentemente do
  veredito empírico;
- tratar `FAIL + approved` e `UNAVAILABLE + approved` como rejeição e retorno ao
  fluxo humano de retrabalho;
- tratar sinal ausente, erro ou indisponibilidade do revisor como falha
  fechada, sem liberar finalização;
- somente o resultado reconciliado `APPROVED` pode consultar a Approval de
  resultado já existente. Ele não cria, decide nem substitui essa Approval;
- persistir somente enums, hashes e códigos limitados na auditoria. Mensagem de
  erro, prompt, resposta remota, argumentos e credenciais não entram nesse
  registro.

Os campos são aditivos e nulos para compatibilidade com reviews históricos. O
trigger de imutabilidade existente protege os novos sinais depois que o review
chega a `APPROVED`, `REJECTED` ou `FAILED`.

## Consequências

- nenhum sinal isolado aprova o resultado;
- divergência e indisponibilidade seguem para revisão humana/retrabalho sem
  reexecutar o trabalho automaticamente;
- `TaskState`, fencing, lease, finalização, enforcement e `always_human`
  permanecem inalterados;
- merge e deploy continuam exigindo os gates humanos existentes;
- probes gerados, QA autoritativo para merge/deploy e autonomia proporcional
  ficam fora desta decisão.
