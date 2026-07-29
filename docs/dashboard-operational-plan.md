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

## Ordem de desenvolvimento

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

### Trilha B — Workspace da Demanda

Construir primeiro a leitura de um ambiente único para toda a vida da demanda:

- conversa, plano e tarefas;
- progresso, equipe, custos e timeline;
- entregáveis e aprovações;
- decisões, histórico, arquivos e memória.

Inclui **Replay operacional** de eventos, decisões, ferramentas, resultados,
arquivos e aprovações — sem chain-of-thought.

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
