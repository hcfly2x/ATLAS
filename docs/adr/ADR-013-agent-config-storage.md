# ADR-013 — Persistência da configuração de agentes editada pela UI

## Status

Proposto.

## Contexto

A Fase 10 prevê uma interface para criar e editar agentes — nome, papel,
habilidades e contexto — e organizá-los em times, como alternativa à edição
direta de `.atlas/agents.yaml`.

Hoje, `.atlas/**` é uma área protegida pelo ADR-010. Portanto, qualquer mecanismo
de edição da configuração de agentes precisa preservar aprovação humana e
auditabilidade. Antes de implementar a interface, será necessário decidir qual
será a fonte de verdade desses dados.

Esta decisão será tomada quando a Fase 10 for iniciada. O registro desta ideia e
deste ADR não autoriza implementação antecipada.

## Opções

### Opção A — Manter arquivos versionados em `.atlas/`

A interface edita a configuração por meio da geração de commits e pull requests
que alteram os arquivos protegidos em `.atlas/`.

Consequências:

- preserva arquivos versionados como fonte de verdade;
- mantém histórico e revisão no fluxo Git;
- exige que a interface produza alterações válidas e abra commits/PRs;
- precisa respeitar as aprovações e proteções definidas pelo ADR-010;
- conflitos Git e sincronização entre interface e branch precisam ser tratados.

### Opção B — Migrar a configuração para o banco

A interface persiste a configuração de agentes no banco, com trilha de auditoria
própria.

Consequências:

- simplifica operações interativas de criação, edição e organização;
- exige modelo de dados, controle de concorrência e migração dos arquivos atuais;
- precisa reproduzir aprovação humana, versionamento, histórico e auditabilidade;
- exige definir se `.atlas/agents.yaml` deixa de ser fonte de verdade, vira
  exportação ou permanece como representação sincronizada;
- amplia as responsabilidades de backup e recuperação do banco.

## Decisão pendente

Nenhuma opção foi escolhida. A decisão será tomada na chegada da Fase 10, após
avaliar os requisitos operacionais, de aprovação e de auditabilidade da
interface.
