# Checklist macro de encerramento do ATLAS

## Finalidade e limite

Este documento é a baseline única para avaliar uma futura declaração de
conclusão do projeto ATLAS. Ele consolida somente evidências versionadas
identificáveis no repositório e não declara conclusão funcional, operacional ou
formal do projeto.

Estados usados: `concluído`, `pendente`, `bloqueado`, `não avaliado`,
`requer confirmação` e `fora do escopo`.

## Evidências comprovadas

| Área | Item | Estado | Evidência |
| --- | --- | --- | --- |
| Documentação e hierarquia | Documento conciso da hierarquia de comando criado | concluído | `docs/command-hierarchy.md` |
| Estado atual do projeto | Memória de estado atualizada | concluído | `memory/current-state.md` |
| Validação desta baseline | Diferenças Git sem erros de whitespace | concluído | `git diff --check`, executado sem saída e com código 0 em 27/07/2026 |

O resultado de `git diff --check` cobre somente whitespace nas diferenças Git.
Ele não substitui testes funcionais, de integração, regressão, operação ou
aceite.

## Escopo e critérios de conclusão

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Confirmar o escopo completo do ATLAS e o inventário de entregáveis aplicáveis | requer confirmação | Escopo e entregáveis aprovados por autoridade competente | Documento versionado ou decisão formal que enumere o escopo de encerramento | Decisão oficial de escopo | requer confirmação |
| Definir critérios globais e formais de aceite | pendente | Critérios objetivos aprovados e associados aos entregáveis aplicáveis | Registro versionado dos critérios e da aprovação | Confirmação do escopo | requer confirmação |
| Declarar o ATLAS concluído, encerrado ou aprovado para entrega | bloqueado | Todas as pendências críticas aplicáveis resolvidas e aceite formal obtido | Checklist integralmente avaliado, evidências vinculadas e aprovação formal | Todos os itens aplicáveis desta baseline | requer confirmação |

## Documentação e hierarquia

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Obter confirmação formal da revisão de `docs/command-hierarchy.md` contra as fontes oficiais listadas no próprio documento | requer confirmação | Autoridade competente confirma a revisão manual desta baseline | Registro de revisão citando `docs/master-implementation-specification.md`, `docs/architecture.md`, `.atlas/agents.yaml`, `.atlas/routing.yaml`, `.atlas/policies.yaml` e `memory/current-state.md` | Revisão manual desta baseline disponível | requer confirmação |
| Resolver a divergência entre `specifications/project-manifest.yaml` (`project.status: planning`) e os registros de fases implementadas | requer confirmação | Autoridade do projeto confirma o significado do status canônico ou autoriza sua atualização | Decisão versionada; se aplicável, alteração separadamente autorizada do manifesto | Aprovação para alterar fonte oficial | requer confirmação |
| Avaliar completude e atualidade da documentação operacional | não avaliado | Conjunto aplicável identificado e revisado contra critérios aprovados | Inventário, revisão registrada e aceite dos documentos operacionais | Confirmação do escopo e dos critérios | requer confirmação |

## Estado atual do projeto

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Confirmar a consistência futura entre esta baseline e `memory/current-state.md` | requer confirmação | Revisões futuras preservam a distinção entre fatos, decisões de escopo e entregas concluídas | Revisão conjunta versionada dos dois artefatos | Mudanças futuras de estado ou checklist | requer confirmação |
| Confirmar fase, blocos e hotfixes efetivamente integrados no repositório canônico | não avaliado | Registros documentais reconciliados com histórico e artefatos de integração | Inventário de versões, merges ou PRs aceitos e respectivos resultados de CI | Acesso e autorização para inventário detalhado | requer confirmação |

## Implementação funcional

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Inventariar módulos e funcionalidades aplicáveis | não avaliado | Todos os módulos do escopo confirmado mapeados a requisitos e estado | Matriz de requisitos, módulos e evidências | Confirmação do escopo; inventário detalhado autorizado | requer confirmação |
| Validar o ciclo ponta a ponta aplicável | não avaliado | Cenários de aceite do fluxo completo executados com resultado aprovado | Relatórios de execução, logs sanitizados e aceite | Critérios formais; ambiente autorizado | requer confirmação |
| Avaliar pendências funcionais e regressões conhecidas | não avaliado | Backlog aplicável revisado, classificado e aceito para encerramento | Backlog reconciliado e decisões formais por item | Inventário funcional | requer confirmação |

## Dados, contratos e integrações

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Inventariar dados, contratos e integrações aplicáveis | não avaliado | Fronteiras aplicáveis identificadas com donos e critérios | Inventário versionado de schemas, contratos e integrações | Confirmação do escopo | requer confirmação |
| Validar compatibilidade e comportamento das integrações | não avaliado | Cada integração aplicável passa pelos cenários aprovados | Testes de contrato/integração e resultados rastreáveis | Inventário; ambientes e credenciais autorizados | requer confirmação |
| Confirmar requisitos de segurança, retenção e isolamento aplicáveis | não avaliado | Controles do escopo avaliados e riscos residuais formalmente aceitos | Revisão de segurança, evidências de controles e aceite de risco | Inventário de dados; autorização específica | requer confirmação |

## Testes e regressão

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Definir a matriz de testes necessária ao encerramento | pendente | Cobertura exigida aprovada para todos os entregáveis aplicáveis | Plano versionado de testes e critérios de passagem | Escopo e critérios formais | requer confirmação |
| Executar validação funcional, de integração e regressão | não avaliado | Suíte autorizada executada no estado candidato a encerramento | Comandos, versões, relatórios e resultados reproduzíveis | Matriz de testes; ambiente preparado | requer confirmação |
| Avaliar falhas, testes ignorados e cobertura insuficiente | não avaliado | Exceções resolvidas ou aceitas formalmente | Relatório de exceções e aceite de risco | Resultados completos dos testes | requer confirmação |

## Operação, riscos e dependências

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Inventariar dependências técnicas e operacionais | não avaliado | Dependências aplicáveis, versões, disponibilidade e responsáveis registrados | Inventário versionado e validações de disponibilidade | Escopo confirmado | requer confirmação |
| Avaliar observabilidade, recuperação e documentação operacional | não avaliado | Critérios operacionais executados e aprovados | Runbooks, métricas, alertas e exercícios de recuperação | Critérios operacionais; ambiente autorizado | requer confirmação |
| Consolidar riscos remanescentes e decisões de aceite | pendente | Cada risco material possui tratamento ou aceite formal | Registro de riscos com decisão, responsável e data | Avaliações funcionais, técnicas e operacionais | requer confirmação |

## Decisão sobre Telegram

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Publicação no Telegram | requer confirmação | Autoridade do projeto decide formalmente se a publicação é entrega obrigatória ou está fora do escopo | Decisão versionada de escopo e, somente se autorizada e aplicável, evidência de publicação | Aprovação explícita para classificar e eventualmente publicar | requer confirmação |

Situação factual: **não realizada — requer decisão de escopo**. A publicação não
é uma entrega concluída, não foi classificada definitivamente como pendente
obrigatória nem como fora do escopo, e nenhuma publicação foi executada nesta
tarefa.

## Aceite final

| Item | Estado | Condição de encerramento | Evidência esperada | Dependências | Responsável |
| --- | --- | --- | --- | --- | --- |
| Revisar esta baseline após a avaliação das áreas aplicáveis | pendente | Todos os itens aplicáveis possuem estado final e evidência rastreável | Nova revisão versionada do checklist | Avaliações e decisões anteriores | requer confirmação |
| Obter aceite formal do encerramento | bloqueado | Autoridade competente aprova explicitamente o conjunto exato de evidências | Registro de aprovação com escopo, data e responsável | Checklist sem bloqueios críticos | requer confirmação |

## Revisões desta baseline

- Consistência: nenhum item sem evidência foi marcado como concluído.
- Telegram: registrado como não realizado e ausente das entregas concluídas.
- Rastreabilidade: conclusões apontam para evidência disponível; demais itens
  indicam condição de encerramento, evidência esperada, dependências e
  responsável conhecido ou `requer confirmação`.
- Escopo: nenhuma conclusão funcional, operacional ou formal foi inferida.
- Hierarquia: nenhuma divergência material foi identificada entre
  `docs/command-hierarchy.md` e as fontes oficiais consultadas.
- Fonte de verdade: a divergência de status do manifesto foi preservada como
  `requer confirmação`, sem alteração de arquitetura ou fonte oficial.

## Bloqueios para declarar conclusão

A declaração de conclusão do ATLAS permanece bloqueada até que:

1. o escopo e os entregáveis aplicáveis sejam confirmados;
2. as áreas aplicáveis sejam avaliadas com evidência verificável;
3. testes e critérios globais de aceite sejam definidos e satisfeitos;
4. riscos e dependências materiais sejam resolvidos ou formalmente aceitos;
5. a classificação da publicação no Telegram seja decidida formalmente; e
6. o aceite final seja emitido pela autoridade competente.
