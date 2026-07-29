# ADR-025 — Autenticação por sessão e RBAC da Dashboard

## Status

Proposto

## Contexto

As Trilhas A e B entregaram projeções somente leitura no coordinator e uma UI
web que as consome. O Bearer estático mantido no fragmento da URL não oferece
expiração de sessão e não estabelece uma fronteira de autorização extensível
para a futura Trilha C2.

## Decisão proposta

Adotar uma credencial de dono fornecida exclusivamente por
`DASHBOARD_OWNER_CREDENTIAL` para criar uma sessão curta e assinada. O
coordinator:

- valida a credencial com comparação em tempo constante;
- emite um token de sessão opaco, assinado com HMAC-SHA256 e com expiração;
- transporta o token somente em `Set-Cookie`, com `HttpOnly`,
  `SameSite=Strict`, escopo `/dashboard` e `Secure` no acesso remoto;
- nunca devolve credencial ou token no corpo JSON, erro, log ou evento de
  auditoria;
- aplica autenticação e uma permissão declarada a toda rota `/dashboard`;
- nega com 403 qualquer rota sem permissão declarada ou papel sem a permissão;
- mantém login e criação de sessão como as únicas exceções públicas.

A sessão é stateless e não cria entidade ou migração. Nesta fase existe apenas o
papel `owner`, com permissões de leitura. Os desfechos de login e expiração
podem ser auditados somente por códigos estáveis, correlação e resultado, sem
credencial, cookie, endereço de destino ou conteúdo de negócio.

Loopback continua sendo o default. A flag
`DASHBOARD_REMOTE_ACCESS_ENABLED=true` continua obrigatória para acesso remoto e
faz o cookie exigir HTTPS por `Secure`. `DASHBOARD_SESSION_TTL_SECONDS` aceita
um inteiro positivo de até 24 horas e usa 15 minutos por default. Rotacionar a
credencial invalida as sessões assinadas anteriormente.

O `POST /dashboard/auth/session` cria somente a sessão de autenticação; não é
uma escrita de domínio. Task, Specification, Approval, Execution, AuditEvent,
máquina de estados, `always_human`, autonomia e enforcement não mudam.

## Consequências

- O frontend deixa de conhecer ou persistir a credencial e o token de sessão.
- Sessões expiram e qualquer falha de autenticação fecha o acesso antes dos
  read-models.
- Novas rotas precisam declarar permissão; ausência de declaração falha
  fechado.
- A Trilha C2 pode acrescentar permissões de escrita sem redesenhar o gate, mas
  continua não autorizada e exigirá desenho próprio de CSRF, auditoria e
  autorização de domínio.
- OAuth, SSO, multiusuário e persistência de sessão ficam fora deste ADR.
