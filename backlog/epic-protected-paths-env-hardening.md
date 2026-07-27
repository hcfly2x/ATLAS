# Epic — Cobertura de `.env*` em paths protegidos

## Status

Implementado, revisado e integrado na `main` pelo PR #35 em 27/07/2026, após
aprovação humana explícita exigida pelo ADR-010.

## Problema comprovado

O perfil `atlas` declara `.env*` na área semântica `secrets` e na união
`effective_globs`. O matching vigente usa `minimatch` com `matchBase: false`.
Nessa combinação:

- `.env.local` na raiz é protegido;
- `apps/coordinator/.env.local` não é protegido pelo glob `.env*`;
- `apps/coordinator/.ENV.local` também não é protegido pelo caller legado,
  que ainda faz matching case-sensitive.

O primeiro gap é da configuração versionada. O segundo pertence à migração
separada dos callers para a decisão pura de `@atlas/core`, cujo matching
case-insensitive já foi integrado.

## Objetivo

Corrigir apenas a cobertura versionada da área semântica `secrets`, para que
arquivos `.env*` na raiz ou em qualquer subdiretório sejam classificados como
paths protegidos, sem ampliar autonomia, alterar precedência ou migrar callers.

## Alteração proposta

Em entrega própria e somente após aprovação humana:

1. substituir `.env*` por `**/.env*` em
   `projects.atlas.semantic_areas.secrets`;
2. fazer a mesma substituição em
   `projects.atlas.effective_globs`;
3. adicionar testes de contrato da configuração e do matching vigente.

`**/.env*` foi escolhido em vez de habilitar `matchBase: true` globalmente,
pois expressa a intenção somente para secrets e não muda a semântica dos demais
globs. Com `minimatch`, `dot: true` e `matchBase: false`, esse padrão cobre
tanto `.env.local` na raiz quanto `apps/coordinator/.env.local`; portanto não é
necessário manter também `.env*`.

## Critérios de aceite

1. A área `secrets` e `effective_globs` contêm exatamente o mesmo padrão
   `**/.env*`, sem manter a variante redundante `.env*`.
2. O loader do coordinator entrega `**/.env*` para o projeto `atlas`.
3. Teste do caller vigente comprova que `.env`, `.env.local`,
   `apps/coordinator/.env.local` e `packages/example/.env.test` são protegidos.
4. Um path não relacionado, como `apps/coordinator/src/main.ts`, não passa a
   ser protegido por esse glob isoladamente.
5. A entrega não afirma cobertura de variações de caixa pelo caller legado nem
   transforma o comportamento case-sensitive em requisito desejado; esse gap
   permanece pendente até a migração para a decisão pura já integrada.
6. Nenhum teste lê o conteúdo de arquivo `.env*`; somente strings de paths
   sintéticos são usadas.
7. `pnpm validate` permanece verde.
8. O diff de implementação fica limitado a
   `.atlas/protected-paths.yaml`, testes diretamente relacionados e memória.

## Fora de escopo

- alterar `matchBase`, `nocase` ou a implementação do caller legado;
- migrar callers para `decideEnforcement`;
- resolver symlinks físicos;
- adicionar, ler, copiar ou versionar arquivos `.env*`;
- alterar valores de secrets ou configuração de provedores;
- editar `.atlas/projects.yaml`, `.atlas/policies.yaml` ou outros perfis;
- mudar ADRs, autonomia, máquina de estados, retry, deploy ou Fase 8;
- ampliar outros globs de áreas protegidas.

## Plano de implementação proposto

1. Caracterizar em teste o gap atual de raiz versus subdiretório.
2. Alterar os dois pontos equivalentes de `.atlas/protected-paths.yaml`.
3. Provar por teste a cobertura de raiz, subdiretório e o não-match de controle.
4. Validar que a área semântica e a união efetiva permanecem consistentes.
5. Rodar `pnpm validate`, entregar ZIP limpo e parar para revisão.

Essa implementação é uma mudança de área protegida. O início foi autorizado
explicitamente; o merge ainda exige aprovação humana.
