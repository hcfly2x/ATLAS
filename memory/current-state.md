# Estado Atual

## Fase

Bloco C integrado na `main` como v0.0.13. Fase 7 — Conselho multiagente —
aprovada para integração na `main` como v0.0.14 pelo PR #16. A Fase 8 não está
autorizada.

## Implementado

- Trilha 1 (Fases 1–5), memória por projeto, Pilot Setup Wizard, visibilidade
  Telegram e dashboard somente-leitura permanecem integrados.
- Registro de papéis e instruções carregado de `.atlas/agents.yaml` e `agents/`;
  roteamento canônico carregado de `.atlas/routing.yaml`.
- Rotas: simples usa contexto+supervisor; moderada acrescenta arquitetura e QA;
  crítica usa Produto, contexto, arquitetura, segurança e QA antes do supervisor.
- Primeira rodada produz pareceres independentes validados por Zod.
- Supervisor detecta somente divergências materiais, solicita no máximo uma
  segunda rodada focada e consolida sem votação por maioria.
- Revisor e emissor da Specification são papéis distintos; modelos de parecer e
  supervisor podem ser configurados separadamente.
- `Deliberation` e `AgentOpinion` persistidos; pareceres são append-only e cada
  parecer/início/conclusão de rodada gera AuditEvent com `task_id` e
  `correlation_id`.
- A máquina de estados não mudou: o conselho ocorre dentro de `SPECIFYING`.

## Testes e validações

- Migração aplicada sobre PostgreSQL local e testes de integração aprovados.
- `pnpm validate` aprovado com 72 testes unitários/contrato; 8 testes de
  integração PostgreSQL também aprovados.
- Persistência de pareceres, AuditEvents e trigger append-only exercitadas no
  banco real.
- Testes unitários cobrem configuração, roteamento moderado, independência do
  supervisor, segunda rodada focada, contratos Zod e limite de rodadas.

## Decisões vigentes

- ADRs 001–012 aceitos; ADRs 013–017 permanecem Propostos.
- ADR-003 é aplicado com pareceres independentes, supervisor consolidando e no
  máximo duas rodadas.
- GPT-5.6 Luna é o default configurável dos pareceristas; GPT-5.6 Terra permanece
  o modelo do supervisor.

## Riscos remanescentes

- Queda do coordinator no meio de uma rodada pode deixar Deliberation em
  `RUNNING` e Task em `SPECIFYING`; reconciliação retomável foi registrada para
  a Fase 11.
- O custo e a latência crescem com a complexidade e com a segunda rodada; o teto
  mensal existente continua bloqueando novas deliberações, sem interromper uma
  Task já iniciada.

## Próximo passo

Confirmar a integração e a pipeline da `main`. Não iniciar a Fase 8 sem
autorização explícita.

## Restrições ativas

- não iniciar a Fase 8;
- não implementar skills, personas, modo consulta, scheduler ou webhooks;
- não provisionar staging/produção nem criar `render.yaml`;
- não alterar ADRs aceitos ou os status Propostos dos ADRs 013–017;
- não executar deploy nem integrar credenciais reais.
