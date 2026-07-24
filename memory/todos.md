# Pendências

## Fases 4–5

- Fazer `/status` e `/cancel` sem argumento respeitarem o projeto selecionado na
  sessão.

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

- Usar o Pilot Setup Wizard ou editar manualmente `.atlas/projects.yaml` para
  preencher repositório, allowlist de comandos, classificação e retenção.
- Declarar versões mínimas em `required_tools` somente quando o projeto realmente
  exigir; a ausência não bloqueia ativação.
- Revisar o diff do arquivo protegido, iniciar o PostgreSQL, executar migrações e
  seed antes da primeira tarefa real.

## Pilot Setup Wizard — melhorias não bloqueadoras

- Substituir a heurística por substring da classificação sensível por uma
  taxonomia explícita ou uma política conservadora para classificações futuras.
- Evitar commit acidental de temporários órfãos do salvamento atômico, cobrindo
  `.atlas/*.tmp-*` no `.gitignore` ou removendo-os de forma segura no startup.
