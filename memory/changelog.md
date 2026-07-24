# Changelog

## 0.0.13

- ADR-016 criado como Proposto para skills versionadas e anexáveis a agentes.
- ADR-017 criado como Proposto para personas declaradas em documentos
  versionados.
- Epics de roadmap adicionados para modo consulta e tarefas
  agendadas/webhooks, ambos sem fase ou execução autorizada.
- Epic 07 passou a exigir revisor diferente do emissor da Specification,
  modelos distintos para revisor/supervisor e AuditEvent por parecer e rodada
  no critério de aceite.

## 0.0.12

- Preferência `/verbose 0|1|2` persistida em `TelegramSession`.
- Publicador Telegram idempotente adicionado para atividade, marcos, chunks
  persistidos com throttling e resultado final.
- Dashboard operacional somente-leitura criado em `/dashboard`, restrito ao
  loopback e com APIs protegidas por token.
- Painel passou a exibir estados canônicos, detalhe completo de Task, AuditEvent,
  custos LLM/Codex e memória por projeto.
- Sexta migração adicionou nível de verbosidade e cursores de entrega Telegram.
- Independência entre o dashboard somente-leitura e o ADR-013 registrada.
- Auditoria registrou a semântica `at-least-once` da publicação Telegram e a
  futura otimização da consulta de chunks como pendências não bloqueadoras.

## 0.0.11

- Pilot Setup Wizard simplificado para repositório e comandos de teste no fluxo
  principal, com opções avançadas recolhidas.
- Defaults alterados para US$ 2 por tarefa e retenção sensível de 7 dias.
- Versões mínimas em `required_tools` deixaram de bloquear a ativação.
- Autodetecção segura adicionada para nome/ID e comando editável a partir de
  `package.json`, `pyproject.toml` ou `Makefile`.
- Fase 6 registrada como integrada na `main` v0.0.10.

## 0.0.10

- Fase 6 — memória por projeto implementada.
- `MemoryItem` adicionado ao Prisma com Project obrigatório, Task/agente
  opcionais, hash e idempotência.
- API interna autenticada criada para memória manual, listagem e contexto.
- Context builder determinístico, limitado e fail-closed extraído em
  `@atlas/memory`.
- Supervisor passou a receber somente a memória do Project da Task.
- Finalização do worker passou a criar resumo de Task auditado atomicamente.
- Quinta migração, contratos, Epic 06 e testes de isolamento adicionados.
- Teste de integração Telegram deixou de reutilizar callback fixo entre runs.

## 0.0.9

- Pilot Setup Wizard local adicionado em `/setup`, sem antecipar o dashboard.
- Configuração lê, valida e salva `.atlas/projects.yaml` de forma atômica,
  preservando campos fora do formulário.
- Ativação exige repositório Git absoluto, ferramentas mínimas, allowlist
  estruturada, teto por tarefa e retenção coerente.
- Escritas HTTP exigem intenção explícita e toda a fronteira permanece restrita
  ao loopback.
- Seed unificado com o mesmo schema de configuração usado pelo wizard e worker.
- Scripts locais adicionados para abrir o wizard e carregar o coordinator a
  partir de `.env.local`, sem copiar ou versionar credenciais.
- Boot independente do app principal e do Prisma Client gerado, permitindo usar
  `pnpm pilot` imediatamente após a instalação das dependências.

## 0.0.8

- Fase 5 — Worker + Codex + Git concluída em branch própria.
- Divisão de responsabilidades entre Telegram e dashboard registrada.
- Worker passou a usar preflight real macOS/ARM64 e concorrência 1.
- Registro, heartbeat, long-polling, lease renovável, fencing e idempotência
  implementados.
- Resultado integral do worker validado por Zod, com chunks sanitizados,
  checksums e hashes canônicos.
- Codex CLI e Git encapsulados em adapters operacionais sem shell.
- Worktree/branch isoladas, testes, paths protegidos, cleanup e PR draft
  implementados.
- Política de resultado aplica Approval automática de sistema no nível 2 ou
  escala para aprovação humana.
- Retry técnico nível 3 condicionado a reconciliação e fencing.
- Consumo lógico Codex e teto mensal default US$ 75 persistidos separadamente.
- Quarta migração adicionou payload/hashes de resultado, chunks e uso Codex.
- Transições do resultado e da finalização passaram a usar guarda otimista de
  estado/versão e o AuditEvent canônico, preservando `CANCEL_REQUESTED`.
- Cancelamento passou a tratar também o sinal abortado antes do registro do
  listener do CodexAdapter, eliminando corrida observada no CI da `main`.

## 0.0.7

- ADR-014 criado como Proposto para níveis de autonomia 0–4 por projeto.
- Nível 2 registrado como padrão decidido para todos os projetos.
- Aprovação automática definida com Approval `actor=system`, alvo versionado,
  hashes e AuditEvent.
- Máquina conceitual ganhou apenas `TESTING → FINALIZING` quando a política
  dispensa aprovação humana de resultado.
- `autonomy_level` adicionado à configuração de projetos, com default 2.
- Política `always_human` consolidada; staging e produção passaram a ser tipos de
  deploy distintos.
- ADR-015 criado como Proposto para staging e produção separados no Render.
- Enforcement distribuído como obrigação das Fases 4–5 e infraestrutura
  pós-Fase 3, sem implementação ou provisionamento.
- Fase 4 — Supervisor mínimo concluída em branch própria.
- Interface `AgentRuntime` e implementação OpenAI adicionadas com Luna para
  normalização/classificação e Terra para Specification.
- Fluxo NEW → NORMALIZING → ROUTING → SPECIFYING implementado com auditabilidade.
- Specification passou a usar schema Zod, versão e hash canônico determinístico.
- Política de nível 2 aplicada com Approval explícita de sistema quando a
  aprovação prévia é dispensada.
- Decisão Telegram valida o `target_hash` canônico vigente e audita divergências.
- Migração adicionou autonomia do Project, ator/canal da Approval e consumo de
  LLM por chamada.
- Teto deliberativo mensal configurável bloqueia novas deliberações ao atingir o
  limite, sem interromper tarefas iniciadas.
- Grafo de código alinhado com `TESTING → FINALIZING`.

## 0.0.6

- Fase 3 — Telegram MVP concluída.
- Webhook passou a exigir secret não vazio para ser registrado; polling continua
  disponível sem expor a rota.
- Replay idempotente deixou de reenviar mensagens, preservando o
  `answerCallbackQuery` de callbacks repetidos.
- Webhook validado por handler Fastify injetável e long-polling escolhido para
  desenvolvimento sem URL pública.
- Autorização restrita a um único Telegram ID.
- Seleção de projeto, texto para Task, status, aprovação e cancelamento
  cooperativo implementados.
- Updates e callbacks persistidos com idempotência conforme ADR-012.
- Approval consumida pelo Telegram com alvo, ID, versão e hash preservados.
- Rotas internas protegidas por Bearer token obrigatório.
- Semântica de 409/retry concorrente documentada.
- Migração adicionada para sessões Telegram e replay de updates.
- `@types/node` alinhado à linha 22.

## 0.0.5

- Fase 1 aceita com ressalvas; workspace Vitest morto removido. A allowlist
  `allowBuilds` da base foi ampliada para Prisma conforme o formato exigido pelo
  pnpm 11.9.
- Fase 2 — Core mínimo do Coordinator concluída.
- Logging real Fastify/Pino com correlation ID substituiu log embutido no `/health`.
- Package `core` criado com máquina de estados canônica e concorrência otimista.
- Prisma schema e migração inicial adicionados para as sete entidades MVP.
- Idempotency keys, lease renovável e fencing token incluídos desde a primeira migração.
- Specification imutável e AuditEvent append-only protegidos por triggers PostgreSQL.
- API interna de Task criada com transições auditadas e idempotentes.
- Seed validado de projetos adicionado.
- CI ampliada com PostgreSQL, migração, seed e testes de integração.
- PostgreSQL local do ATLAS passou a usar a porta configurável 5433 por padrão.
- Repositório privado canônico registrado como `hcfly2x/ATLAS`, com fluxo de
  branch + PR e limitação atual de branch protection documentada.
- Node.js mínimo e CI alinhados em 22.13 para compatibilidade com pnpm 11.9.0.
- Fase 2 aceita sem correções de código e Fase 3 autorizada para começar somente
  após a integração sequencial das branches anteriores.
- Obrigações vinculantes registradas para autenticação interna na Fase 3, replay
  idempotente concorrente na documentação e hash canônico na Fase 4.
- Fluxo documental de ideias registrado: GitHub Issue, triagem externa, memória
  oficial e execução somente na fase correspondente.
- Fase 10 passou a registrar criação/edição de agentes e organização em times
  via interface.
- ADR-013 criado como Proposto para decidir, apenas na Fase 10, onde persistir a
  configuração de agentes editada pela UI.

## 0.0.4

- Codex confirmado no plano ChatGPT Pro.
- Teto lógico do Codex de US$ 75/mês definido para rastreamento pelo ATLAS; consumo incluído na assinatura Pro.
- Teto de US$ 25/mês da API OpenAI definido também como hard limit no dashboard do provedor.
- ADR-012 aceito na opção 1: idempotency keys, lease renovável e fencing token.
- Schema da Fase 2 obrigado a contemplar idempotência, lease e fencing desde a primeira migração.
- Epic 00 encerrado e Fase 1 — Foundation mínima autorizada explicitamente.
- Fase 1 concluída em worktree/branch isolada.
- Monorepo pnpm + Turborepo + TypeScript estrito criado com dois apps e seis packages.
- Fastify, pg-boss e Zod incorporados nas fronteiras previstas, sem feature de negócio.
- Pipeline local e CI configuradas para formatação, lint, typecheck, testes e build.
- PostgreSQL de desenvolvimento definido em Docker Compose apenas para o coordinator.
- Logging estruturado com correlation ID e restrições do worker cobertos por testes.

## 0.0.3

- Epic 00 revisado e aceito; Fase 1 permanecia não autorizada.
- Numeração das fases unificada pelo plano em duas trilhas.
- Máquina de estados revisada com SPECIFYING, FINALIZING, CANCEL_REQUESTED, failure_stage, retry técnico e retrabalho versionado.
- Specification, Approval e Execution vinculadas por versão e hash.
- Contrato documental de resultado do worker adicionado.
- Memória persistente restrita ao escopo de projeto.
- Autenticação do worker alinhada ao Bearer token do ADR-007.
- ADR-011 aceito para worker M1/macOS com concorrência 1 e perfil portátil BSD/GNU.
- ADR-012 criado como Proposto para idempotência, lease renovável e fencing token.
- Render definido para coordinator persistente e PostgreSQL gerenciado.
- OpenAI definido para deliberação: GPT-5.6 Terra padrão e GPT-5.6 Luna para normalização/roteamento.
- Tetos mensais registrados: US$ 25 para deliberação e US$ 75 para Codex no plano Pro.
- Retenção configurável por classificação, default 30 dias; auditoria sem expiração no MVP.
- Áreas protegidas mapeadas por área semântica e projetos passaram a declarar mínimos/defaults de ativação.
- Backlog realinhado às Fases 1–5 da Trilha 1; conselho movido para o Epic 07.

## 0.0.2

- Stack canônica consolidada (`project-manifest.yaml` é a fonte de verdade).
- ADRs 005–010 criados e aceitos; ADR-001 aceito.
- Modelo de dados conceitual e máquina de estados adicionados (`docs/data-model.md`).
- Plano reestruturado em Trilha 1 (MVP vertical) e Trilha 2 (expansão).
- Redis removido do MVP; conselho multiagente movido para a Trilha 2.
- Conselho de engenharia fixado em seis papéis; demais papéis marcados como futuros.
- Pendências reduzidas às que dependiam do usuário.

## 0.0.1

- Criado Project Starter Kit.
- Consolidada visão multiagente.
- Registrados projetos iniciais.
- Adicionadas políticas de segurança e execução.
