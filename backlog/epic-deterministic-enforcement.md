# Epic — Enforcement determinístico

## Status

Implementação incremental em andamento por autorizações próprias: decisão pura,
caracterização, shadow e correção de `.env*` estão integrados; o cutover do
primeiro caller de paths está em revisão. Caller de comandos e AuditEvent
continuam entregas posteriores e não autorizadas por este epic.

## Objetivo

Tornar repetíveis e auditáveis as decisões já existentes de allowlist de
comandos e proteção de paths, sem criar um segundo Policy Engine, Tool Gateway,
executor ou máquina de estados.

Para a mesma configuração versionada e a mesma entrada normalizada, o worker
deve produzir a mesma decisão estruturada antes de executar comandos, commitar
ou abrir pull request.

## Base existente a estender

- allowlist estruturada do worker e do `Project.runtime`;
- precedência de `forbidden_commands`;
- resolução do executável e validação de argumentos sem shell;
- perfis e globs de `.atlas/protected-paths.yaml`;
- `protected_path_matches` no resultado do worker;
- `Approval` e `AuditEvent` existentes.

Nenhuma entidade nova é justificada por este escopo.

## Entrega proposta

### 1. Decisão pura e estruturada

Extrair uma fronteira pura que receba:

- comando normalizado (`executable` e `args`);
- comandos permitidos e proibidos do Project;
- paths alterados, normalizados relativamente à raiz da worktree;
- globs protegidos versionados;
- ação solicitada (`execute_command`, `commit` ou `open_pull_request`).

E retorne:

- decisão `allow|deny|require_human`;
- código de motivo estável;
- regras correspondentes;
- evidência normalizada usada na decisão;
- hash canônico da entrada e da decisão.

### 2. Precedência explícita

A ordem mínima será:

1. entrada inválida ou ambígua → `deny`;
2. comando proibido → `deny`;
3. comando ausente da allowlist → `deny`;
4. path protegido antes de commit/PR → `require_human`;
5. combinação integralmente permitida → `allow`.

Nenhuma regra pode inferir comandos, instalar dependências ou ampliar o escopo
de uma Specification.

### 3. Auditoria

Persistir a decisão na trilha existente com:

- `task_id`, `execution_id` e `correlation_id`;
- código de motivo e regras correspondentes;
- hashes da entrada/configuração/decisão;
- nenhuma credencial, conteúdo de `.env` ou comando não sanitizado.

Repetição idempotente com a mesma entrada deve preservar o mesmo efeito.

## Critérios de aceite

1. A mesma entrada e configuração produzem JSON canônico e hash idênticos em
   execuções repetidas.
2. `forbidden_commands` prevalece sobre qualquer allowlist.
3. Executável, argumentos ou path ambíguos falham fechados.
4. Paths protegidos nunca resultam em commit ou PR automático.
5. Paths não protegidos não são escalados por diferença de ordem, separador de
   path ou duplicação equivalente.
6. Nenhum comando é interpretado por shell ou inferido pelo worker.
7. Toda decisão aceita, negada ou escalada gera AuditEvent correlacionado e
   sanitizado, sem trilha paralela.
8. Testes cobrem repetição, ordem de regras, normalização macOS, paths com
   traversal, symlinks e conflitos allowlist/negação.
9. `pnpm validate` e integração PostgreSQL permanecem verdes.
10. Não há alteração em `always_human`, níveis de autonomia, máquina de estados,
    merge ou deploy.

## Fora de escopo

- ampliar `autonomy_level`;
- retry funcional ou técnico novo;
- editar `.atlas/projects.yaml` ou `.atlas/protected-paths.yaml`;
- aceitar novos executáveis ou argumentos;
- resolver o destino físico de symlinks fora da worktree sem desenho e testes
  próprios;
- criar UI de políticas;
- deploy ou merge automático;
- Fase 8.

## Plano incremental proposto

1. Caracterizar por testes as decisões atuais da allowlist e de paths.
2. Introduzir a decisão pura sem alterar os callers.
3. Migrar um caller por vez, comparando decisão antiga e nova em testes.
4. Adicionar AuditEvent somente após equivalência comprovada.
5. Rodar amostra versionada de entradas repetidas e publicar os hashes.

Cada passo exige revisão completa por tocar worker, comandos, auditoria e áreas
protegidas.
