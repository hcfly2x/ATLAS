# Alinhamento com práticas e ecossistema de mercado

## Status e regra de autorização

Este documento registra decisões de alinhamento e uma ordem de avaliação. Ele
não autoriza adoção, dependência, fase, implementação ou execução. Para cada
capacidade adotável, vale a regra **registrado não equivale a autorizado**:
qualquer avanço exige ADR próprio, autorização explícita e respeito à ordem de
estabilização do ATLAS.

## Princípio

O ATLAS não é greenfield. O mercado deve ser avaliado pela pergunta “quais
lacunas reais isto preenche sem entregar a governança?”, e não como uma stack a
adotar. O modelo de “escritório virtual” — CEO, diretores que coordenam, workers
efêmeros, QA e memória — corresponde em aproximadamente 70% ao que o ATLAS já
é. Essa proximidade valida o desenho existente; não pede uma reescrita.

## Adotar como capacidade, não como framework

Os itens desta seção são direções candidatas sob ADR futuro. Nenhum deles está
autorizado para implementação por este documento.

### MCP como contrato da camada de ferramenta

Avaliar o MCP (Model Context Protocol) como contrato padrão da camada de
ferramenta e ação — o futuro Tool Gateway. O MCP é uma interface aberta e não
recebe a governança do sistema.

Toda ferramenta ou ação MCP deve passar obrigatoriamente pela decisão
determinística `allow|deny|require_human` e pelas regras de `always_human`. A
decisão permanece no ATLAS.

### Conhecimento documental

Avaliar conhecimento documental (doc RAG) com `pgvector`, uma camada fina de
retrieval em TypeScript e MarkItDown na ingestão. A capacidade deve permanecer
no PostgreSQL atual, sem introduzir outro datastore.

LlamaIndex só deve ser avaliado se a camada fina não for suficiente para uma
lacuna comprovada.

## Emprestar somente a interface ou o modelo mental

### LangGraph

O modelo de grafo pode orientar deliberação complexa futura, como modo consulta
e escritório. Se houver necessidade comprovada, avaliar `langgraphjs` restrito
à camada de deliberação.

LangGraph nunca será dono do estado, de checkpoints ou de Approval do ATLAS e
não deve ser adotado como “OS”.

### Papéis de escritório

Chief of Staff, RH de agentes, Auditor e Secretária podem nomear funções sobre
capacidades já existentes ou planejadas — watchdog, QA, evals e controle de
custo. Esses nomes não justificam novos runtimes.

## Rejeitar

- CrewAI e AutoGen, porque capturam a arquitetura;
- LangGraph como “OS”, com ainda mais força, porque criaria uma segunda fonte
  de verdade de estado em conflito com a máquina canônica e o fencing;
- Open WebUI no núcleo;
- A2A por enquanto.

Qualquer reconsideração futura continua sujeita a problema comprovado, ADR e
autorização próprios.

## Avaliar depois, atrás de abstração

OpenHands pode ser avaliado como worker adicional somente depois da abstração
de provedor. Esta possibilidade não autoriza dependência, integração ou
execução.

## Guardrails de governança

- substituição de agente, inclusive sob o nome “RH”, é `always_human`;
- nenhuma ação externa ocorre antes de existir um Tool Gateway governado;
- a máquina de estados canônica, `always_human` e o enforcement determinístico
  permanecem intocados;
- interfaces externas não recebem autoridade para decidir política, Approval,
  estado ou execução.

## Sequência de avaliação

1. Fechar o enforcement: shadow de comandos e, depois, cutover autorizado.
2. Construir observabilidade com trace por tarefa e evals, formando a base de
   dados para “RH” e Auditor de agentes.
3. Avaliar MCP e um Tool Gateway governado.
4. Avaliar conhecimento documental com `pgvector` e MarkItDown no primeiro
   agente de domínio não-código.
5. Somente então avaliar mais workers ou provedores, como OpenHands, e o modelo
   de grafo caso os fluxos demonstrem essa necessidade.

Esta sequência é uma ordem de dependência do roadmap, não autorização para
iniciar qualquer etapa.
