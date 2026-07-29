# Epic — Alinhamento com práticas e ecossistema de mercado

## Status

Escopo exclusivamente documental. Execução não autorizada.

## Objetivo

Manter uma fila explícita de capacidades e modelos de mercado que podem
preencher lacunas reais do ATLAS sem transferir sua governança para frameworks
externos. A fonte de contexto desta fila é `docs/market-alignment.md`.

Registrar uma capacidade neste epic não autoriza ADR, dependência, fase,
implementação, deploy ou adoção.

## Linhas candidatas

- MCP como interface aberta do futuro Tool Gateway, com
  `allow|deny|require_human` e `always_human` decididos pelo ATLAS;
- conhecimento documental no PostgreSQL atual, priorizando `pgvector`,
  retrieval fino em TypeScript e MarkItDown antes de avaliar LlamaIndex;
- modelo de grafo de LangGraph somente para deliberação que demonstre essa
  necessidade, nunca como fonte de estado, checkpoint ou Approval;
- papéis de escritório como funções sobre watchdog, QA, evals e custo, não como
  runtimes;
- OpenHands somente como possível worker adicional após abstração de provedor.

CrewAI, AutoGen, LangGraph como “OS” e Open WebUI no núcleo estão rejeitados.
A2A não será avaliado por enquanto.

## Ordem vinculante para propostas futuras

1. fechar enforcement;
2. ampliar observabilidade e evals;
3. propor MCP e Tool Gateway governado;
4. propor conhecimento documental no primeiro domínio não-código;
5. somente depois avaliar mais workers, provedores ou grafos deliberativos.

## Gates para qualquer avanço

- lacuna concreta e evidência de que a base existente não basta;
- ADR próprio em estado Proposto;
- autorização explícita para a fase;
- preservação da máquina de estados canônica, fencing, `always_human` e
  enforcement determinístico;
- nenhuma ação externa sem passar pelo Tool Gateway governado.

## Fora de escopo

- código, dependência, schema, migração, política ou autonomia;
- alteração de `.atlas/**`, máquina de estados ou ADR vigente;
- iniciar shadow, cutover, MCP, RAG, OpenHands ou qualquer implementação;
- declarar qualquer capacidade como entregue.
