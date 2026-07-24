# ADR-014 — Níveis de autonomia por projeto

## Status

Proposto.

## Contexto

O fluxo baseado em aprovação síncrona para toda execução gera fricção excessiva
na operação de um único usuário. Alterações de código em branch isolada, com
testes e revisão assíncrona por pull request, são reversíveis antes do merge e
podem receber mais autonomia sem reduzir a autoridade humana sobre ações
irreversíveis.

Os níveis 0–4 antes descritos apenas para marketing passam a ser política de
qualquer Project. O nível é configurado por projeto e não substitui o
enforcement de áreas protegidas do ADR-010.

O usuário decidiu adotar o nível 2 como padrão de todos os projetos. O desenho de
enforcement permanece proposto e será implementado somente nas fases indicadas no
plano e em `memory/todos.md`.

## Proposta

### Nível 0 — Observação

- o ATLAS apenas analisa e registra;
- não recomenda ação executável;
- não cria Specification para execução;
- não executa, commita ou abre pull request.

### Nível 1 — Recomendação

- o ATLAS analisa e recomenda;
- exige aprovação humana prévia da Specification;
- exige aprovação humana do resultado;
- execução permanece isolada e não implica autorização de merge.

### Nível 2 — Autonomia limitada

- tarefas simples e moderadas dispensam aprovação prévia;
- a execução ocorre em branch e worktree isoladas;
- testes verdes e ausência de paths protegidos permitem commit e abertura
  automática de pull request;
- a revisão do resultado é assíncrona pelo pull request;
- merge permanece sempre humano;
- tarefas críticas continuam sujeitas à aprovação prévia.

Este é o padrão decidido para todos os projetos.

### Nível 3 — Autonomia supervisionada

- inclui todas as capacidades do nível 2;
- tarefas críticas também dispensam aprovação prévia;
- admite retry automático somente para falhas técnicas classificadas, como rede,
  timeout ou lease expirado;
- retry técnico exige idempotência, nova Execution quando aplicável e fencing
  token vigente;
- Codex nunca é reexecutado enquanto houver lease ambíguo ou possibilidade de a
  execução anterior ainda estar ativa;
- falha funcional, teste vermelho, conflito de escopo ou alteração protegida não
  é retry técnico.

### Nível 4 — Reservado

- não é habilitado no MVP;
- capacidades e limites exigem decisão arquitetural futura;
- nenhuma configuração pode ativá-lo antes dessa decisão.

## Ações sempre humanas

Independentemente do nível:

- merge na `main`;
- deploy em produção (`deploy_production`);
- migração destrutiva;
- exclusão de dados;
- mudança de pagamento;
- mudança de tracking;
- aumento de orçamento de anúncios;
- alteração em áreas protegidas pelo ADR-010.

Deploy em staging (`deploy_staging`) não faz parte da lista `always_human`: a
partir do nível 2, pode ocorrer automaticamente depois do merge humano na `main`
e de CI verde, conforme o ADR-015 proposto.

## Aprovação automática e auditoria

Dispensar interação síncrona não elimina o registro de Approval. Toda aprovação
automática:

- cria um registro Approval com `actor=system`;
- referencia `target_type`, `target_id`, `target_version` e hashes
  correspondentes;
- gera AuditEvent correlacionado;
- aplica a mesma imutabilidade e idempotência do fluxo manual.

## Relação com ADR-012

O ADR-012 passa a admitir retry automático de falha exclusivamente técnica no
nível 3. Lease expirado torna a execução elegível para reconciliação; não prova
que Codex parou. O coordinator só pode criar nova tentativa depois de resolver a
ambiguidade, invalidar o executor anterior por fencing token e comprovar que não
haverá execução concorrente do mesmo trabalho.

## Consequências

- `Project` passa a declarar `autonomy_level`, com default 2.
- Fase 4 avalia o nível e a criticidade ao decidir se a Specification exige
  `WAITING_APPROVAL`.
- Fase 5 aplica condições de testes, paths protegidos, commit/PR e retry técnico.
- Pull request torna-se a principal fronteira de revisão assíncrona no nível 2.
- A lista `always_human` não varia por nível.
- Este ADR não autoriza enforcement antecipado.
