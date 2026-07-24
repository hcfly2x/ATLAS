# ADR-017 — Persona de agente como documento versionado

## Status

Proposto.

## Contexto

Uma persona de agente combina identidade, objetivo, limites e tom. Modelar essa
camada apenas como campos de formulário tende a fragmentar o contexto e limitar
a customização por usuários não técnicos.

Um documento legível permite expressar intenção e fronteiras em linguagem
natural, mantendo revisão, histórico e comparação por diff. Como `.atlas/**` é
área protegida pelo ADR-010, qualquer persona editável deve preservar aprovação
humana e auditabilidade.

Este ADR não resolve a persistência futura da UI. O ADR-013 continua responsável
por decidir, na Fase 10, se a configuração editada pela interface permanece em
arquivos versionados ou migra para o banco.

## Proposta

- cada persona é declarada como documento versionado;
- o documento contém, no mínimo, identidade, objetivo, limites e tom;
- a persona complementa o papel e as skills, sem substituir permissões,
  políticas ou escopo da Task;
- documentos de persona vivem sob a proteção do ADR-010;
- alterações mantêm histórico, revisão humana e vínculo auditável com a versão
  usada pelo agente;
- a experiência de edição deve ser acessível a pessoas não técnicas sem ocultar
  o documento canônico resultante.

## Questões pendentes

- formato e localização canônicos;
- schema mínimo e validações sem reduzir o documento a um formulário rígido;
- herança e precedência entre persona, papel, skill e contexto do projeto;
- tratamento de traduções e variantes;
- vínculo entre versão da persona, chamada de LLM e parecer produzido;
- integração futura com a escolha de persistência do ADR-013.

## Consequências

- favorece customização expressiva e revisão por diff;
- mantém personas portáveis e versionáveis;
- exige prevenção de instruções que tentem ampliar permissões ou contrariar
  políticas;
- exige registrar a versão efetiva usada em cada parecer;
- não escolhe a persistência da UI e não altera o status do ADR-013;
- não autoriza implementação antecipada.
