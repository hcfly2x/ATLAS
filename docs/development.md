# Desenvolvimento local

## Requisitos

- Node.js 20 ou superior.
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
