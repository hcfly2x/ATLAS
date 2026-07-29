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
- QA empírico executa somente instalação congelada e validação já declaradas
  pela runtime, sempre pela allowlist existente;
- evidência empírica guarda executável, status, duração e hashes, nunca args,
  output, prompt, payload bruto, token ou credencial;
- timeout, exceção, runtime ausente ou comando negado resultam em
  `UNAVAILABLE`, sem aprovação automática.
- a reconciliação pós-execução libera o gate somente com evidência `PASS` e
  decisão `approved`; divergência, sinal ausente ou erro falham fechado;
- Approval automática de resultado só é decidida depois dessa reconciliação e
  apenas para trabalho `simple|moderate`, reversível, com testes verdes, sem
  paths protegidos nem ações sensíveis;
- resultado crítico permanece sob decisão humana enquanto não houver baseline
  versionado de evals e autorização específica;
- o registro reconciliado contém somente enums, hashes e códigos estáveis,
  nunca prompt, resposta remota ou mensagem bruta de erro.

## Provedor do revisor pós-execução

- `ANTHROPIC_API_KEY` existe somente no ambiente do coordinator ou no secret
  store e nunca é enviada ao worker;
- o adaptador Claude possui um único destino de egress:
  `https://api.anthropic.com/v1/messages`;
- corpo de erro remoto, prompt e resposta não entram em logs, auditoria ou
  evidência; falhas são reduzidas a códigos seguros;
- selecionar Claude sem configuração completa falha fechado e nunca produz
  aprovação automática;
- a seleção vale somente para o revisor pós-execução e não altera
  `always_human`, merge, deploy ou autonomia.

## Dashboard web

O dashboard é somente leitura e permanece bloqueado fora do loopback por
default. Para a interface web única hospedada no Render, a exposição remota é
uma escolha explícita: `DASHBOARD_REMOTE_ACCESS_ENABLED=true` e uma
`DASHBOARD_OWNER_CREDENTIAL` com ao menos 32 caracteres, ambos configurados
somente no secret store do provedor. A conexão pública usa HTTPS do Render.

O dono usa a credencial uma vez para criar uma sessão assinada e expirável. O
token de sessão é transportado somente em cookie `HttpOnly`, `SameSite=Strict`,
com escopo `/dashboard` e `Secure` no acesso remoto; nunca entra no JavaScript
ou em resposta JSON. Toda rota `/dashboard`, inclusive o shell e os read-models,
exige sessão e permissão RBAC declarada. Ausência de autenticação, expiração,
falta de permissão, erro do gate ou rota sem permissão declarada falham fechado
com 401/403 antes dos dados. Login e criação de sessão são as únicas exceções
públicas.

O shell React não contém dados e usa `no-store`. Seus módulos Vite são aceitos
somente da própria origem por `script-src 'self'`; a CSP também mantém
`connect-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer`. Assets
hasheados exigem a mesma sessão e podem usar cache imutável por um ano. O
catch-all autenticado nunca absorve API ou asset inexistente. Credencial,
cookie e token de sessão não entram em query string, bundle, log, auditoria ou
repositório. A auditoria de autenticação contém somente desfecho, motivo
estável e correlação.

Nesta fundação existe somente o papel `owner`. Além das permissões de leitura,
a escrita C2a permanece limitada à decisão de Approval `USER` não sensível,
com RBAC, CSRF, idempotência, versão e resolvedor transacional compartilhado.
O serving do React não acrescenta qualquer verbo ou mutação.

Mission Control e os endpoints gerais de inspeção retornam somente estados,
contagens, datas, hashes e IDs correlacionáveis. O Workspace B1 possui uma
exceção estreita e explícita: pode projetar o objetivo normalizado e, da
Specification validada, `implementation_strategy` e `acceptance_criteria`, pois
são conteúdo próprio da demanda. Da execução, projeta somente o nome do
executável e estatísticas numéricas do resultado validado.

Mesmo no Workspace, mensagem original, prompts, respostas de modelo, payloads
brutos de Specification/Approval/Execution/review/AuditEvent, argumentos de
comando, saída crua de ferramenta, descrição livre do diff, conteúdo de memória,
worktree, segredos, tokens, URLs sensíveis e destino/texto de entrega não fazem
parte da projeção web. Memória aparece somente por tipo e contagem. Campos
ausentes ou inválidos são `indeterminado`, sem reconstrução ou inferência.

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
## Escrita governada da Dashboard

A primeira rota de escrita da Dashboard decide somente `Approval` humana já
pendente. Ela exige sessão válida, permissão `dashboard:approval:decide`, token
CSRF ligado à sessão, chave de idempotência e versões esperadas do alvo e da
Task. A resolução reutiliza o mesmo serviço transacional do Telegram. Alvo
inexistente, não humano, já decidido, obsoleto ou sensível falha fechado.
Credencial e token não entram em resposta, auditoria ou bundle.
