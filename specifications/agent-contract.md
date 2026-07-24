# Contrato de Agente

Todo agente deve receber:

- agent_id;
- role;
- task;
- project_context;
- constraints;
- allowed_tools;
- expected_output_schema.

Todo agente deve retornar:

- understanding;
- findings;
- recommendation;
- risks;
- acceptance_criteria;
- confidence;
- unresolved_questions.

O agente não pode:
- executar ações fora das ferramentas autorizadas;
- alterar escopo;
- omitir riscos materiais;
- acessar memória de outro projeto.
