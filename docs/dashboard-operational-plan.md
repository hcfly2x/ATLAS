# Plano operacional oficial da Dashboard

## Status e regra de autorização

Este documento é o plano oficial de implementação da Dashboard do ATLAS. Ele
substitui a ideia anterior de uma “Fase 10 — Dashboard” monolítica ou de um
“escritório virtual” tratado como coleção de telas.

O plano estar oficializado não autoriza sua execução. Para cada trilha e fase
vale a regra **registrado não equivale a autorizado**: código, dependências,
schema, migração, autenticação, rotas de escrita ou mudança de política exigem
ADR e autorização explícita próprios e devem respeitar a estabilização em
curso.

Referências históricas à Dashboard como uma Fase 10 única devem ser lidas à luz
deste plano. O modelo de escritório pode nomear papéis e funções, mas não define
a arquitetura da interface nem cria runtimes paralelos.

## Enquadramento

Este plano não redesenha o sistema multiagente. Ele transforma a Dashboard na
interface operacional principal sobre o backend existente:
`Task`, `Specification`, `Execution`, `Approval`, `Worker`, `AuditEvent`, memória
e QA já cobrem aproximadamente 50–60% do modelo necessário.

A organização é por **workflow — o ciclo de vida da demanda —**, não por páginas.
As telas são consequência do fluxo:

```text
Criar demanda
→ CEO entende
→ Plano
→ Execução
→ Perguntas
→ Aprovação
→ Entrega
→ Arquivamento
```

## Centro do produto: Workspace da Demanda

O usuário deve permanecer no Workspace da Demanda durante toda a vida do
trabalho, com o mínimo de navegação entre menus. Esse ambiente concentra:

- conversa;
- plano e tarefas;
- progresso;
- equipe;
- custos;
- timeline;
- entregáveis;
- aprovações;
- decisões;
- histórico;
- arquivos;
- memória.

## Camada diferencial

Esta camada tem prioridade alta e começa cedo por ser somente leitura.

### Atlas Intelligence

Resumo executivo no topo da Dashboard, gerado pelo ATLAS no papel de **Chief of
Staff**. Informa riscos, o que aprovar primeiro, o que está parado e o que foi
concluído. Não é um resumo de métricas.

### Proatividade

O ATLAS encontra o usuário: avisa riscos, atrasos, oportunidades, custo anormal,
retrabalho, gargalos, aprovações esquecidas e integrações quebradas. Essa
capacidade estende o watchdog existente.

### Mission Control — Home

A Home permite entender a empresa em segundos:

- o que precisa de mim;
- o que está acontecendo;
- o que está parado;
- o que concluiu;
- onde há risco;
- qual é a prioridade agora.

A Home fala de **trabalho, não de infraestrutura**.

## Papel do CEO

O CEO age como gerente de projeto, não como chat. Ele:

- informa riscos;
- sugere prioridades;
- avisa gargalos;
- pede decisões;
- reorganiza o plano;
- recomenda próximos passos.

## Tooling, stack e skills (Fase 0 implementada; ampliações não autorizadas)

O read-model de Mission Control entregue pelo PR #52 é o backend da primeira
interface. A UI da Trilha A consome esse contrato; não
reimplementar o read-model nem criar um backend concorrente. O coordinator
permanece o backend canônico. Atlas Intelligence v1 continua determinística;
uma narrativa por LLM, se autorizada no futuro, será assíncrona, cacheada e não
bloqueante.

O núcleo adotável para `apps/dashboard` é React, Vite, TypeScript estrito,
Tailwind, shadcn/ui, React Router, TanStack Query, TanStack Table, Zod, Vitest,
React Testing Library, Playwright, axe-core e React Doctor como ferramenta de
desenvolvimento. Os contratos Zod orientados a workflow entre backend e
frontend devem viver em um pacote compartilhado `@atlas/contracts`.

O núcleo da Fase 0 foi autorizado sob o ADR-024 Proposto; ampliações continuam
exigindo ADR e autorização próprios antes de instalação ou scaffold. O guia de
implementação está em `docs/dashboard-tooling.md` e é
subordinado a `specifications/project-manifest.yaml` e aos demais documentos
canônicos. Em caso de divergência, os canônicos prevalecem.

shadcn MCP, Playwright CLI e React Doctor foram configurados como tooling do
ambiente de desenvolvimento do Codex, não dependências de produção. OpenAI
Build Web Apps permanece opcional quando o plugin estiver instalado e não é
instalado silenciosamente. Três skills próprias do ATLAS codificam a governança desse
trabalho no Codex: `atlas-dashboard-guardrails`,
`atlas-dashboard-contracts` e `atlas-frontend-qa`. Elas não criam ações do
produto, não alteram `.atlas/**` e não ampliam permissões. Vercel Web
Design Guidelines permanece opcional e sujeito a auditoria.

Não entram agora LangGraph, CrewAI, AutoGen, OpenHands, OpenManus, LlamaIndex ou
Open WebUI como base da Dashboard. Sem ADR próprio, também não entram Next.js,
Supabase, Redux, GraphQL, tRPC, WebSocket, SSE, Material UI, Ant Design, Tremor,
templates de admin, microfrontends, outro ORM, banco ou backend.

A interface permanece somente leitura até a Trilha C e usa os controles
existentes de autenticação e exposição. Nenhuma resposta pode revelar prompt,
resposta, payload, `messageText`, destino, segredo ou conteúdo cru.

## Ordem de desenvolvimento

### Fase 0 — Preparação

Esta preparação anterior à UI reúne:

- propor o ADR do stack frontend;
- criar, somente depois de autorização, o scaffold de `apps/dashboard`;
- criar `@atlas/contracts` para os contratos Zod compartilhados;
- criar as três skills próprias do ATLAS para o ambiente do Codex;
- configurar o tooling de desenvolvimento do Codex.

**Estado:** autorizada e implementada nesta entrega como preparação técnica.
ADR-024 permanece Proposto; `apps/dashboard` partiu de um shell sem dados ou
ações, `@atlas/contracts` valida o read-model real, e skills/tooling estão
versionados. A Trilha A foi autorizada depois em entrega própria; qualquer
escrita continua não autorizada.

### Trilha A — Inteligência + Mission Control

Trilha somente leitura, de baixo conflito, priorizada para começar cedo:

- Atlas Intelligence;
- Home Mission Control;
- Proatividade v1 sobre sinais existentes:
  - aprovações esquecidas;
  - atrasos;
  - custo anormal;
  - integrações quebradas.

É a maior alavanca inicial de valor e não exige rota de escrita.

**Estado:** v1 autorizada e implementada ponta a ponta. O frontend React consome
somente `GET /dashboard/api/mission-control`, valida a resposta por
`@atlas/contracts` e preserva autenticação Bearer. O resumo é determinístico e
sem LLM; progresso deriva do estado real, ETA sem metodologia aparece como
indeterminado e os alertas não executam ação. Narrativa por LLM e qualquer
escrita continuam fases futuras não autorizadas.

### Trilha B — Workspace da Demanda

Construir primeiro a leitura de um ambiente único para toda a vida da demanda:

- conversa, plano e tarefas;
- progresso, equipe, custos e timeline;
- entregáveis e aprovações;
- decisões, histórico, arquivos e memória.

Inclui **Replay operacional** de eventos, decisões, ferramentas, resultados,
arquivos e aprovações — sem chain-of-thought.

**Estado:** B1 autorizada e implementada no backend. O coordinator expõe somente
`GET /dashboard/api/demand/:taskId`, protegido pela mesma fronteira loopback +
Bearer da Dashboard, e `@atlas/contracts` valida a resposta estrita. A projeção
permite objetivo, estratégia e critérios próprios da demanda; argumentos,
payloads, conteúdo de memória, prompts, respostas e saídas cruas permanecem
fora do contrato. A UI do Workspace e o Replay são B2 e continuam pendentes de
fase e autorização próprias.

### Trilha C — Comando e escrita

Este é o degrau de risco:

- autenticação e RBAC;
- rotas de escrita;
- Command Center, no qual a busca vira comando no estilo
  Spotlight/Command Palette:
  - criar demanda;
  - pausar, cancelar ou priorizar;
  - “resuma minha semana”;
  - “o que recomenda agora”;
- ações dentro do Workspace;
- aprovações contextuais pela UI.

A UI reutiliza o modelo `Approval` imutável, idempotente e versionado e as
regras de `always_human`. Ela é cliente do mesmo modelo; nunca cria um botão de
aprovação paralelo. Toda escrita exige auditoria completa. Nada faz auto-merge
ou deploy.

### Trilha D — Projeto como empresa independente

- workspace do projeto com contexto automático:
  - memória;
  - decisões;
  - equipe;
  - documentos;
  - roadmap;
  - custos;
  - backlog;
  - entregáveis;
- biblioteca `Deliverable`/`Artifact`;
- custo real e `Budget`.

As visões de custo dependem da implementação prévia do plano de custo de LLM já
documentado.

### Trilha E — Confiabilidade e melhoria

Trilha posterior, com conteúdo técnico em áreas específicas:

- OTel e observabilidade, fora da Home;
- saúde e incidentes, estendendo o watchdog;
- notificações;
- conhecimento/RAG com `pgvector`;
- registro de decisões;
- roadmap e milestones;
- configuração por linguagem natural;
- templates;
- analytics.

## Não priorizar

Permanecem excluídos:

- avatares;
- animações;
- escritório 3D;
- chain-of-thought;
- dezenas de gráficos na Home;
- métricas técnicas na Home;
- gráficos sem decisão;
- chat como centro;
- telas organizadas por organograma;
- páginas sem workflow;
- “horas economizadas” sem metodologia;
- progresso inventado;
- Grafana na Home.

## Governança e sequência

- Este é um plano paralelo priorizado, sem atropelar os cutovers de enforcement,
  evals ou o loop de auto-desenvolvimento em curso.
- A Trilha C é a fronteira sensível: exige autenticação, RBAC e auditoria
  completa e preserva `always_human`, `Approval` e a máquina de estados
  canônica.
- Métricas e progresso só entram com metodologia verificável.
- Nenhuma interface expõe chain-of-thought.
- Cada trilha e fase exige ADR e autorização explícita antes de virar código.
