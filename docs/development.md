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

## Fluxo de integração

Use `docs/merge-policy.md` para definir a profundidade de revisão pelo risco do
diff. CI verde continua obrigatório em todos os casos. PRs já aprovados,
independentes e de baixo risco podem ser integrados em lote na mesma sessão:
rebaseie cada um sobre a `main` resultante do merge anterior e confirme CI verde
sobre a base atualizada antes de integrar o próximo. Essa aceleração não altera
a ordem dos Blocos 2 e 3 de estabilização.

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

## Pilot Setup Wizard

O assistente local configura projetos sem exigir edição manual do YAML. Ele não
é o dashboard da Fase 10: roda somente no loopback, não usa banco ou credenciais
e altera exclusivamente `.atlas/projects.yaml` após uma ação explícita do
usuário.

```bash
pnpm pilot
```

Abra [http://localhost:3000/setup](http://localhost:3000/setup). O formulário:

- aplica os defaults canônicos antes de exibir cada projeto;
- pede inicialmente apenas o caminho Git absoluto e comandos de teste permitidos;
- mantém identidade, política, ferramentas opcionais, limites e retenção em
  **Opções avançadas**, recolhidas por padrão;
- sugere nome/ID pelo diretório e um comando editável ao reconhecer
  `package.json`, `pyproject.toml` ou `Makefile`, sem executar código do projeto;
- usa teto de US$ 2 por tarefa e retenção sensível de 7 dias como defaults;
- trata ausência de versões em `required_tools` como “sem versão mínima”; o
  preflight continua registrando as versões reais encontradas;
- impede a ativação enquanto houver pendências;
- representa comandos como executável e argumentos separados, sem shell;
- preserva campos desconhecidos do arquivo e salva de forma atômica.

O assistente configura exclusivamente **projetos**. Ele não cria nem edita
agentes ou times e não antecipa o dashboard da Fase 10.

O arquivo continua versionado e protegido pelo ADR-010. Depois de salvar,
revise `git diff -- .atlas/projects.yaml` antes de commitar. Para usar outro
arquivo em teste, defina `ATLAS_PROJECTS_PATH` com um caminho absoluto.

Depois de configurar um projeto e iniciar o PostgreSQL, aplique as migrações e
o seed:

```bash
pnpm --filter @atlas/coordinator exec prisma migrate deploy
pnpm --filter @atlas/coordinator db:seed
```

Para iniciar o coordinator completo carregando o `.env.local` ignorado pelo Git:

```bash
pnpm coordinator:local
```

## Supervisor local

O supervisor só é registrado quando `OPENAI_API_KEY` contém um valor não vazio.
A chave deve existir apenas no ambiente local do coordinator (por exemplo,
`.env.local`, que é ignorado pelo Git) ou no secret store do ambiente. O comando
`pnpm coordinator:local` carrega esse arquivo explicitamente; `pnpm dev` continua
dependendo das variáveis exportadas no processo:

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

### Provedor opcional do revisor pós-execução

Sem configuração adicional, o revisor pós-execução reutiliza o runtime OpenAI,
como antes. Para selecionar Claude somente nesse papel, defina no ambiente
privado do coordinator:

```bash
export ATLAS_POST_EXECUTION_REVIEWER_PROVIDER=claude
export ANTHROPIC_API_KEY=valor-fornecido-fora-do-repositorio
export ATLAS_CLAUDE_REVIEWER_TIMEOUT_MS=60000
```

A chave não deve ser escrita em arquivo versionado. Uma seleção explícita de
Claude sem chave ou com timeout inválido impede o startup. O endpoint Anthropic
não é configurável, e erro, timeout, recusa ou resposta inválida seguem o fluxo
existente de QA indisponível, sem aprovação automática.

### Conselho multiagente

O coordinator carrega o registro de papéis de `.atlas/agents.yaml`, as
instruções versionadas em `agents/` e as rotas por complexidade de
`.atlas/routing.yaml`. Os caminhos podem ser substituídos localmente com
`ATLAS_AGENTS_PATH` e `ATLAS_ROUTING_PATH`. O modelo dos pareceristas usa
`ATLAS_COUNCIL_MODEL` (default `gpt-5.6-luna`); o supervisor continua em
`gpt-5.6-terra`, permitindo revisão e consolidação com modelos distintos.

Cada parecer é independente na primeira rodada. Havendo divergência material, o
supervisor solicita revisão focada somente aos agentes envolvidos e encerra após
a segunda rodada. Deliberações não criam novos estados de Task: ocorrem dentro
de `SPECIFYING`, antes da Specification final. Cada parecer e cada rodada gera
AuditEvent correlacionado.

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

## Memória por projeto

As rotas internas de memória usam o mesmo Bearer token:

```text
POST /internal/projects/:projectId/memory
GET  /internal/projects/:projectId/memory
GET  /internal/projects/:projectId/memory/context
```

O POST aceita `type`, `content`, `idempotencyKey` e, opcionalmente, `taskId` e
`agentId`. `summary` exige Task. Não há update/delete na Fase 6. O context
builder limita o conteúdo e o supervisor consulta exclusivamente o projeto da
Task; detalhes em `specifications/project-memory.md`.

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

O comando `/verbose 0|1|2` persiste a preferência na sessão:

- `0`: nenhuma atualização assíncrona além do resultado final;
- `1`: resultado final e marcos de mudança de estado;
- `2`: resultado final, marcos e chunks de log já persistidos pelo worker.

Durante estados de execução longa, o bot envia `sendChatAction` periodicamente.
Os logs do nível 2 são enviados em lotes limitados, com cursor persistente por
Task; reinício do coordinator não volta a transmitir chunks já entregues.
`TELEGRAM_PROGRESS_INTERVAL_MS` controla o intervalo do publicador (default 2 s).

Como alternativa futura de teste do webhook, um túnel HTTPS pode encaminhar para
`127.0.0.1:3000`, mas a criação do túnel e a chamada `setWebhook` são operações
manuais fora do repositório. Nenhum endpoint público ou configuração de produção
é criado por este kit.

## Dashboard local somente-leitura

Defina uma credencial local de ao menos 32 caracteres em `.env.local` e inicie
o coordinator:

```bash
DASHBOARD_OWNER_CREDENTIAL=<credencial local com pelo menos 32 caracteres>
DASHBOARD_SESSION_TTL_SECONDS=900
pnpm coordinator:local
```

Abra [http://localhost:3000/dashboard](http://localhost:3000/dashboard) e informe
a credencial. Ela é enviada uma vez ao endpoint de sessão e substituída por um
cookie assinado, expirável, `HttpOnly` e `SameSite=Strict`; nem a credencial nem
o token da sessão entram no JavaScript, na URL ou nos logs HTTP.

O shell e todas as APIs do dashboard recusam conexões fora do loopback. Dados
são expostos exclusivamente por rotas GET autenticadas. Não existem POST, PUT,
PATCH ou DELETE sob `/dashboard`. A interface mostra estados canônicos, detalhes
de Task com Specifications/Approvals/Executions, AuditEvent por projeto, custos
de LLM/Codex com tetos de US$ 25/US$ 75 e memória do projeto. Ela não cria nem
edita projetos, agentes, times ou configuração.

O shell protegido e todos os read-models exigem sessão e permissão RBAC no
backend. A tela pública de login não contém dado operacional. Este painel
operacional somente-leitura é independente da decisão futura do ADR-013 sobre
edição de agentes.

## Dashboard web única no Render

Para acompanhar as mesmas Tasks recebidas pelo Telegram, use a dashboard do
coordinator hospedado, não uma segunda instância local. No ambiente do Render,
configure somente no secret store:

```text
DASHBOARD_REMOTE_ACCESS_ENABLED=true
DASHBOARD_OWNER_CREDENTIAL=<credencial aleatória com pelo menos 32 caracteres>
DASHBOARD_SESSION_TTL_SECONDS=900
```

Gere o token localmente, sem registrá-lo no repositório:

```bash
openssl rand -base64 32
```

Depois do deploy, abra `https://<servico-render>/dashboard` e informe a
credencial. O cookie remoto exige HTTPS por `Secure`; shell e APIs continuam
somente leitura e exigem sessão e permissão. Não inicie
`pnpm coordinator:local` apenas para usar a dashboard quando a instância web
remota estiver habilitada. Rotacionar a credencial invalida as sessões
anteriores.

## Worker local

O worker roda fora do Docker e não possui dependência de PostgreSQL. O perfil MVP
exige macOS/ARM64, Node, Git, Codex CLI e os repositórios dos projetos. Antes de
aceitar uma Task, o preflight valida plataforma, arquitetura, versões mínimas e
ferramentas GNU explicitamente declaradas.

Antes de testar manualmente o ciclo completo, reconstrua todos os packages para
que o worker use os adapters atuais em `dist/`:

```bash
pnpm -r build
```

## Runtime reproduzível por projeto

Uma worktree nova não herda `node_modules` nem outros artefatos do checkout
principal. Se um projeto precisar preparar dependências, declare um bloco
`runtime` no próprio Project com `package_manager`, `bootstrap`, `validate`,
`allowed_commands`, `forbidden_commands` e `timeout_minutes`. O manifesto é a
única fonte de bootstrap e validação: o worker não infere `pnpm install`,
`npm install` ou qualquer outro comando.

`bootstrap` roda antes do Codex e `validate` depois dele, sempre sem shell e
dentro da worktree. Ambos passam pela mesma allowlist estruturada do runtime;
`forbidden_commands` tem precedência inclusive sobre uma entrada acidental em
`allowed_commands`. Uma entrada proibida sem argumentos bloqueia todas as
invocações daquele executável. Cada comando fica no resultado auditável.

`timeout_minutes` limita toda fase de bootstrap ou validação. Estouro é uma
falha técnica classificada como `timeout`; falha não nula de bootstrap é
`failure_stage=bootstrap` e impede a chamada ao Codex. A remoção da worktree
ocorre em sucesso, falha e cancelamento, portanto dependências instaladas não
vazam para o checkout principal.

Projeto sem `runtime` preserva o comportamento legado: somente os comandos de
teste da Specification que coincidirem com `allowed_commands` do Project são
executados. Revise o diff do arquivo protegido antes de ativar um runtime.

Exemplo mínimo, que autoriza somente os dois comandos declarados:

```yaml
runtime:
  package_manager: pnpm
  bootstrap:
    - executable: pnpm
      args: [install, --frozen-lockfile]
  validate:
    - executable: pnpm
      args: [validate]
  allowed_commands:
    - executable: pnpm
      args: [install, --frozen-lockfile]
    - executable: pnpm
      args: [validate]
  forbidden_commands:
    - executable: rm
      args: []
  timeout_minutes: 10
```

O exemplo não é um default nem autoriza `pnpm install` em outro projeto. Cada
projeto deve declarar e revisar sua própria política antes de ativá-la.

Em falhas transitórias de conexão com o coordinator, registro e claim usam
backoff exponencial de 5 segundos até 60 segundos por default. Erros permanentes
de autenticação/autorização (`401`/`403`) ou requisição inválida (`400`/`422`)
encerram o worker para correção da configuração local.

Variáveis operacionais são mantidas somente no ambiente local:

```bash
export ATLAS_COORDINATOR_URL=https://coordinator.example.invalid
export ATLAS_WORKER_TOKEN=valor-fornecido-fora-do-repositorio
export ATLAS_PROJECT_SCOPES=atlas
export ATLAS_WORKTREE_ROOT=/caminho/absoluto/atlas-worktrees
export GITHUB_TOKEN=valor-fornecido-fora-do-repositorio
pnpm --filter @atlas/worker start
```

`ATLAS_WORKER_CONCURRENCY` permanece `1` no MVP. Heartbeat usa 30 segundos;
renovação de lease é configurada separadamente e deve ocorrer antes da expiração.
O coordinator bloqueia claims novos ao atingir o teto lógico mensal Codex de
US$ 75, sem interromper execução em andamento.

Se uma renovação de lease falhar, o worker encerra imediatamente a execução
local, interrompe o Codex caso ainda esteja ativo e remove a worktree. Ele não
tenta renovar, finalizar, reenviar resultado ou reexecutar a mesma Assignment
sem conseguir provar posse do lease; a reconciliação durável do coordinator é a
autoridade para tratar a execução ambígua.

Testes nunca usam Codex real, push ou GitHub: o adapter Codex recebe um binário
falso e o adapter Git trabalha em repositórios temporários locais.
