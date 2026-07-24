# Estado Atual

## Fase

Fase 6 — Memória por projeto integrada na `main` v0.0.10. Blocos A e B
integrados na `main` v0.0.12. Bloco C — registro documental de roadmap —
concluído em branch própria e pendente de revisão. A Fase 7 não está autorizada.

## Implementado

- Trilha 1 (Fases 1–5) integrada até v0.0.8; memória por projeto integrada na
  v0.0.10.
- Pilot Setup Wizard mínimo configura projetos com autodetecção segura.
- `/verbose 0|1|2`, atividade, marcos, logs limitados e resultado final
  disponíveis no Telegram.
- Dashboard operacional somente-leitura disponível no loopback e protegido por
  token.
- Garantia de publicação Telegram documentada como `at-least-once`.
- ADR-016 criado como Proposto para skills versionadas e anexáveis a agentes,
  separando papel de capacidade.
- ADR-017 criado como Proposto para persona em documento versionado com
  identidade, objetivo, limites e tom.
- Epic de modo consulta registrado para conversa 1:1 e rodada independente com
  N especialistas, sem fluxo executável.
- Epic de tarefas agendadas/webhooks registrado para cron persistente e entrada
  HMAC que criam Task pela política canônica.
- Epic 07 exige revisor diferente do emissor da Specification, modelos
  configuráveis separadamente e AuditEvent por parecer e rodada.

## Testes e validações

- Blocos A e B permanecem cobertos pela pipeline verde da `main` v0.0.12.
- Bloco C altera somente documentação, backlog, memória e metadados do kit.
- `pnpm validate` aprovado, incluindo formatação, Prisma, lint, typecheck, 67
  testes unitários/contrato e build.

## Decisões vigentes

- ADRs 001–012 aceitos.
- ADRs 013–017 permanecem Propostos.
- Os novos epics não possuem fase atribuída nem autorização de implementação.
- O ADR-017 não resolve nem altera o ADR-013.

## Próximo passo

Revisar o PR documental do Bloco C e executar o piloto real. Qualquer
implementação dos novos epics e a Fase 7 exigem autorização explícita separada.

## Restrições ativas

- não iniciar a Fase 7 ou conselho multiagente;
- não implementar skills, personas, modo consulta, scheduler ou webhooks;
- não atribuir silenciosamente os novos epics a uma fase existente;
- não provisionar staging/produção nem criar `render.yaml`;
- não alterar ADRs aceitos ou os status Propostos dos ADRs 013–017;
- não executar deploy nem integrar credenciais reais.
