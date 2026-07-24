# Estado Atual

## Fase

Fase 5 — Worker + Codex + Git concluída em `phase-5-worker-codex`, aguardando
revisão e merge. A Trilha 1 está implementada na branch; a Fase 6 não está
autorizada.

## Implementado

- Fases 1–4 integradas na `main` v0.0.7.
- Divisão vigente: Telegram operacional móvel; dashboard futuro para inspeção,
  auditoria e configuração visual.
- Worker outbound com registro, token Bearer por escopo, heartbeat e long-polling.
- Preflight real para macOS/ARM64, Node, Git, Codex CLI e ferramentas declaradas.
- Concorrência máxima 1 enquanto não houver telemetria autorizando elevação.
- Claim com lease renovável, fencing monotônico e idempotência.
- Specification versionada/hash validada como única entrada executável.
- Codex CLI não interativo em adapter, streaming sanitizado com backpressure,
  timeout e término da árvore de processos.
- Git worktree/branch isoladas, diff, cleanup, commit, push e PR draft.
- Allowlist estruturada, executável resolvido e GNU somente quando declarado.
- Resultado Zod completo com comandos, testes, chunks, hashes e replay.
- Paths protegidos bloqueiam finalização automática.
- Política de resultado cria Approval `SYSTEM/POLICY` no nível 2 ou solicita
  Approval humana ligada a `result_hash` e `diff_hash`.
- Retry técnico nível 3 somente após reconciliação e fencing.
- Teto lógico Codex US$ 75/mês registrado separadamente da deliberação OpenAI.
- Quarta migração para resultados, chunks e consumo Codex.

## Testes e validações

- Instalação e lockfile: aprovados.
- Formatação, Prisma generate/validate, lint, typecheck e build: aprovados.
- Testes unitários/API/contrato: 43 aprovados.
- Git testado em repositório temporário; Codex testado com binário falso.
- Quatro migrações aplicadas do zero em PostgreSQL 17 efêmero.
- Seed executado com sucesso.
- Testes de integração PostgreSQL: 6 aprovados.
- Nenhum push, PR real de projeto-alvo, Codex real, deploy ou credencial real nos
  testes.

## Decisões vigentes

- ADRs 001–012 aceitos; ADRs 013–015 Propostos.
- Repositório canônico: GitHub privado `hcfly2x/ATLAS`.
- Worker: Mac M1, 8 GB, macOS Tahoe 26.4, sem Docker/banco.
- Merge na `main`, produção, secrets de produção e paths protegidos continuam
  humanos.
- Fase 5 não altera status dos ADRs Propostos nem inicia memória da Fase 6.

## Próximo passo

Auditar o PR da Fase 5. Merge, piloto operacional e qualquer trabalho da Fase 6
dependem de autorização explícita.

## Restrições ativas

- não fazer merge desta branch sem autorização;
- não iniciar a Fase 6;
- não executar Codex real ou mudanças em repositórios externos como teste;
- não provisionar staging/produção nem criar `render.yaml`;
- não implementar dashboard, conselho multiagente ou memória por projeto;
- não alterar ADRs aceitos ou os status Propostos dos ADRs 013–015;
- não executar deploy nem integrar credenciais reais.
