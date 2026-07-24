# Estado Atual

## Fase

Fase 4 — Supervisor mínimo concluída em `phase-4-supervisor`, aguardando revisão
e merge. A Fase 5 não está autorizada e exige confirmação explícita separada.

## Implementado

- `AgentRuntime` próprio com implementação OpenAI e saída estruturada por Zod.
- GPT-5.6 Luna para normalização/classificação e GPT-5.6 Terra para
  Specification.
- Fluxo auditado `NEW → NORMALIZING → ROUTING → SPECIFYING`.
- Specification executável imutável, versionada e com hash canônico
  determinístico.
- Política de autonomia lê `Project.autonomyLevel` e `always_human`: nível 2
  envia tarefas simples/moderadas a `QUEUED` e críticas/sensíveis a
  `WAITING_APPROVAL`.
- Aprovação automática persiste Approval `SYSTEM/POLICY/APPROVED`, alvo
  versionado/hash e AuditEvent.
- Decisão Telegram recalcula o hash vigente da Specification e rejeita
  divergência com erro estruturado e AuditEvent.
- Consumo de LLM registrado por chamada com agente, modelo, tokens, custo
  estimado e latência; teto mensal configurável com default US$ 25.
- Migração adiciona `autonomy_level`, ator/canal de Approval e `llm_calls`.
- Grafo canônico em código inclui `TESTING → FINALIZING`.
- Fases 1–3 permanecem integradas; ADR-013, ADR-014 e ADR-015 permanecem
  Propostos.

## Testes e validações

- Instalação com lockfile congelado: aprovada.
- Formatação, Prisma generate/validate, lint, typecheck e build: aprovados.
- Testes unitários/API/contrato: 33 aprovados; nenhum chamou a API real.
- Três migrações aplicadas do zero em PostgreSQL 17 efêmero.
- Seed executado com sucesso.
- Testes de integração PostgreSQL: 5 aprovados.
- Nenhum deploy, credencial real, worker, execução Codex ou conselho multiagente.

## Decisões vigentes

- ADRs 001–012 aceitos; ADRs 013–015 Propostos.
- Repositório remoto canônico: GitHub privado `hcfly2x/ATLAS`, com branch + PR.
- Nível 2 é o default decidido; produção, secrets de produção, paths protegidos e
  demais ações `always_human` continuam humanas.
- O hard limit de US$ 25/mês também deve permanecer configurado no dashboard da
  OpenAI.
- Worker continua macOS/ARM64, sem Docker/banco e com concorrência 1.

## Próximo passo

Auditar o PR da Fase 4. Merge e Fase 5 dependem de autorização explícita.

## Restrições ativas

- não fazer merge desta branch sem autorização;
- não iniciar a Fase 5;
- não implementar worker, Codex, worktree, consumo de fila, commit ou PR
  automáticos;
- não implementar conselho multiagente, dashboard ou Fase 10;
- não provisionar staging/produção nem criar `render.yaml`;
- não alterar ADRs aceitos ou o status Proposto dos ADRs 013–015;
- não executar deploy nem integrar credenciais reais.
