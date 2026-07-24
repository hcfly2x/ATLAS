# Revisão crítica final — Epic 00

## Escopo e conclusão

Revisão realizada sobre todos os arquivos do kit v0.0.2, tomando `specifications/project-manifest.yaml` como fonte de verdade da stack e sem implementar funcionalidades.

Conclusão original: a direção arquitetural era coerente, mas havia conflitos que impediam a Fase 1. As confirmações foram recebidas em 23/07/2026 e aplicadas no kit v0.0.3. O ADR-011 foi aceito; o ADR-012 foi criado como Proposto. A revisão documental está concluída, mas a Fase 1 continua sem autorização explícita.

> Registro histórico: as inconsistências e opções abaixo preservam o diagnóstico que fundamentou a v0.0.3. Para o estado normativo atual, prevalecem os documentos corrigidos e `memory/current-state.md`.

## Inconsistências residuais

### 1. Autenticação do worker: autenticação mútua versus Bearer

- `docs/security.md`, seção “Worker”: exige “autenticação mútua”.
- `docs/adr/ADR-007-worker-transport.md`, Decisão e Motivo: define token Bearer e afirma que o modelo “dispensa mTLS”.
- `docs/architecture.md`, seção “Comunicação”: segue o ADR-007 e cita Bearer.

O termo “autenticação mútua” normalmente implica que ambos os lados autenticam criptograficamente o outro, enquanto o ADR aceito especifica TLS de servidor + Bearer para autenticar o worker. A documentação de segurança está em conflito com a decisão aceita. Correção proposta: substituir “autenticação mútua” por “TLS com validação do servidor e autenticação do worker por token Bearer exclusivo, rotacionável e com escopo por projeto”, sem mudar o ADR-007.

### 2. Numeração das fases

- `docs/master-implementation-specification.md`, “Processo obrigatório”: Fase 1 = Arquitetura; Fase 2 = Scaffolding; Fase 3 = Implementação incremental; Fase 4 = Hardening.
- `docs/implementation-plan.md`: Fase 0 = documentação; Fase 1 = Foundation; Fases 2–10 = implementação; Fase 11 = Hardening; Fase 12 = times operacionais.
- `memory/current-state.md` e o pedido atual usam a numeração do plano em duas trilhas.

“Iniciar a Fase 1” tem dois significados. Correção proposta: tornar `docs/implementation-plan.md` canônico para fases e reescrever a seção 10 da master specification como princípios/ciclos de entrega, sem numeração concorrente.

### 3. Escopo da Foundation e backlog

- `docs/implementation-plan.md`, Fase 1: Docker Compose apenas para PostgreSQL no coordinator.
- `backlog/epic-01-foundation.md`: diz genericamente “configurar Docker” e “PostgreSQL”, sem delimitar que nada disso roda no worker.
- `docs/architecture.md`, “Worker Local”: aceita “máquina local ou dedicada”, sem registrar o perfil confirmado.

Isso pode levar a uma configuração indevida de Docker no Mac M1. Correção proposta: explicitar no backlog e na arquitetura que Docker/PostgreSQL pertencem ao coordinator e que o worker não os instala nem executa.

### 4. Conselho canônico chamado de “MVP”

- `.atlas/agents.yaml`, comentário inicial: “Conselho canônico do MVP (Trilha 2)”.
- `docs/master-implementation-specification.md`, nota do MVP, e `docs/implementation-plan.md`: o MVP da Trilha 1 usa somente normalização + supervisor; o conselho entra depois do MVP, na Trilha 2.

Correção proposta: trocar o comentário por “Conselho canônico da Trilha 2”; não há mudança de arquitetura.

### 5. Áreas protegidas incompletas no enforcement

- `specifications/project-manifest.yaml`, `protected_areas`: inclui autenticação, permissões, secrets, supervisor, worker, audit e deployment.
- `docs/master-implementation-specification.md`, “Áreas protegidas”: inclui também políticas, isolamento e comandos permitidos.
- `.atlas/protected-paths.yaml`: cobre alguns paths de autenticação, políticas, auditoria e allowlist, porém não cobre de forma explícita supervisor, secrets, deployment, configuração do worker ou isolamento.
- `docs/adr/ADR-010-protected-areas-enforcement.md`: declara que a lista por projeto vive em `.atlas/protected-paths.yaml`.

Como o manifesto é a fonte de verdade, a lista técnica atual não implementaria toda a proteção declarada. Antes de criar paths reais na Fase 1, deve ser definido o mapeamento completo entre áreas semânticas e globs; qualquer alteração futura da própria lista continua sujeita a aprovação.

### 6. Configuração de projetos não satisfaz o modelo conceitual

- `docs/data-model.md`, `Project`: inclui repositório, paths protegidos e teto de custo por tarefa.
- `.atlas/projects.yaml`: nenhum projeto informa repositório ou teto de custo; só o ATLAS informa política, e apenas um projeto informa classificação de dados.
- `docs/implementation-plan.md`, Fase 2: prevê CRUD por seed/config.

Não está definido quais campos são obrigatórios, opcionais ou herdados, nem se `.atlas/projects.yaml` é seed, configuração operacional ou apenas exemplo. Isso bloqueia schema e seed da Fase 2 e afeta a validação do worker.

### 7. Contrato da especificação executável diverge por nome

- `specifications/executable-specification.md`, Identificação: `approved_scope`.
- `templates/executable-specification.yaml`: `authorized_scope`.
- O mesmo template usa `objective`, `context` e `approval_required_for`, enquanto o documento descreve títulos em linguagem natural sem fixar essas chaves.
- `docs/data-model.md`, `Specification`: referencia o “formato” do Markdown.
- ADR-009 define Zod como fonte executável futura, mas esse schema ainda não existe.

Correção proposta: escolher uma única chave (`authorized_scope` é a recomendação por coincidir com a linguagem predominante do kit), publicar tabela normativa de campos/tipos/obrigatoriedade e fazer o template derivar do schema Zod quando a Foundation for autorizada.

### 8. Falta o contrato de resultado do worker

- ADR-009 inclui explicitamente “resultado do worker” entre os contratos Zod.
- `specifications/` e `templates/` não contêm schema documental ou template desse resultado.
- `docs/master-implementation-specification.md`, “Worker local”, e `docs/implementation-plan.md`, Fase 5, citam logs, resumo, diff e testes, mas não definem campos, limites, status ou idempotência.

É uma lacuna de Fase 0 porque coordinator e worker precisam concordar antes da implementação. Deve ser definido ao menos: `task_id`, `execution_id`, status, resumo, diff/metadados, testes, comandos/exit codes, riscos, paths alterados, chunks/log references, timestamps e versão do contrato.

### 9. Contrato de parecer não é uniforme

- `docs/master-implementation-specification.md`, Rodada 1: lista entendimento, riscos, recomendação, critérios de aceite e questões.
- `specifications/agent-contract.md`, `templates/specialist-opinion.yaml` e `docs/data-model.md`: acrescentam `findings` e `confidence`.

A master specification está incompleta perante os outros três artefatos. Correção proposta: acrescentar `findings` e `confidence` à master, mantendo o contrato mais completo.

### 10. Memória global versus isolamento obrigatório

- `docs/architecture.md`, “Memory Service”: memória global, por projeto, por agente e por tarefa.
- `docs/glossary.md`: memória por “organização”.
- `docs/data-model.md`, `MemoryItem`: escopo “SEMPRE por projeto”.
- ADR-004: isolamento por projeto.

“Global” e “organização” não têm entidade nem regra de isolamento. Correção proposta para o MVP: toda memória persistida deve ter `project_id`; contexto global somente como configuração estática versionada. Se memória global persistente for desejada, requer decisão arquitetural própria.

### 11. Terminologia e campos de aprovação

- `docs/data-model.md`, `Approval.decisão`: somente `approved|rejected`, embora uma aprovação recém-criada esteja pendente; não define expiração, ator da decisão, motivo ou idempotency key.
- `docs/data-model.md` permite múltiplas aprovações por tarefa, mas não liga aprovação a uma `Execution`, `Specification` versionada ou ação sensível específica.
- `docs/implementation-plan.md`, Fase 5: commit e PR somente depois da aprovação do resultado.

Sem vínculo e versão, uma aprovação antiga pode ser aplicada ao diff ou à especificação errada. O contrato deve incluir estado `pending` (ou decisão anulável), alvo/versionamento, `requested_by`, `decided_by`, expiração e chave idempotente.

### 12. Backlog histórico não acompanha o plano em trilhas

- Na v0.0.2, os epics de Core API e Worker agrupavam escopos diferentes das Fases 2 e 5 do plano; na v0.0.3, foram realinhados em `backlog/epic-02-core-api.md` e `backlog/epic-05-worker-codex.md`.
- `backlog/epic-02-core-api.md` inclui agentes, times e sessões, embora conselho e memória estejam na Trilha 2.
- `backlog/epic-01-foundation.md` ainda contém a linha comentada “Redis removido”, em vez de um escopo limpo.

Não bloqueia a Foundation se o plano for declarado canônico, mas cria alto risco de execução fora de ordem. Recomenda-se realinhar os epics à numeração/fases da Trilha 1 antes de usar o backlog como instrução.

## Validação da máquina de estados e dos fluxos

### Fluxo simples incorreto

`docs/data-model.md` permite `ROUTING → QUEUED` para nível simples. Porém:

- a master specification exige agente de entrada, roteador e supervisor antes da fila;
- o plano do MVP exige normalização + supervisor;
- toda execução depende de uma `Specification` produzida pelo supervisor.

Essa transição permite executar sem supervisor e possivelmente sem Specification. Correção proposta:

```text
ROUTING → DELIBERATING
DELIBERATING → QUEUED                 (quando política não exige aprovação)
DELIBERATING → WAITING_APPROVAL       (quando política exige aprovação)
WAITING_APPROVAL → QUEUED             (aprovação válida)
```

No MVP, `DELIBERATING` pode representar a produção da Specification pelo supervisor, mesmo sem conselho. Alternativamente, renomear para `SPECIFYING`; isso exige confirmação porque altera o vocabulário canônico.

### Aprovação prévia tratada como obrigatória e opcional ao mesmo tempo

A linha principal do grafo inclui sempre `WAITING_APPROVAL`, mas as regras e o plano dizem que apenas ações/políticas específicas exigem aprovação e que nível crítico a força. O grafo precisa mostrar explicitamente os dois ramos acima.

### Falhas não cobertas

O grafo só define `RUNNING | TESTING → FAILED`. Normalização, roteamento, geração/validação da Specification (inclusive as duas tentativas do ADR-009), espera na fila, polling e preparação de worktree também podem falhar. Deve-se decidir entre:

- permitir `NORMALIZING|ROUTING|DELIBERATING|QUEUED → FAILED`, registrando `failure_stage`; ou
- separar falha da Task de falhas de tentativas/subprocessos.

Recomendação: `Task.state = FAILED` para falha terminal do fluxo e `Execution.status` próprio para tentativas; registrar `failure_stage` e motivo estruturado.

### Retrabalho e versionamento ambíguos

`WAITING_RESULT_APPROVAL → QUEUED` cria nova Execution, mas não informa se o retrabalho reutiliza a Specification, cria nova versão ou volta ao supervisor. Como o usuário está alterando escopo/instruções, o caminho seguro é:

```text
WAITING_RESULT_APPROVAL → DELIBERATING  (revisão da Specification)
DELIBERATING → WAITING_APPROVAL|QUEUED
```

Um retry técnico sem mudança de escopo pode ir de `FAILED → QUEUED` e criar nova Execution ligada à mesma versão da Specification.

### Rejeição e expiração do resultado ausentes

Não existe transição para rejeição definitiva ou expiração em `WAITING_RESULT_APPROVAL`. Recomenda-se:

- rejeição com retrabalho → `DELIBERATING`;
- rejeição definitiva → `CANCELLED`;
- expiração → permanecer aguardando com alerta no MVP, sem decisão automática.

### Commit/PR após aprovação não aparece no estado

O plano exige commit e PR somente após aprovação do resultado, mas o grafo vai diretamente de `WAITING_RESULT_APPROVAL` para `COMPLETED`. Deve-se decidir se commit/PR são:

- uma etapa atômica dentro da transição, que só conclui se ambos tiverem sucesso; ou
- um estado explícito `FINALIZING`.

Recomendação: estado explícito `FINALIZING`, pois Git/GitHub podem falhar e precisam de auditoria/retry sem executar Codex novamente.

### Cancelamento universal não é tecnicamente seguro

“Qualquer estado ativo → CANCELLED” não define cooperação durante `RUNNING`/`TESTING`, timeout de terminação, limpeza de worktree ou corrida com resultado recebido. O contrato deve distinguir `CANCEL_REQUESTED` de `CANCELLED`, ou declarar que `CANCELLED` só é gravado após confirmação do worker. Recomenda-se estado `CANCEL_REQUESTED`.

### Contratos relacionais insuficientes

- `Task 1—1 Specification (versão vigente)` conflita com o campo `versão`: não há como preservar histórico. Recomenda-se `Task 1—N Specification`, com uma versão ativa imutável.
- `Execution` deve referenciar `specification_id`/versão.
- `Approval` deve referenciar o alvo aprovado: Specification, Execution/result ou ação sensível.
- `AuditEvent.task_id?` não basta para eventos de worker/projeto sem tarefa; convém definir correlação e tipos de alvo, sem enfraquecer o append-only.

## Riscos técnicos não cobertos pelos ADRs aceitos

1. **Idempotência ponta a ponta:** updates do Telegram, callbacks, criação de Task, long-polling, heartbeat, chunks de log, aprovação e entrega de resultado podem ser repetidos. Idempotência aparece apenas tardiamente no hardening, mas duplicação pode executar código duas vezes no MVP.
2. **Leasing e entrega da fila:** não há contrato de claim/lease, renovação, expiração, fencing token ou recuperação quando o worker perde conexão. “Retry manual” não resolve dupla execução após lease ambíguo.
3. **Concorrência Git:** não há lock por repositório, política para branch já existente, worktree órfã, repositório sujo, submodules/LFS ou colisão de tarefas.
4. **Integridade entre aprovação e artefato:** falta hash/versionamento imutável da Specification e do diff apresentado ao usuário.
5. **Supply chain do projeto-alvo:** comandos de testes podem executar scripts arbitrários de dependências; a allowlist de nomes de comandos não contém o comportamento de `npm/pnpm` scripts.
6. **Gestão de secrets no worker:** “não enviar secrets ao modelo” não define redaction de ambiente, arquivos ignorados, keychain, subprocessos ou saída do Codex.
7. **Limites de logs e anexos:** streaming em chunks sem tamanho máximo, backpressure, retenção, criptografia, checksum ou política para conteúdo sensível.
8. **Compatibilidade e upgrades do Codex CLI:** não há versão mínima/fixada, preflight de autenticação, detecção de formato de saída ou política de rollout/rollback.
9. **Disponibilidade do coordinator:** backup/restore do PostgreSQL, migrações, RPO/RTO e comportamento do worker durante indisponibilidade não estão definidos.
10. **Segurança do token Bearer:** falta definir armazenamento, bootstrap, rotação, revogação, expiração e resposta a comprometimento.
11. **Autorização do Telegram:** o plano fala em Telegram ID único, mas não define replay de callback, vínculo de chat, troca de conta ou recuperação.
12. **Orçamento:** teto de LLM existe conceitualmente, mas não há política quando o limite é atingido nem teto separado para execução Codex.

Idempotência/lease e integridade de aprovação são decisões arquiteturais que precisam ser fechadas antes das respectivas implementações. Podem ser documentadas em novos ADRs Propostos após a confirmação das opções ao final.

## Implicações do worker M1, 8 GB e macOS Tahoe 26.4

- **Concorrência:** Codex, Node, testes e processos de build competem com o próprio macOS. O padrão seguro para o MVP é uma tarefa em execução por vez. Aumentar para duas apenas após medir memória residente, swap, pressão de memória e duração em projetos reais; builds pesados devem poder declarar exclusividade.
- **Sem Docker/banco local:** healthchecks e preflight do worker não devem exigir Docker, PostgreSQL ou acesso a sockets locais. Testes que dependam desses serviços precisam usar endpoints de teste autorizados no coordinator, mocks, ou ser marcados como indisponíveis — nunca iniciar infraestrutura silenciosamente.
- **ARM64:** dependências Node com addons nativos precisam oferecer binários `darwin-arm64` ou compilar com toolchain compatível. O preflight deve registrar `process.arch`, versão do Node, Git e Codex CLI.
- **BSD versus GNU:** flags e formatos divergem especialmente em `sed`, `grep`, `find`, `xargs`, `date`, `stat` e `readlink`. A allowlist deve validar executável e argumentos compatíveis com macOS, não copiar comandos Linux. Dependências GNU via Homebrew devem ser explícitas por projeto e usar executável/path conhecido.
- **Memória e logs:** limitar buffers de stdout/stderr, transmitir chunks com backpressure e evitar manter diff/log completo em RAM. O coordinator deve ser o sistema de registro durável.
- **Processos e cancelamento:** grupos de processos e sinais têm particularidades no macOS; o worker deve encerrar a árvore de subprocessos, aguardar grace period e somente então confirmar cancelamento.
- **Filesystem:** o padrão comum case-insensitive pode ocultar conflitos de casing que falham no CI Linux. O preflight/testes devem detectar colisões de nomes quando possível.
- **Energia e suspensão:** em MacBook, sleep interrompe polling e execução. O lease precisa tolerar heartbeat perdido sem entregar a mesma tarefa imediatamente a outro worker.

Essas escolhas estão consolidadas como opções, não como decisão, no `docs/adr/ADR-011-worker-macos-arm64.md` (status Proposto).

## Itens que dependem da confirmação do usuário

1. **Fonte canônica para a numeração das fases.** Opções: (A) plano em duas trilhas; (B) seção 10 da master specification. **Recomendação: A**, atualizando a master para não manter numeração concorrente.
2. **Nome do estado de produção da Specification no MVP.** Opções: (A) manter `DELIBERATING`, mesmo com supervisor único; (B) renomear para `SPECIFYING` e reservar deliberação ao conselho. **Recomendação: B**, por expressar o fluxo real, aceitando a migração documental.
3. **Finalização após aprovação do resultado.** Opções: (A) transição atômica direta a `COMPLETED`; (B) estado `FINALIZING` para commit/PR. **Recomendação: B**.
4. **Cancelamento durante execução.** Opções: (A) manter transição direta; (B) adicionar `CANCEL_REQUESTED` e só confirmar após o worker parar. **Recomendação: B**.
5. **Retrabalho rejeitado.** Opções: (A) reenfileirar a mesma Specification; (B) voltar ao supervisor, criar nova versão e reavaliar aprovação. **Recomendação: B**; retry estritamente técnico reutiliza a versão.
6. **Memória fora de projeto.** Opções: (A) toda memória persistida exige projeto; (B) introduzir escopo global/organização. **Recomendação: A no MVP**.
7. **Contrato da especificação.** Opções: (A) padronizar `authorized_scope`; (B) padronizar `approved_scope`. **Recomendação: A**.
8. **ADR-011 — perfil do worker macOS/ARM64.** Opções: (A) perfil portátil, concorrência 1 e GNU somente se declarado; (B) Homebrew/GNU obrigatório; (C) VM/container local. **Recomendação: A**.
9. **Idempotência e lease antes do MVP.** Opções: (A) definir agora em ADR(s) Proposto(s); (B) postergar integralmente ao hardening. **Recomendação: A**, pois dupla execução é risco de segurança e custo.
10. **Integridade da aprovação.** Opções: (A) aprovação ligada apenas à Task; (B) ligada à versão/hash da Specification e do resultado/diff. **Recomendação: B**.
11. **Provedor de hospedagem do coordinator** (pendência de `memory/todos.md`). Opções: (A) VPS simples; (B) Railway; (C) Fly.io. **Recomendação: B para o MVP**, condicionada a confirmar suporte operacional atual a PostgreSQL, região, backups e custo antes de contratar.
12. **Provedor/modelo de LLM e teto mensal** (pendência de `memory/todos.md`). Opções: (A) um provedor/modelo fixo; (B) interface multi-provedor desde o início com um default. **Recomendação: B na interface e um único provedor operacional no MVP**; o provedor, modelo e valor do teto precisam ser informados pelo usuário.
13. **Retenção de arquivos e logs** (pendência de `memory/todos.md`). Opções: (A) 7 dias; (B) 30 dias; (C) configurável por classificação, com default de 30 dias e prazo menor para dados sensíveis. **Recomendação: C**, definindo também exclusão, backups e exceções de auditoria.
14. **Campos obrigatórios de Project/configuração.** Opções: (A) todos os campos conceituais obrigatórios; (B) mínimos obrigatórios + defaults explícitos e validação antes de ativar. **Recomendação: B**, exigindo ao ativar pelo menos repositório, classificação, política, paths protegidos e tetos.
15. **Contrato de resultado do worker.** Opções: (A) documentá-lo ainda no Epic 00; (B) defini-lo apenas na Fase 5. **Recomendação: A**, porque é fronteira entre componentes.

## Checklist de prontidão para a Fase 1

- [x] Todos os arquivos do kit foram lidos na ordem prescrita por `AGENTS.md`.
- [x] Manifesto da stack identificado como fonte de verdade.
- [x] ADRs 001–010 preservados sem alteração.
- [x] Máquina de estados comparada com o fluxo da master specification.
- [x] Configuração confirmada do worker registrada em `memory/decisions.md`.
- [x] Pendência de sistema operacional removida de `memory/todos.md`.
- [x] Riscos específicos de macOS/ARM64 e 8 GB registrados.
- [x] Nova decisão necessária registrada apenas como ADR-011 Proposto.
- [x] Confirmações numeradas acima recebidas.
- [x] Conflito de autenticação em `docs/security.md` corrigido conforme ADR-007.
- [x] Numeração das fases unificada.
- [x] Máquina de estados corrigida e aprovada.
- [x] Contratos de Specification, Approval, Execution e resultado do worker tornados inequívocos.
- [x] Mapeamento completo de áreas protegidas definido.
- [x] Campos e papel de `.atlas/projects.yaml` definidos.
- [x] Backlog realinhado ao plano canônico.
- [x] ADR-011 aceito.
- [x] Integridade de aprovação registrada no modelo e contratos.
- [x] Idempotência/lease registrada no ADR-012 como proposta.
- [x] Pendências decisórias originais de `memory/todos.md` resolvidas.
- [x] Epic 00 aceito pelo usuário.
- [ ] Autorização explícita do usuário para iniciar a Fase 1 recebida.
