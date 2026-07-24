# Estado Atual

## Fase

Fase 6 — Memória por projeto integrada na `main` v0.0.10. Blocos A —
destravamento do piloto — e B — visibilidade — concluídos e integrados
sequencialmente na `main` v0.0.12. A Fase 7 não está autorizada.

## Implementado

- Trilha 1 (Fases 1–5) integrada até v0.0.8; memória por projeto integrada na
  v0.0.10.
- Pilot Setup Wizard mínimo do Bloco A configura projetos, não agentes, com
  autodetecção segura e defaults conservadores.
- `/verbose 0|1|2` persiste a preferência da sessão Telegram.
- Nível 0 publica apenas resultado final; nível 1 acrescenta marcos; nível 2
  acrescenta chunks já persistidos pelo worker em lotes limitados.
- Atividade de execução longa usa `sendChatAction`.
- Cursores por Task evitam duplicação de marco, log e resultado após polling ou
  reinício do coordinator.
- Dashboard somente-leitura em `/dashboard`, restrito ao loopback.
- APIs do dashboard exigem Bearer token e expõem somente GET.
- Painel mostra Task por estado canônico, detalhe com Specification, Approvals e
  Executions, AuditEvent por projeto, custos LLM/Codex e memória por projeto.
- O token do browser permanece no fragmento da URL e não entra em query/log.
- Dashboard somente-leitura registrado como independente do ADR-013 Proposto.
- Sexta migração adiciona `telegram_sessions.verbose_level` e
  `telegram_task_deliveries`.
- Garantia de publicação Telegram documentada honestamente como `at-least-once`;
  uma queda entre envio e cursor pode gerar duplicação inofensiva no MVP.

## Testes e validações

- Migração possui teste de contrato para verbosity e cursores.
- Telegram cobre persistência do comando, nível 0, marcos, chunks e resultado.
- Dashboard cobre autenticação, loopback, headers do browser e ausência de
  métodos de escrita.
- `pnpm validate` aprovado; 67 testes unitários/contrato e 8 integrações
  PostgreSQL aprovados.
- Seis migrações aplicadas do zero e seed executado em PostgreSQL 17 efêmero.
- Validação visual real confirmou desbloqueio, 14 estados canônicos, custos,
  seleção de projeto e carregamento dos feeds sem expor o token nos logs.

## Decisões vigentes

- ADRs 001–012 aceitos; ADRs 013–015 permanecem Propostos.
- Dashboard do Bloco B é estritamente de inspeção e não antecipa edição de
  agentes/times/configuração da Fase 10.
- Blocos A e B integrados após auditoria e autorização explícita do usuário.

## Próximo passo

Executar o piloto real com um projeto configurado e registrar fricções de uso.
O Bloco C e a Fase 7 continuam dependentes de autorização separada.

## Restrições ativas

- não iniciar a Fase 7 ou conselho multiagente;
- não executar o Bloco C nesta entrega;
- não provisionar staging/produção nem criar `render.yaml`;
- não adicionar escrita ao dashboard;
- não criar/editar agentes, times ou configuração;
- não alterar ADRs aceitos nem os status Propostos dos ADRs 013–015;
- não executar deploy nem integrar credenciais reais.
