# Segurança

## Princípios

- Menor privilégio.
- Negar por padrão.
- Aprovação humana para ações sensíveis.
- Separar ambiente de desenvolvimento e produção.
- Não enviar secrets ao modelo.
- Registrar toda ação relevante.

## Ações sempre bloqueadas sem aprovação

- deploy;
- merge na branch principal;
- exclusão de dados;
- migração destrutiva;
- alteração de autenticação;
- mudança de pagamentos;
- mudança de tracking;
- aumento de orçamento de anúncios;
- alteração das políticas do próprio ATLAS.

## Worker

- conexão iniciada de dentro para fora;
- TLS com validação do servidor e autenticação do worker por token Bearer exclusivo, rotacionável e com escopo por projeto (ADR-007);
- escopo por projeto;
- diretório isolado;
- allowlist de comandos;
- timeouts;
- limite de recursos e uma execução concorrente por padrão (ADR-011);
- logs sanitizados.

## Retenção

- política configurável por classificação de dados;
- prazo padrão de 30 dias para arquivos e logs;
- prazo menor obrigatório para dados sensíveis, definido na configuração do projeto antes de sua ativação;
- eventos de auditoria append-only não expiram no MVP;
- exclusão deve considerar também cópias de backup conforme a janela operacional do provedor.

## Dados financeiros

- não registrar conteúdo integral de extratos;
- mascarar contas e cartões;
- separar metadados de documentos;
- criptografar arquivos em repouso;
- retenção e exclusão configuráveis.

## Marketing

- nenhuma autonomia financeira irrestrita;
- teto por campanha;
- teto por alteração;
- rollback;
- auditoria;
- aprovação para campanhas novas e mudanças grandes.
