# Política de Merge Proporcional ao Risco

## Objetivo

Reduzir o tempo entre uma entrega pronta e a integração sem reduzir a qualidade
ou remover as fronteiras de segurança do ATLAS. A profundidade da revisão é
proporcional ao risco; CI verde é obrigatório para toda integração.

## Integração direta após CI verde

Uma entrega pode ser integrada sem auditoria externa independente quando o diff
é restrito a documentação, memória, texto, metadados ou testes que não alteram
comportamento de produção. A pessoa que integra ainda confere o escopo do diff,
a base atualizada e o CI verde.

## Auditoria completa obrigatória

Exigem auditoria completa antes do merge as entregas que alterem segurança,
dados, dinheiro, autenticação, política de autonomia, máquina de estados,
idempotência, leases/fencing, isolamento, comandos permitidos, áreas protegidas
ou credenciais/configuração de infraestrutura.

Esta classificação define a profundidade da revisão, não uma dispensa de CI,
testes, rebase ou histórico auditável.

## Merge em lote

PRs aprovados, independentes e de baixo risco podem ser integrados em sequência
na mesma sessão. Cada PR deve ser rebaseado sobre a `main` atualizada e ter CI
verde sobre esse resultado antes do respectivo merge. Conflitos em
`memory/current-state.md` são resolvidos como snapshot do estado mais recente;
`memory/changelog.md` e `memory/decisions.md` preservam os registros de ambas
as entregas.

## Limites

Acelerar a entrega não autoriza pular os Blocos 2 (runtime reproduzível) e 3
(recuperação durável). Velocidade sobre uma base que não se recupera de queda
gera retrabalho, não autonomia útil.
