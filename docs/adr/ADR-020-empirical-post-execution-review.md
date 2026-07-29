# ADR-020 — Evidência empírica pós-execução

## Status

Proposto.

## Contexto

O QA pós-execução revisa contrato, resumo, testes e diff, mas ainda depende da
evidência produzida pelo próprio fluxo de execução. Uma revisão mais confiável
precisa repetir verificações declaradas na worktree entregue, sem criar um
segundo executor autoritativo nem permitir comandos livres.

## Proposta

- o worker, enquanto a worktree ainda existe, executa uma instalação declarada
  com lockfile congelado e somente os comandos `runtime.validate` declarados;
- todos os comandos passam pelo mesmo autorizador/allowlist existente;
- o diff é comparado de forma fail-closed ao `authorized_scope` imutável;
- a evidência é limitada, sanitizada e não contém args, output ou payload bruto;
- `EmpiricalReview` persiste payload e hash imutáveis por Execution, com
  veredito `PASS|FAIL|UNAVAILABLE`;
- a evidência é entrada do revisor LLM pós-execução existente. Ela nunca aprova,
  rejeita, finaliza ou altera a Task sozinha;
- exceção, timeout, ausência de runtime ou negação do comando produzem
  `UNAVAILABLE`, sem afetar lease, fencing ou a execução já entregue.

O worker é o produtor da evidência empírica; o supervisor continua fora desse
papel. O revisor LLM e a Approval existente permanecem os únicos gates de
decisão antes de `FINALIZING`.

## Consequências

- falhas reproduzíveis e escapes de escopo ficam visíveis ao QA antes da
  finalização;
- o registro empírico é auditável e não pode ser editado ou apagado;
- projetos sem runtime reproduzível ficam explicitamente `UNAVAILABLE`, nunca
  aprovados por ausência de prova;
- probes gerados, diversidade de provedor e QA empírico autoritativo continuam
  fora deste ADR.
