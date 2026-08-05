# ADR-031 — Gestão governada de projetos pela Dashboard

## Status

Proposto.

## Contexto

O Mac do dono executa coordinator, worker e Postgres e também contém os
repositórios locais. O wizard `/setup` já edita `.atlas/projects.yaml`, mas é
loopback e não atende a operação cotidiana remota da Dashboard autenticada.
Criar, configurar ou ativar projeto altera governança: define repositório,
comandos permitidos, autonomia, retenção e elegibilidade para novas demandas.

## Decisão proposta

- `.atlas/projects.yaml` continua sendo a fonte de verdade. A Dashboard reutiliza
  `ProjectConfigStore`; não cria um segundo modelo de configuração.
- A projeção `Project` do Postgres é sincronizada após cada alteração aceita para
  que o intake existente veja imediatamente o novo status.
- A sincronização usa um reconciliador único. Um retry cuja intenção já está
  aplicada no YAML repete o upsert da projeção e conclui idempotentemente; hash
  ou conteúdo divergente continua falhando fechado.
- Antes de escutar tráfego, o coordinator valida o YAML completo e, em uma
  transação, faz upsert exato de todos os projetos declarados. Uma projeção
  `ACTIVE` ausente do YAML é arquivada para nunca manter elegibilidade mais
  permissiva que a fonte de verdade. YAML ausente ou inválido aborta o startup
  sem alterar a projeção.
- Toda escrita exige sessão C1, permissão `dashboard:project-config:write`, CSRF,
  confirmação explícita, hash otimista e recibo durável idempotente. Leitura usa
  a permissão separada `dashboard:project-config:read`.
- Projeto novo nasce `draft`, autonomia 2, `least_privilege`, sem repositório e
  sem comandos. Ativação é explícita e reutiliza `activationIssues`.
- O caminho do repositório é validado no servidor como absoluto e Git válido.
  Ele pode entrar no request de configuração, mas não volta no contrato público,
  log ou auditoria; a resposta informa apenas se está configurado.
- Auditoria persiste somente resumos sanitizados de status, autonomia, retenção,
  executáveis permitidos e presença de repositório. Credenciais e argumentos não
  são persistidos como evidência da operação web.
- A criação de demanda continua usando exclusivamente o fluxo C2b1 e exige
  projeto ativo.

## Consequências

O recurso só funciona quando o coordinator enxerga o mesmo filesystem dos
repositórios — a topologia Mac-servidor decidida nesta fase. Render ou outro
coordinator remoto falha fechado ao validar um caminho local do Mac. Clonar por
URL e worker hospedado exigem ADR próprio.

O arquivo e o banco não compartilham uma transação. A operação escreve o arquivo
atomicamente e usa uma transação Prisma para projeção, auditoria e recibo. Em
falha posterior à escrita, o retry com a mesma chave reconcilia o estado desejado
sem duplicar projeto; divergência de hash falha fechado para revisão humana.
O boot também converge divergências anteriores. A reconciliação não cria Task,
Execution ou Approval e registra somente status, autonomia, retenção,
executáveis, presença de repositório e hashes canônicos — nunca path ou args.

## Fora de escopo

Core, worker, scheduler, Approval, enforcement, `always_human`, máquina de
estados, cutover de enforcement, repositório por URL e execução em nuvem.
