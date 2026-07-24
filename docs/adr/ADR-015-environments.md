# ADR-015 — Ambientes de staging e produção

## Status

Proposto.

## Contexto

O ATLAS precisa validar o fluxo real do Telegram e do coordinator antes de
promover mudanças para produção. A autonomia de staging pode ser maior porque o
ambiente é isolado, usa dados sintéticos e continua condicionado ao merge humano
na `main`.

Nenhum ambiente é provisionado por este ADR.

## Proposta

Manter dois ambientes no Render a partir do mesmo repositório.

### Staging

- deploy automático após cada merge na `main`, desde que o CI esteja verde;
- banco PostgreSQL próprio;
- dados exclusivamente sintéticos, criados pelo seed;
- bot Telegram próprio e separado do bot de produção;
- secrets e `DATABASE_URL` exclusivos do ambiente;
- nenhum dado real, especialmente de projetos classificados como
  `personal_financial`;
- smoke tests pós-deploy obrigatórios.

### Produção

- promoção manual e sempre humana;
- Web Service persistente, sem hibernação;
- banco, secrets e `DATABASE_URL` separados de staging;
- nenhuma promoção quando staging ou seus smoke tests estiverem falhando.

## Smoke tests de staging

Depois do deploy, validar:

1. health do coordinator;
2. criação de Task;
3. transição de estado;
4. criação do AuditEvent correspondente.

Todos devem passar antes de habilitar a promoção. Falha de smoke test bloqueia a
promoção para produção.

## Estratégia de branch

- uma única branch de longa duração: `main`;
- não criar `develop`;
- branches de trabalho permanecem curtas e são integradas por pull request;
- staging acompanha os merges da `main`;
- produção recebe promoção manual de uma revisão já validada em staging.

## Segurança e configuração

- secrets nunca são compartilhados entre ambientes;
- `DATABASE_URL` nunca é reutilizada entre staging e produção;
- staging não pode receber cópia de dados reais;
- `render.yaml` permanece área protegida pelo ADR-010;
- criação ou alteração de `render.yaml` exige aprovação humana;
- o bot de staging não usa o token do bot de produção.

## Consequências

- `deploy_staging` pode ser automático a partir do nível 2 após merge humano e
  CI verde.
- `deploy_production` permanece `always_human` em todos os níveis.
- É necessário um epic de infraestrutura posterior ao fechamento da Fase 3.
- Esta proposta não cria serviços, bots, secrets, webhook, `render.yaml` ou
  configuração de produção.
