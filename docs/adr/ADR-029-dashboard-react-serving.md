# ADR-029 — Serving do app React da Dashboard

## Status

Proposto

## Contexto

As Trilhas A, B e C2a construíram e testaram a interface React em
`apps/dashboard`, mas o coordinator continuava publicando uma página de Mission
Control inline. Assim, o produto hospedado não expunha a Home, o Workspace, o
Replay nem as decisões de Approval já implementadas no frontend.

## Decisão proposta

O build Vite de `apps/dashboard` passa a ser a única interface operacional
publicada pelo coordinator. O Vite usa base `/dashboard/`; o shell é servido em
`GET /dashboard` e em rotas de cliente, enquanto assets com nome hasheado são
servidos em `/dashboard/assets/*`.

O shell, os deep links e os assets permanecem atrás do gate C1. Todos exigem
sessão válida e `dashboard:shell:read`, além do bloqueio loopback por default e
da flag explícita para acesso remoto. Rotas inexistentes sob
`/dashboard/api/*` e assets inexistentes retornam 404 e nunca caem no catch-all
do cliente.

O shell usa `Cache-Control: no-store`. Assets hasheados usam
`public, max-age=31536000, immutable`. A CSP do SPA permite scripts apenas da
própria origem (`script-src 'self'`), estilos da própria origem e inline,
conexões somente à própria origem e proíbe framing. Os demais headers de
segurança permanecem.

O build do dashboard é dependência de build do coordinator no grafo Turbo. No
runtime, o coordinator lê `apps/dashboard/dist` tanto quando iniciado da raiz
do monorepo quanto do diretório do próprio app.

A página inline de Mission Control é aposentada. Somente a página inline
pré-autenticação permanece, para criar a sessão antes de carregar o SPA.

## Consequências

- Home, Workspace, Replay e C2a passam a ser acessíveis pela única Dashboard
  hospedada.
- Refresh e deep links do React Router servem o mesmo shell autenticado.
- O bundle não contém credencial, cookie, token, URL de banco ou segredo; a
  autenticação continua por cookie HttpOnly e CSRF obtido da API de sessão.
- Esta decisão não cria rota de escrita, entidade, migração ou estado, nem muda
  Approval, `always_human`, autonomia, enforcement, worker ou domínio.
- C2b1 continua como fase própria para criar/cancelar demanda. Pausa, retomada e
  prioridade continuam reservadas à C2c, com desenho canônico próprio.
