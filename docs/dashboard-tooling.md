# Guia de tooling da Dashboard

## Status e autoridade

Este documento registra um guia de implementação para o frontend da Dashboard.
A Fase 0 e, em entrega posterior própria, a UI read-only da Trilha A foram
autorizadas e implementadas. Isso não autoriza nova dependência, rota de escrita
ou fase posterior. Para todo o restante vale a regra **registrado não equivale
a autorizado**.

O guia é subordinado aos arquivos canônicos do repositório, em especial
`specifications/project-manifest.yaml`, `docs/dashboard-operational-plan.md`,
`docs/product-philosophy.md`, `docs/security.md` e os ADRs. Em qualquer
divergência, os canônicos prevalecem.

## Base que não deve ser refeita

O PR #52 entregou o read-model de Mission Control no backend. O frontend deve
consumi-lo, não reimplementá-lo. O coordinator permanece o backend canônico e
não haverá segundo backend, ORM, banco ou fonte de verdade para a Dashboard.

Atlas Intelligence v1 permanece determinística. Uma narrativa por LLM é
possibilidade futura, assíncrona, cacheada e não bloqueante; sua ausência ou
falha nunca pode impedir a interface nem inventar progresso, custo ou estado.

## Núcleo da Fase 0

Os itens abaixo foram autorizados para a preparação sob o ADR-024 Proposto.
Qualquer ampliação exige ADR e autorização próprios:

- `apps/dashboard`: React, Vite e TypeScript estrito;
- interface: Tailwind e shadcn/ui;
- navegação e dados: React Router, TanStack Query e TanStack Table;
- contratos em runtime: Zod;
- testes: Vitest, React Testing Library, Playwright e axe-core;
- diagnóstico de desenvolvimento: React Doctor;
- `@atlas/contracts`: pacote compartilhado de contratos Zod
  backend↔frontend, com read models orientados ao workflow.

O pacote de contratos deve compartilhar a forma pública dos read models sem
transportar conteúdo cru, detalhes internos ou uma segunda regra de negócio
para o frontend.

## Tooling do Codex

shadcn MCP, Playwright CLI e React Doctor foram configurados como tooling de
desenvolvimento, não dependências de produção. OpenAI Build Web Apps permanece
opcional quando o plugin estiver instalado; não há instalação silenciosa.

- OpenAI Build Web Apps;
- shadcn MCP;
- Playwright CLI;
- React Doctor.

Vercel Web Design Guidelines é opcional e só pode ser usada após auditoria.
Ferramenta externa não substitui contrato, teste, revisão ou governança do
ATLAS.

## Skills próprias do ATLAS

Três skills devem codificar a governança da Dashboard no ambiente do Codex:

- `atlas-dashboard-guardrails`: preserva read-only, segurança, workflow-first e
  as fronteiras de autorização;
- `atlas-dashboard-contracts`: orienta o consumo do read-model e a validação dos
  contratos compartilhados;
- `atlas-frontend-qa`: exige testes de comportamento, acessibilidade,
  não-vazamento e verificação visual proporcional.

Estas são skills versionadas do fluxo de desenvolvimento em `.agents/skills`.
Elas não alteram `.atlas/**`, não implementam o catálogo de skills de agentes
do ADR-016 e não ampliam permissões.

## Fase 0 — Preparação

A preparação anterior à UI reúne:

1. ADR do stack frontend;
2. scaffold de `apps/dashboard`;
3. criação de `@atlas/contracts`;
4. criação das três skills do ATLAS;
5. configuração do tooling do Codex.

**Estado:** autorizada e implementada nesta entrega. O ADR-024 está Proposto,
`apps/dashboard` nasceu como shell técnico sem dados ou ações,
`@atlas/contracts` valida o wire format real de Mission Control e as três skills
e o tooling estão versionados. A interface read-only da Trilha A foi autorizada
e implementada em entrega posterior; qualquer escrita ou fase seguinte continua
sem autorização.

## Build e serving

O coordinator publica o output Vite de `apps/dashboard` em `/dashboard`. A
dependência workspace `@atlas/dashboard` no coordinator faz `turbo run build`
construir o frontend antes do coordinator. O comando de build do serviço
hospedado permanece:

```bash
pnpm install --frozen-lockfile
pnpm build
```

O runtime continua iniciado por `pnpm --filter @atlas/coordinator start` e
encontra `apps/dashboard/dist` a partir da raiz do monorepo. O shell e os assets
não exigem configuração ou segredo no bundle.

## Itens não adotados agora

Não usar como base da Dashboard:

- LangGraph;
- CrewAI;
- AutoGen;
- OpenHands;
- OpenManus;
- LlamaIndex;
- Open WebUI.

Sem ADR próprio, também não usar:

- Next.js;
- Supabase;
- Redux;
- GraphQL;
- tRPC;
- WebSocket ou SSE;
- Material UI, Ant Design ou Tremor;
- templates de admin;
- microfrontends;
- outro ORM, banco ou backend.

## Guardrails de produto e segurança

- O frontend permanece somente leitura até a Trilha C.
- Escrita só entra depois de autenticação, RBAC, auditoria e autorização
  próprios, reutilizando `Approval`, `always_human` e a máquina de estados.
- A UI usa os mesmos controles existentes de autenticação e exposição.
- Não expor prompt, resposta, payload, `messageText`, destino, segredo ou
  conteúdo cru.
- Não colocar métricas técnicas na Home.
- Não criar gráficos sem decisão associada.
- Não inventar progresso, horas ou custo sem metodologia verificável.
- Não colocar chat no centro do produto.
- Não organizar telas pelo organograma.
- Não criar páginas sem workflow.
- Não expor chain-of-thought.
- Não usar 3D, avatares ou animações decorativas.
