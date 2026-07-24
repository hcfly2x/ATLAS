# Epic — QA pós-execução

> Trilha 2 — execução não autorizada.

## Objetivo

Adicionar controle de qualidade do **resultado** produzido pelo worker antes de
tratar o ciclo autônomo como pronto para uma expansão de autonomia. Este QA é
distinto do parecer de qualidade do conselho: o conselho avalia demanda e
Specification antes da execução; o QA pós-execução avalia o resultado, os
testes, o diff e a entrega resultante.

## Dependências

- Bloco 2 de estabilização concluído: runtime reproduzível por projeto;
- Bloco 3 de estabilização concluído: recuperação durável de Tasks, leases e
  execuções;
- Specification, resultado do worker, hashes e AuditEvents já existentes.

## Restrições

- o revisor não pode ser o agente que emitiu a Specification;
- revisor e supervisor podem usar modelos distintos;
- o epic estende a auditoria, contratos e política existentes; não cria uma
  segunda máquina de estados, fila ou canal de entrega;
- não autoriza merge, deploy, envio genérico de mensagens ou ampliação de
  autonomia.

## Critério de conclusão mensurável

Para uma amostra definida de execuções concluídas, 100% dos resultados terão
parecer pós-execução versionado e AuditEvent correlacionado que identifique
Task, Execution, Specification, revisor e decisão de qualidade; nenhum resultado
reprovado poderá seguir para a entrega final sem o tratamento previsto pela
política. O ciclo "até a entrega" só é considerado com ponto de parada confiável
depois desse critério e das dependências serem atendidos.
