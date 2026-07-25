# Benchmark e referências de produto

## Dashboard operacional de agentes — rodada de pesquisa

### Referência de interação: Vibe Kanban

Vibe Kanban é referência de produto para a metáfora de board de trabalho de
agentes: estado visível por coluna, worktree isolada e acesso a diff/PR na UI.
Para o ATLAS, a referência é de interação e não uma autorização para copiar
implementação, código, identidade visual ou licença. A licença e os termos do
projeto devem ser verificados antes de qualquer empréstimo de código.

### Princípios registrados

- **Visibilidade primeiro:** a função primária da interface de agentes é tornar
  claro o que está acontecendo agora, não reproduzir o stream de saída.
- **Autonomia progressiva visível:** trabalho que pode seguir sozinho deve ser
  calmo; trabalho que precisa de uma pessoa deve sobressair imediatamente.
- **Cinco visões canônicas:** status, timeline, erros, custo e inbox humano.
  Elas devem ser compostas sobre dados já existentes no ATLAS, em especial
  Task, Execution, Approval, AuditEvent, `LlmCall` e `codex_usages`.
- **Entrega progressiva:** logs e diffs são evidência disponível sob demanda,
  não o conteúdo da visão principal; stream cru sempre fica atrás de clique.

### Preferência do dono

O dono prioriza praticidade e leitura de relance: board por estado, poucos
botões e nenhum “escritório espacial”. A visibilidade de gasto deve apoiar
decisão preventiva, não somente retrospectiva:

- barras de teto mensal para deliberação (US$ 25) e Codex (US$ 75), com
  percentual consumido e alertas em aproximadamente 80% e no estouro;
- custo por Task para comparar demanda simples e crítica; e
- projeção de fim de mês no ritmo atual, no formato “~US$ X de US$ Y”.

Esse registro informa apenas o escopo futuro da Fase 10. Não autoriza UI,
entidade nova, porta de escrita, alteração de autonomia ou implementação.
