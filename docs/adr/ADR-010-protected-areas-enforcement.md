# ADR-010 — Enforcement técnico de áreas protegidas

## Status
Aceito.

## Decisão
A política SELF_MODIFICATION_RESTRICTED é aplicada em três camadas:
1. **Roteamento**: demandas sobre paths protegidos são sempre nível crítico.
2. **Worker**: antes do commit, o diff é verificado contra a lista de paths protegidos do projeto; alterações em paths protegidos bloqueiam o commit e escalam para aprovação humana.
3. **Repositório**: CODEOWNERS + branch protection na main como última barreira.

## Motivo
Política escrita sem mecanismo é apenas intenção. A verificação de diff no worker é o ponto de aplicação mais barato e confiável.

## Consequências
A lista de paths protegidos vive em `.atlas/protected-paths.yaml` por projeto e só pode ser alterada com aprovação humana.
