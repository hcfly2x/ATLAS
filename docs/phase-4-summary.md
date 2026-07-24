# Resumo técnico — Fase 4

## Objetivo executado

Implementar o Supervisor mínimo do coordinator, sem conselho multiagente:
normalização, classificação de complexidade, geração de Specification validada e
versionada, hash canônico, política de autonomia e controle mensal de custo.

## Decisões aplicadas

- `AgentRuntime` é a fronteira própria do ADR-008; OpenAI é a implementação
  operacional inicial.
- GPT-5.6 Luna atende normalização e roteamento; GPT-5.6 Terra produz a
  Specification.
- A mesma estrutura validada por Zod é serializada canonicamente antes do
  SHA-256; ordem de chaves não altera o hash e mudança de valor altera.
- No nível 2, `simple` e `moderate` seguem para `QUEUED`; `critical` e ações
  `always_human` seguem para `WAITING_APPROVAL`.
- Dispensa humana persiste Approval `SYSTEM/POLICY/APPROVED`, alvo versionado,
  hash e AuditEvent.
- O teto deliberativo agregado é US$ 25/mês por default. O bloqueio ocorre antes
  de uma nova Task, sem interromper deliberação já iniciada.
- Aprovação Telegram de Specification recalcula o hash canônico vigente e
  rejeita divergência com erro estruturado e AuditEvent persistido.
- `TESTING → FINALIZING` foi alinhada no grafo de código; a decisão de aprovação
  de resultado continua fora desta fase.

## Estrutura criada

- `packages/agent-runtime`: interface, runtime OpenAI, modelos e contabilização
  estimada de custo.
- `apps/coordinator/src/supervisor`: serviço, store Prisma, política/configuração
  e testes.
- Endpoint autenticado `POST /internal/tasks/:taskId/supervise`.
- Migração para autonomia do projeto, ator/canal de Approval e `llm_calls`.
- Schemas compartilhados para demanda normalizada e Specification executável.

## Testes executados

- Typecheck completo do monorepo.
- 32 testes unitários/API/contrato com runtime falso e zero chamadas à API real.
- Três migrações aplicadas do zero em PostgreSQL 17 efêmero.
- Seed executado com sucesso.
- Cinco testes de integração em PostgreSQL real.
- Pipeline completa `pnpm validate` executada antes da publicação.

## Riscos remanescentes

- O limite do ATLAS usa custo estimado a partir de tokens; o hard limit de US$ 25
  também precisa permanecer configurado no dashboard do provedor.
- A verificação do teto ocorre no início da Task. Chamadas concorrentes podem
  iniciar abaixo do teto e, somadas, ultrapassá-lo; serialização/reserva de
  orçamento é endurecimento futuro.
- Falha entre chamadas deixa a Task no último estado persistido para diagnóstico;
  não há retry deliberativo automático nesta fase.
- `/status` e `/cancel` sem argumento ainda não filtram pelo projeto selecionado.
- A mensagem para Approval já decidida continua genérica.
- Nada consome Tasks em `QUEUED`; worker e execução Codex pertencem à Fase 5.

## Próxima tarefa recomendada

Auditar e, se aprovada, integrar a Fase 4. A Fase 5 exige autorização explícita
separada.
