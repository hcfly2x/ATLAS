# Pendências

## Fase 3

- Implementar autenticação dos endpoints internos antes de qualquer exposição de
  rede.
- Documentar em `docs/development.md` a semântica de replay sob concorrência:
  duas requisições simultâneas com a mesma idempotency key podem fazer a segunda
  receber 409; no retry seguinte, ela recebe o replay.

## Fase 4

- Implementar o cálculo e a validação do hash canônico de Specification
  (`payload_hash`), hoje garantido apenas por constraints de persistência.

## Antes de ativar cada projeto

- Preencher repositório, versões mínimas das ferramentas, allowlist de comandos, teto por tarefa e prazo de retenção de dados sensíveis em `.atlas/projects.yaml`.
