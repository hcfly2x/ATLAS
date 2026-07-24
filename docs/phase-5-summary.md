# Resumo técnico — Fase 5

## Objetivo executado

Fechar a fatia vertical do MVP com worker local macOS/ARM64: registro,
long-polling, lease/fencing, Codex em worktree isolada, testes, resultado íntegro,
política de aprovação e abertura de pull request sem merge automático.

## Decisões aplicadas

- Telegram é a interface operacional móvel; dashboard futuro concentra inspeção,
  auditoria e configuração visual, sem duplicação integral.
- Worker permanece sem Docker/banco e com concorrência máxima 1 no MVP.
- Heartbeat e lease são mecanismos independentes.
- Specification versionada e hash validado são a única entrada do Codex.
- CLI Codex e comandos de projeto são executados sem shell.
- Comando precisa coincidir com a allowlist estruturada; executável resolvido é
  registrado. Ferramentas GNU exigem declaração.
- Chunks têm checksum, sequência, limite, sanitização, backpressure e replay.
- Fencing token vigente é obrigatório em renovação, log, resultado e finalização.
- Testes verdes e ausência de paths protegidos permitem `FINALIZING` no nível 2,
  com Approval `SYSTEM/POLICY`; caso contrário há aprovação humana.
- Retry automático nível 3 só abrange `network|timeout` após lease liberado e
  reconciliação; `lease_expired` exige confirmação explícita de término.
- Teto lógico Codex default US$ 75/mês é separado do orçamento OpenAI.

## Estrutura criada

- Rotas worker no coordinator para registro, heartbeat, claim, lease, chunks,
  resultado e finalização.
- `WorkerService` com escopo de projeto, idempotência, orçamento e política.
- Migração para hashes/payload de resultado, chunks e `codex_usages`.
- Worker com cliente HTTPS, preflight, allowlist, matching de paths, runner,
  cancelamento e concorrência.
- Adapters operacionais para `codex exec`, Git worktree/commit/push e PR draft.
- Schema Zod integral de resultado em `packages/shared`.

## Testes executados

- Pipeline completa `pnpm validate`.
- 43 testes unitários/API/contrato sem API, push ou credenciais reais.
- Adapter Git em repositório temporário e Codex Adapter com binário falso.
- Quatro migrações e seed em PostgreSQL 17 efêmero.
- Seis testes de integração PostgreSQL, incluindo lease, fencing, replay,
  conflito, orçamento, Approval automática e retry técnico nível 3.

## Riscos remanescentes

- Nenhum ciclo foi executado contra um repositório externo ou Codex real por
  desenho de segurança dos testes.
- O primeiro teste operacional precisa configurar projetos ativos, caminhos
  locais, versões, allowlist, paths e secrets fora do repositório.
- Reserva de orçamento não é serializada; claims simultâneos podem iniciar logo
  abaixo do teto antes de o consumo final ser conhecido.
- Falha depois do push e antes da confirmação do coordinator exige reconciliação;
  o adapter consulta PR existente para evitar duplicação.
- Branch protection da `main` continua indisponível no plano atual.

## Próxima tarefa recomendada

Auditar o PR da Fase 5 e executar um piloto controlado somente após aprovação e
configuração explícita de um projeto. A Fase 6 não está autorizada.
