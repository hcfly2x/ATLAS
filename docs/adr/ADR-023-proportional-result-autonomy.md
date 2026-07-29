# ADR-023 — Autonomia proporcional na aprovação de resultado

## Status

Proposto.

## Contexto

O worker criava Approval de resultado já aprovada por política quando os testes
estavam verdes, nenhum path protegido aparecia e o projeto tinha nível de
autonomia 2 ou 3. Essa decisão ocorria antes da conclusão do QA pós-execução e
não distinguia resultado crítico no nível 3.

O QA empírico, o revisor independente e a reconciliação determinística agora
fornecem uma fronteira mais forte. A autonomia de resultado deve depender desses
sinais e do risco sem enfraquecer `always_human`, merge ou deploy. Ainda não
existe baseline versionado de evals que autorize dispensar revisão humana para
resultado crítico.

## Proposta

- toda Approval de resultado nasce `PENDING`;
- uma decisão pura e determinística classifica a Approval como candidata a
  política ou humana usando somente:
  - nível de autonomia do Project;
  - risco imutável da Specification;
  - veredito empírico;
  - resultado dos testes;
  - paths protegidos;
  - ações declaradas em `approval_required_for`;
- somente níveis 2 e 3, risco `simple|moderate`, evidência empírica `PASS`,
  testes verdes, nenhum path protegido e nenhuma ação sensível produzem
  candidata de política;
- a candidata de política só muda para `APPROVED` depois da reconciliação
  `EmpiricalReview.PASS + reviewer approved`;
- qualquer sinal ausente, indisponível ou divergente falha fechado;
- resultado crítico permanece humano em todos os níveis enquanto não houver
  baseline versionado de evals, ADR e autorização próprios;
- rejeição ou indisponibilidade do QA invalida a Approval pendente do resultado
  antes do retrabalho versionado;
- cada decisão usa código estável e AuditEvent sanitizado.

Não existe flag de ambiente ou configuração que abra o gate crítico nesta
proposta.

## Consequências

- nenhum resultado recebe Approval automática antes dos dois sinais de QA;
- trabalho reversível simples ou moderado mantém o fluxo assíncrono depois do
  QA aprovado;
- auto-modificação crítica continua com revisão humana adicional;
- Approval, TaskState, fencing, lease, execução, merge e deploy não ganham nova
  entidade ou estado;
- retry técnico, cutovers de enforcement e infraestrutura de evals permanecem
  fora desta decisão;
- `always_human` permanece byte-idêntico e prevalece em qualquer nível.
