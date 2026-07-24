# ADR-008 — Runtime dos agentes deliberativos

## Status
Aceito.

## Decisão
Agentes deliberativos (conselho e supervisor) rodam no coordinator (nuvem), via API de LLM encapsulada em `packages/agent-runtime` (interface própria, provedor trocável). O worker roda apenas o Codex.

## Motivo
Separação clara: deliberação é stateless e barata de rodar na nuvem; execução exige máquina com repositórios e ambiente. Interface própria evita lock-in de provedor.

## Consequências
- Orçamento por tarefa: teto de tokens/custo por deliberação, configurável por projeto.
- Toda chamada registra: agente, modelo, tokens, custo estimado, latência (Audit Service).
- Chaves de API ficam apenas no coordinator, nunca no worker nem em prompts.
