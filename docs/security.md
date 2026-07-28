# Segurança

## Princípios

- Menor privilégio.
- Negar por padrão.
- Autonomia configurável por projeto conforme o ADR-014 proposto.
- Separar ambiente de desenvolvimento e produção.
- Não enviar secrets ao modelo.
- Registrar toda ação relevante.

## Ações sempre humanas

- merge na branch principal;
- deploy em produção;
- alteração de secret de produção;
- exclusão de dados;
- migração destrutiva;
- mudança de pagamentos;
- mudança de tracking;
- aumento de orçamento de anúncios;
- alteração de áreas protegidas pelo ADR-010.

Alterar o valor de um secret de produção no painel do provedor e alterar paths
versionados de secrets protegidos pelo ADR-010 são controles complementares;
nenhum substitui o outro.

O nível de autonomia pode dispensar aprovações síncronas para ações reversíveis,
mas a lista `always_human` não varia por nível. Deploy em staging é distinto de
deploy em produção: a partir do nível 2, staging pode ser automático somente
depois do merge humano na `main` e de CI verde, em ambiente isolado conforme o
ADR-015 proposto. Promoção para produção permanece sempre humana.

Staging usa banco, secrets, `DATABASE_URL`, seed sintético e bot Telegram
próprios. Dados reais nunca são copiados para staging, especialmente dados
`personal_financial`.

## Worker

- conexão iniciada de dentro para fora;
- TLS com validação do servidor e autenticação do worker por token Bearer exclusivo, rotacionável e com escopo por projeto (ADR-007);
- escopo por projeto;
- diretório isolado;
- allowlist de comandos;
- timeouts;
- limite de recursos e uma execução concorrente por padrão (ADR-011);
- logs sanitizados.

## Dashboard web

O dashboard é somente leitura e permanece bloqueado fora do loopback por
default. Para a interface web única hospedada no Render, a exposição remota é
uma escolha explícita: `DASHBOARD_REMOTE_ACCESS_ENABLED=true` e um
`DASHBOARD_TOKEN` com ao menos 32 caracteres, ambos configurados somente no
secret store do provedor. A conexão pública usa HTTPS do Render; cada API de
dados exige `Authorization: Bearer <token>` e não existem rotas de escrita sob
`/dashboard`.

O shell não contém dados e usa `no-store`, CSP com `connect-src 'self'`,
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options:
nosniff` e `Referrer-Policy: no-referrer`. O token permanece no fragmento do
navegador e é enviado apenas como header às APIs; nunca entra em query string,
logs ou repositório.

## Entrega terminal

- o destino da outbox vem somente de `Task.origin`;
- conteúdo, LLM, Specification e QA nunca fornecem `chat_id`;
- erro persistido usa código sanitizado, sem prompt, payload, URL de requisição,
  token ou credencial;
- tentativa ambígua não é repetida automaticamente;
- retry limitado existe apenas quando o canal comprova que nada foi despachado.
- o watchdog só lê metadados de entrega e cria AuditEvent sanitizado; a
  dashboard não expõe texto da mensagem, IDs de destino ou rota de reenvio.

## Retenção

- política configurável por classificação de dados;
- prazo padrão de 30 dias para arquivos e logs;
- prazo menor obrigatório para dados sensíveis, definido na configuração do projeto antes de sua ativação;
- eventos de auditoria append-only não expiram no MVP;
- exclusão deve considerar também cópias de backup conforme a janela operacional do provedor.

## Memória

- todo item persistente exige `project_id`;
- Task associada deve pertencer ao mesmo projeto;
- o context builder falha fechado diante de mistura de projetos e aplica limite
  de itens/caracteres;
- secrets não podem ser registrados em notas, decisões ou resumos;
- criação e conflito de idempotência geram AuditEvent;
- edição e exclusão não são expostas na Fase 6.

## Dados financeiros

- não registrar conteúdo integral de extratos;
- mascarar contas e cartões;
- separar metadados de documentos;
- criptografar arquivos em repouso;
- retenção e exclusão configuráveis.

## Marketing

- nenhuma autonomia financeira irrestrita;
- teto por campanha;
- teto por alteração;
- rollback;
- auditoria;
- aprovação para campanhas novas e mudanças grandes.
