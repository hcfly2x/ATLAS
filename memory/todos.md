# Pendências

## Fase 4

- Implementar o cálculo e a validação do hash canônico de Specification
  (`payload_hash`), hoje garantido apenas por constraints de persistência.
- Validar `target_hash` contra o hash canônico vigente da Specification no
  momento da decisão de aprovação.
- Avaliar `autonomy_level`, criticidade e ações `always_human` ao decidir se a
  Specification exige `WAITING_APPROVAL`; aprovação automática deve persistir
  Approval `actor=system` com alvo versionado, hashes e AuditEvent.

## Fases 4–5

- Fazer `/status` e `/cancel` sem argumento respeitarem o projeto selecionado na
  sessão.

## Fase 5

- Condicionar commit e abertura automática de PR a testes verdes e ausência de
  paths protegidos.
- Implementar retry automático exclusivamente técnico no nível 3, protegido por
  fencing token e sem reexecutar Codex sobre lease ambíguo.

## Epic de infraestrutura — após o fechamento da Fase 3

- Provisionar staging no Render com banco e secrets próprios.
- Configurar deploy automático de staging após merge na `main` com CI verde.
- Criar bot Telegram exclusivo de staging.
- Implementar smoke tests pós-deploy para health, criação de Task, transição e
  AuditEvent; falha deve bloquear promoção.
- Validar o webhook real do Telegram em staging.
- Manter produção com promoção manual e sem hibernação.

## Telegram — melhoria de erro

- Retornar mensagem útil para Approval já decidida, em vez de erro interno
  genérico.

## Antes de ativar cada projeto

- Preencher repositório, versões mínimas das ferramentas, allowlist de comandos, teto por tarefa e prazo de retenção de dados sensíveis em `.atlas/projects.yaml`.
