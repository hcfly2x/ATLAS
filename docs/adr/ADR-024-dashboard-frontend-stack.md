# ADR-024 — Stack frontend da Dashboard

## Status

Proposto

## Contexto

O PR #52 entregou o read-model somente leitura de Mission Control no
coordinator. A Dashboard precisa de uma camada frontend independente que
consuma esse contrato sem reimplementar regras, criar um segundo backend ou
antecipar as rotas de escrita da Trilha C.

## Decisão proposta

Adotar para `apps/dashboard`:

- React, Vite e TypeScript estrito;
- Tailwind CSS e shadcn/ui;
- React Router, TanStack Query e TanStack Table;
- Zod e o pacote compartilhado `@atlas/contracts`;
- Vitest, React Testing Library, Playwright e axe-core;
- React Doctor como diagnóstico de desenvolvimento.

O coordinator permanece backend e fonte de verdade. O frontend valida respostas
na fronteira com contratos Zod e permanece somente leitura até autorização
própria da Trilha C. Este ADR não autoriza uma feature de UI.

As dependências desta preparação ficam fixadas no lockfile. O shadcn MCP é
configuração local do Codex e preserva aprovação para escrita. OpenAI Build Web
Apps é tooling opcional do ambiente: não é dependência do repositório nem pode
ser instalado silenciosamente.

## Consequências

- O scaffold pode buildar, testar e renderizar um shell sem dados de negócio.
- O contrato público do Mission Control torna-se verificável no wire format.
- Skills versionadas guiam governança, contratos e QA frontend.
- Next.js, outro backend, novo datastore, WebSocket/SSE e rotas de escrita
  continuam fora do escopo.
- `Approval`, `always_human`, enforcement, TaskState e autenticação existente
  permanecem intocados.
