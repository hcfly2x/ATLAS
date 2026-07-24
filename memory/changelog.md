# Changelog

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
