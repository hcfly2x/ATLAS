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

## Supervisor local

O supervisor só é registrado quando `OPENAI_API_KEY` contém um valor não vazio.
A chave deve existir apenas no ambiente local do coordinator (por exemplo,
`.env.local`, que é ignorado pelo Git) ou no secret store do ambiente; o ATLAS
não carrega nem copia esse arquivo automaticamente. Exporte as variáveis no
processo antes de iniciar:

```bash
export INTERNAL_API_TOKEN=valor-local-descartavel
export OPENAI_API_KEY=valor-fornecido-fora-do-repositorio
export LLM_MONTHLY_BUDGET_USD=25
pnpm --filter @atlas/coordinator dev
```

`POST /internal/tasks/:taskId/supervise` executa o fluxo da Fase 4 e exige o
mesmo Bearer token das demais rotas internas. O teto é agregado por mês e
avaliado antes de iniciar uma nova deliberação; atingir o teto bloqueia novas
Tasks sem interromper uma já iniciada. Toda chamada registra tokens, custo
estimado e latência. Os testes usam exclusivamente um `AgentRuntime` falso e
nunca chamam a API real.

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
localmente por injeção Fastify nos testes. A rota só é registrada quando
`TELEGRAM_WEBHOOK_SECRET` possui valor não vazio e sempre exige o header
`X-Telegram-Bot-Api-Secret-Token` correspondente. A criação do app recusa uma
configuração de webhook sem secret; no modo polling, o secret pode permanecer
vazio porque nenhuma rota Telegram é exposta.

Replays idempotentes não reenviam mensagens ao chat. Callbacks repetidos ainda
são respondidos com `answerCallbackQuery` para encerrar o estado visual do botão.

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
