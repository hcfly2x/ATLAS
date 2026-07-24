# Desenvolvimento local

## Requisitos

- Node.js 22.13 ou superior.
- pnpm 11.9.0.
- Git.
- Docker somente para o PostgreSQL de desenvolvimento do coordinator.

O worker não usa Docker nem banco de dados.

## Comandos

```bash
pnpm install
pnpm validate
```

Para iniciar apenas o PostgreSQL local do coordinator:

```bash
docker compose up -d postgres
```

Por padrão, o PostgreSQL do ATLAS é publicado em `127.0.0.1:5433` para reduzir colisões com outros projetos. A porta pode ser alterada com `ATLAS_POSTGRES_PORT`.

Para aplicar migrações, executar o seed validado e testar a persistência:

```bash
export DATABASE_URL=postgresql://atlas:atlas_local_only@127.0.0.1:5433/atlas
pnpm --filter @atlas/coordinator exec prisma migrate deploy
pnpm --filter @atlas/coordinator db:seed
pnpm test:integration
```

Nenhuma credencial real deve ser adicionada ao `.env`. O arquivo `.env.example` contém apenas valores locais de desenvolvimento.

## API interna

As rotas `/internal/*` exigem `Authorization: Bearer <INTERNAL_API_TOKEN>`.
O coordinator recusa inicialização dessas rotas sem `INTERNAL_API_TOKEN`.
Use apenas um valor local descartável no ambiente de desenvolvimento; nunca
registre tokens no repositório.

Sob concorrência, duas requisições simultâneas com a mesma idempotency key podem
fazer a segunda receber `409` enquanto a primeira transação ainda não está
visível. O retry seguinte, com a mesma chave e payload, recebe o replay do efeito
já persistido. Clientes devem tratar esse `409` como resultado retryable e não
gerar uma nova chave.

## Telegram local

O webhook está implementado em `POST /telegram/webhook` e pode ser exercitado
localmente por injeção Fastify nos testes. Quando `TELEGRAM_WEBHOOK_SECRET` está
definido, a rota exige o header `X-Telegram-Bot-Api-Secret-Token`.

Como não há deploy nem URL HTTPS pública autorizados na Fase 3, o modo escolhido
para desenvolvimento manual é long-polling:

```bash
export INTERNAL_API_TOKEN=valor-local-descartavel
export TELEGRAM_BOT_TOKEN=valor-fornecido-fora-do-repositorio
export TELEGRAM_ALLOWED_USER_ID=123456789
export TELEGRAM_MODE=polling
pnpm --filter @atlas/coordinator dev
```

`TELEGRAM_ALLOWED_USER_ID` aceita um único ID e é a fronteira de autorização do
MVP. O token do bot deve existir somente na variável de ambiente. O modo polling
usa `getUpdates` e a mesma camada de serviço do webhook, sem registrar webhook
público.

Como alternativa futura de teste do webhook, um túnel HTTPS pode encaminhar para
`127.0.0.1:3000`, mas a criação do túnel e a chamada `setWebhook` são operações
manuais fora do repositório. Nenhum endpoint público ou configuração de produção
é criado por este kit.
