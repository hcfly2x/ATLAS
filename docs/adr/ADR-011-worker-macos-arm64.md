# ADR-011 — Perfil de execução do worker macOS/ARM64

## Status
Aceito.

## Contexto
O worker confirmado pelo usuário rodará em um Mac mini ou MacBook M1 com 8 GB de RAM e macOS Tahoe 26.4. Docker e banco de dados permanecem no coordinator em nuvem; localmente o worker precisa apenas de Node.js, Git, Codex CLI e dos repositórios dos projetos.

O kit ainda não define limites de concorrência, descoberta de capacidades nem como a allowlist tratará diferenças entre utilitários BSD do macOS e GNU frequentemente usados por scripts de projetos.

## Opções

1. **Perfil portátil conservador:** uma execução por vez; comandos da allowlist identificados por programa e argumentos, sem presumir flags GNU; preflight registra arquitetura, versões e capacidades; ferramentas GNU adicionais só entram por configuração explícita do projeto.
2. **Ambiente GNU instalado no host:** uma execução por vez no início, com Homebrew e GNU coreutils obrigatórios, usando paths/prefixos controlados.
3. **Isolamento por VM/container:** padronizar Linux localmente. Incompatível com a restrição atual de não rodar Docker no worker e mais pesado para 8 GB.

## Decisão
Adotar a opção 1 no MVP. Manter concorrência padrão em 1, permitir configuração futura após medição e exigir que cada projeto declare comandos, versões mínimas e eventuais dependências GNU.

## Consequências
- O worker deverá executar preflight antes de aceitar tarefas de um projeto.
- A allowlist deverá validar o executável resolvido e argumentos, e não aceitar strings de shell arbitrárias.
- Scripts que dependam de `grep`, `sed`, `find`, `xargs`, `date`, `stat` ou `readlink` GNU precisarão de variante portátil ou dependência declarada.
- O limite de concorrência não será elevado sem telemetria de memória e validação explícita.
- O perfil poderá ser ampliado somente por decisão explícita após telemetria em projetos reais.
