# Amostra real do shadow de comandos — 2026-07-28

## Versão observada

- worker/main: `f4d3a4b` (merge do PR #42);
- Task: `0f7ee1cb-8e1d-40fd-a6c7-29f6f8c7116c`;
- Execution: `102197a1-05e6-4eaf-b471-7a32f3d0ae68`.

## Resultado

| executável | legado | decisão pura | divergência |
| --- | --- | --- | --- |
| `git` | `allow` | `allow` | `none` |

- avaliações: 1;
- `MORE_PERMISSIVE`: 0;
- argumentos crus presentes no log: 0;
- `inputHash`:
  `sha256:be3597920fc79c7f9cf78f81922ccad72369ff8f828b9c67473f4f560774cfce`;
- `decisionHash`:
  `sha256:89b62646f51dcd6c152de5eb046d25642cb8afa88fee861f3f577954e7f1bcc7`.

O retorno posterior da Task a `SPECIFYING` foi causado pelo QA pós-execução e
não por autorização de comando. Esta evidência não autoriza merge do cutover:
o PR continua sujeito a revisão empírica completa.
