# ADR-030 — Pausa, retomada e prioridade canônicas da Task

## Status

Proposto.

Este ADR é somente um spike de design. Ele não autoriza migração, rota, UI ou
mudança de comportamento.

## Contexto comprovado no código atual

A máquina canônica possui 14 estados em `packages/shared/src/index.ts:13` e a
topologia completa está centralizada em `packages/core/src/index.ts:133`. Hoje
não existe estado de pausa nem metadado de prioridade na `Task`
(`apps/coordinator/prisma/schema.prisma:176`).

O scheduler efetivo do trabalho não está em `@atlas/queue`, cuja interface hoje
expõe somente health (`packages/queue/src/index.ts:1`). A seleção e o claim
ocorrem em `WorkerService.claim`:

- uma `Execution` já enfileirada é escolhida por `createdAt` quando sua Task
  está exatamente em `QUEUED` (`apps/coordinator/src/worker/service.ts:241`);
- sem Execution pré-criada, uma Task `QUEUED` é escolhida também por
  `createdAt` (`apps/coordinator/src/worker/service.ts:328`);
- o segundo caminho usa CAS de estado e versão antes de concluir o claim
  (`apps/coordinator/src/worker/service.ts:362`), mas o primeiro atualiza a Task
  somente por ID (`apps/coordinator/src/worker/service.ts:267`).

O worker só inicia lease e execução depois do claim. A renovação começa depois
de receber a Assignment (`apps/worker/src/runner.ts:133`). Portanto, pausar uma
Task ainda não claimada é viável, mas a corrida `pause × claim` precisa ser
fechada nos dois caminhos antes de a função ser exposta.

Decisões de Approval já usam CAS de Task dentro da mesma transação
(`apps/coordinator/src/approvals/service.ts:398` e
`apps/coordinator/src/approvals/service.ts:498`). O recibo durável da C2b1 já
vincula chave, hash e resultado aceito ou rejeitado atomicamente
(`apps/coordinator/src/dashboard/command-receipt-store.ts:64`). Essas são as
primitivas a estender; não será criada uma segunda máquina de estados.

## Decisão proposta

### Escopo inicial de pausa

Somente dois estados estáveis e anteriores ao lease podem ser pausados:

- `WAITING_APPROVAL`;
- `QUEUED`.

Não entram no primeiro corte:

- `NEW|NORMALIZING|ROUTING|SPECIFYING`, porque o supervisor pode estar
  executando trabalho assíncrono sem protocolo cooperativo de suspensão;
- `RUNNING|TESTING|WAITING_RESULT_APPROVAL|FINALIZING|CANCEL_REQUESTED`, porque
  já existe Execution, lease, QA ou finalização em andamento;
- `COMPLETED|FAILED|CANCELLED`, porque são terminais ou exigem um comando de
  retry já governado.

Pausar trabalho ativo exigiria um protocolo cooperativo próprio, análogo e mais
complexo que cancelamento. Isso fica fora deste ADR.

### Estado e metadados

Adicionar, em fase futura e própria:

- o valor canônico `PAUSED` a `TaskState`;
- `Task.pausedFromState`, nulo fora de `PAUSED`, limitado por enum dedicado a
  `WAITING_APPROVAL|QUEUED`;
- `Task.priority`, inteiro pequeno, obrigatório, com default `0`.

Os níveis públicos de prioridade serão fixos e limitados:

| Nome | Valor persistido |
| --- | ---: |
| `normal` | 0 |
| `high` | 10 |
| `urgent` | 20 |

`urgent` altera somente a ordem entre Tasks elegíveis. O nome não significa
bypass de Approval, `always_human`, autonomia, enforcement ou orçamento.

### Arestas exatas

Todas as arestas atuais de `packages/core/src/index.ts:133` permanecem. Somente
estas são acrescentadas:

```text
WAITING_APPROVAL → PAUSED
QUEUED           → PAUSED
PAUSED           → WAITING_APPROVAL  (somente se pausedFromState=WAITING_APPROVAL)
PAUSED           → QUEUED            (somente se pausedFromState=QUEUED)
PAUSED           → CANCELLED
```

Ao entrar em `PAUSED`, a transação grava o estado anterior. Ao retomar, o core
aceita exclusivamente o destino gravado e limpa `pausedFromState`. Cancelar uma
Task pausada também limpa o campo. Não há comando que permita ao cliente
escolher o estado de retorno.

Retomar de `WAITING_APPROVAL` exige que a Specification ativa e a Approval
pré-execução pendente ainda sejam as mesmas. Retomar para `QUEUED` exige
Specification ativa consistente e nenhuma Execution claimada. Ausência ou
divergência falha fechado sem mutação.

### Concorrência com Approval e claim

`WAITING_APPROVAL → PAUSED` usa versão otimista. Se uma decisão de Approval
concorrer, o CAS existente da Approval e o CAS da pausa permitem apenas uma
transação vencedora; a outra retorna conflito e precisa recarregar a Task.

`QUEUED → PAUSED` só pode ser exposto depois do hardening do claim:

1. selecionar a Task candidata ainda em `QUEUED`;
2. localizar sua Execution `QUEUED` existente ou preparar uma nova;
3. fazer CAS `Task(id, state=QUEUED, version) → RUNNING` na mesma transação;
4. somente então confirmar o claim/Execution e o lease;
5. se o CAS perder para a pausa, fazer rollback integral e não devolver
   Assignment.

Os valores e a semântica de lease, fencing token, heartbeat e recuperação não
mudam. Uma Task `PAUSED` nunca satisfaz o filtro explícito `state=QUEUED`; na
dúvida ou em conflito, o scheduler retorna nenhuma Assignment.

### Prioridade e anti-starvation

A implementação futura unifica a escolha do candidato pela Task antes de
decidir se reutiliza uma Execution `QUEUED` ou cria outra. Isso evita que o
caminho de Execution pré-criada tenha precedência absoluta sobre o outro.

A seleção usa duas faixas determinísticas:

1. **aging:** se existir Task elegível com `createdAt` anterior ao limite fixo
   de aging, escolher a mais antiga por `createdAt ASC, id ASC`, ignorando
   prioridade;
2. **faixa normal:** na ausência de Task envelhecida, ordenar por
   `priority DESC, createdAt ASC, id ASC`.

O limite inicial deve ser uma constante versionada e testada, não uma variável
de ambiente que possa ampliar autonomia silenciosamente. O uso de `createdAt`
preserva a semântica FIFO atual e evita coluna de fila ou backfill nesta fase.
Uma Task antiga re-enfileirada pode ser promovida imediatamente pelo aging;
essa direção é conservadora e evita starvation.

Alterar prioridade será permitido somente em
`WAITING_APPROVAL|QUEUED|PAUSED`, com versão otimista. Em qualquer outro estado,
o comando é rejeitado e consome sua chave idempotente. Prioridade nunca cria
Execution, muda estado, decide Approval ou interrompe lease.

### Idempotência e auditoria

Pausa, retomada e prioridade reutilizam `DashboardCommandReceipt` da C2b1. O
enum de comando recebe `PAUSE_TASK|RESUME_TASK|SET_TASK_PRIORITY`; não surge
outra entidade.

Cada request hash canônico inclui ação, `taskId`, versão esperada e, para
prioridade, o nível desejado. O primeiro resultado aceito ou rejeitado vincula
a chave. Replay idêntico reproduz o código seguro; payload divergente retorna
conflito; `PENDING` permanece desfecho desconhecido e nunca reexecuta.

Recibo, CAS da Task e AuditEvent são confirmados na mesma transação. A auditoria
registra somente ação, ator, hashes, versões, estados/nível anterior e novo e
código de resultado. Comentário livre, objetivo, prompt, payload bruto,
credencial e segredo não são persistidos nesses eventos.

### Governança

Pausa, retomada e prioridade são controles operacionais. Eles não:

- aprovam Specification ou resultado;
- alteram `always_human` ou autonomia;
- pulam enforcement, orçamento, QA ou fila;
- fazem merge, deploy, retry ou reexecução;
- mudam Execution, lease ou fencing de trabalho já claimado.

## Fora de escopo

- pausa cooperativa de `RUNNING`, `TESTING` ou `FINALIZING`;
- pausar deliberação/supervisor em andamento;
- prioridade de Execution já claimada ou preempção de worker;
- prioridade por projeto, SLA pago, prioridade dinâmica por LLM ou configuração
  remota;
- rotas, contratos públicos, UI, migração aplicada ou feature flag neste PR;
- qualquer mudança em `always_human`, autonomia, enforcement, Approval ou
  recuperação de lease.

## Consequências

- a proposta é implementável por extensão aditiva da Task, do enum canônico e
  do recibo existente;
- o hardening transacional do primeiro caminho de claim é condição de segurança
  anterior à exposição de pausa;
- componentes com listas exaustivas de estado precisarão classificar `PAUSED`
  explicitamente como bloqueado, nunca como progresso ou terminal;
- rollback após existirem Tasks pausadas exige primeiro retomá-las ou
  cancelá-las; não se remove valor de enum em rollback automático;
- nenhuma dessas consequências está implementada por este ADR Proposto.

