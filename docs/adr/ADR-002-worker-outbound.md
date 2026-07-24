# ADR-002 — Worker com conexão de saída

## Status
Aceito.

## Decisão
O worker local inicia conexão segura com a nuvem. A nuvem não acessa diretamente o notebook.

## Motivo
Reduz exposição de rede e simplifica NAT/firewall.

## Consequências
É necessário heartbeat, retry e recuperação de conexão.
