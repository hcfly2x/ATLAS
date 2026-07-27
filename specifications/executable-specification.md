# Formato da Especificação Executável

## Identificação
- task_id
- project_id
- version
- specification_hash
- risk_level
- delivery_mode (`answer_only|repository_change`; ausência/valor inválido
  preserva `repository_change`)

## Objetivo

## Contexto relevante

## Escopo autorizado
- authorized_scope

## Fora de escopo

## Estratégia de implementação

## Restrições

## Critérios de aceite

## Testes obrigatórios

## Comandos permitidos

## Ações que exigem aprovação

## Formato esperado da entrega

`answer_only` admite diff vazio e entrega o texto aprovado apenas à origem da
Task. `repository_change` exige um repositório absoluto configurado e preserva
o fluxo de commit/pull request.
