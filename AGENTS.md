# AGENTS.md

## Instrução principal

Você está trabalhando no projeto ATLAS. Antes de alterar qualquer arquivo:

1. Leia `docs/master-implementation-specification.md`.
2. Leia `docs/architecture.md`.
3. Leia `docs/data-model.md`.
4. Leia `docs/security.md`.
5. Leia `docs/implementation-plan.md`.
6. Leia `docs/adr/` (todos os ADRs).
7. Leia `.atlas/` (agents, policies, projects, routing).
8. Leia `specifications/` e `templates/`.
9. Leia `memory/current-state.md`, `memory/decisions.md` e `memory/todos.md`.
10. Identifique a fase atual e o próximo item autorizado.

`specifications/project-manifest.yaml` é a fonte de verdade da stack. Divergências entre documentos devem ser reportadas, nunca resolvidas silenciosamente.

## Skills da Dashboard

Ao trabalhar no frontend ou nos contratos da Dashboard, use nesta ordem:

1. `atlas-dashboard-guardrails` para validar escopo, read-only e fronteiras de governança.
2. `atlas-dashboard-contracts` ao criar ou consumir read models públicos.
3. `atlas-frontend-qa` antes da entrega para executar a validação proporcional.

OpenAI Build Web Apps pode auxiliar somente trabalho frontend já autorizado
quando o plugin estiver instalado. Sua ausência não autoriza instalação global,
mudança de stack ou ampliação de escopo.

## Regras permanentes

- Não implementar funcionalidades fora do escopo atual.
- Não executar deploy, merge, exclusão de dados ou alteração de produção sem aprovação explícita.
- Não trabalhar diretamente na branch principal.
- Usar branch e worktree isoladas por tarefa.
- Não expor secrets em prompts, logs, testes ou commits.
- Não enviar a mensagem bruta do usuário ao executor.
- Toda demanda deve passar por interpretação, deliberação e consolidação.
- O worker local executa, mas não redefine escopo nem arquitetura.
- Toda alteração deve incluir testes, documentação e resumo técnico.
- Em caso de dúvida arquitetural, registrar uma proposta de ADR antes de implementar.

## Saída obrigatória ao final de cada tarefa

- Objetivo executado.
- Decisões tomadas.
- Arquivos alterados.
- Testes executados.
- Resultado dos testes.
- Riscos remanescentes.
- Próxima tarefa recomendada.
- Atualização de `memory/current-state.md`.
