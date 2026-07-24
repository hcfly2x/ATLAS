# Changelog

## 0.0.4
- Codex confirmado no plano ChatGPT Pro.
- Teto lógico do Codex de US$ 75/mês definido para rastreamento pelo ATLAS; consumo incluído na assinatura Pro.
- Teto de US$ 25/mês da API OpenAI definido também como hard limit no dashboard do provedor.
- ADR-012 aceito na opção 1: idempotency keys, lease renovável e fencing token.
- Schema da Fase 2 obrigado a contemplar idempotência, lease e fencing desde a primeira migração.
- Epic 00 encerrado e Fase 1 — Foundation mínima autorizada explicitamente.

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
