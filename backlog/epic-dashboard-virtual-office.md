# Epic — Dashboard: escritório virtual por estado

## Status

Roadmap da Fase 10. Execução não autorizada.

## Objetivo

Evoluir o dashboard operacional somente-leitura do Bloco B para um board
prático de Tasks por estado, priorizando visibilidade de estado, inbox humano e
decisão de gastos de relance. O “escritório virtual” é um board, não um mapa
espacial ou uma simulação de presença.

## Dependências

- Dashboard somente-leitura do Bloco B.
- Runtime reproduzível e recuperação durável concluídos, para que o estado
  exibido seja operacionalmente confiável.
- QA pós-execução, para a coluna Qualidade baseada em
  `WAITING_RESULT_APPROVAL`.
- Dados existentes: Task, Specification, Approval, Execution, AuditEvent,
  `LlmCall` e `codex_usages`. O epic deve estender essas fontes, sem criar
  entidade paralela de rastreamento ou gastos.

## Escopo futuro

- Colunas agrupadas pelos marcos da máquina de estados canônica: Pensando,
  Aprovação, Executando, Qualidade, Entregando, Pronto e Falhou/Cancelado.
- Cards mínimos com demanda, estado/tempo na coluna, saúde e custo estimado.
- Inbox “precisa de você” para `WAITING_APPROVAL`, visível antes de Tasks que
  podem avançar autonomamente.
- Barras de teto de deliberação e Codex, custo relativo por Task e projeção
  mensal a partir do ritmo de consumo já persistido.
- Consulta e aprovação quando a política vigente permitir; nenhuma porta de
  criação/edição de agentes, times ou configuração. ADR-013 continua a decisão
  separada para esse tema.

## Decisões de design

- **Anti-espacial:** a metáfora é board Kanban por estado, não escritório em
  mapa, avatares ou ambiente estilo Gather.
- **Anti-log:** stream cru, chunks e diff detalhado só aparecem atrás de clique;
  a visão principal mostra somente sinais de decisão.
- **Autonomia visível:** o que roda sem intervenção permanece calmo; o que
  depende de humano recebe destaque inequívoco.

## Critério de conclusão mensurável

Para uma amostra de 20 Tasks com estados, custos e caminhos de QA distintos:

1. 100% aparecem em exatamente uma coluna derivada da máquina de estados
   canônica;
2. 100% dos cards exibem estado, tempo na coluna, saúde e custo estimado;
3. 100% das Tasks em `WAITING_APPROVAL` aparecem na faixa “precisa de você”;
4. as barras mostram consumo mensal e projeção usando `LlmCall` e
   `codex_usages`, com alertas em aproximadamente 80% e no teto;
5. nenhum log cru ou diff aparece na visão principal; e
6. testes confirmam que não há rota de escrita para agentes, times ou
   configuração criada por este epic.

## Fora de escopo

- Implementação nesta entrega documental.
- Mapa espacial, avatares ou simulação de escritório.
- Criação/edição de agentes, personas, skills ou times.
- Nova máquina de estados, nova trilha de auditoria, deploy ou mudança de
  autonomia.
