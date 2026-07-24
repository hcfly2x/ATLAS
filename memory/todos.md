# Pendências

## Fase 4

- Implementar o cálculo e a validação do hash canônico de Specification
  (`payload_hash`), hoje garantido apenas por constraints de persistência.
- Validar `target_hash` contra o hash canônico vigente da Specification no
  momento da decisão de aprovação.

## Fases 4–5

- Fazer `/status` e `/cancel` sem argumento respeitarem o projeto selecionado na
  sessão.

## Telegram — melhoria de erro

- Retornar mensagem útil para Approval já decidida, em vez de erro interno
  genérico.

## Antes de ativar cada projeto

- Preencher repositório, versões mínimas das ferramentas, allowlist de comandos, teto por tarefa e prazo de retenção de dados sensíveis em `.atlas/projects.yaml`.
