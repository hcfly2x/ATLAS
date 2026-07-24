# ADR-016 — Skills anexáveis a agentes

## Status

Proposto.

## Contexto

O catálogo de agentes tende a crescer de forma artificial quando cada
tecnologia, ferramenta ou domínio específico vira um novo papel. Papel e
capacidade são dimensões diferentes: um arquiteto pode precisar de uma skill de
PostgreSQL em uma demanda e de uma skill de segurança de APIs em outra, sem
deixar de ser arquiteto.

O padrão de capacidades anexáveis está validado no mercado por registros
corporativos de skills com RBAC e auditoria e por marketplaces de skills. O
ATLAS precisa preservar essas propriedades sem antecipar implementação ou
escolher um formato definitivo nesta etapa.

Como `.atlas/**` é área protegida pelo ADR-010, definições de skills e seus
vínculos exigem versionamento, revisão humana e auditabilidade.

## Proposta

- agentes continuam declarando identidade e papel;
- skills representam capacidades reutilizáveis e anexáveis a agentes
  existentes;
- uma skill pode declarar conhecimento, instruções, limites, ferramentas
  permitidas, versão e compatibilidade;
- times passam a ser composições de papéis mais skills, evitando criar um papel
  novo para cada tecnologia;
- skills são versionadas em `.atlas/` e permanecem sujeitas ao ADR-010;
- a seleção de skills não amplia automaticamente o escopo, as permissões ou as
  ferramentas autorizadas para a Task.

## Questões pendentes

- formato e diretório canônicos dentro de `.atlas/`;
- resolução de versões e compatibilidade;
- precedência entre instruções do papel, persona, skill, projeto e Task;
- modelo de RBAC para anexar, publicar e desativar skills;
- política de confiança para skills externas ou provenientes de marketplace;
- vínculo entre versão da skill, parecer emitido e AuditEvent.

## Consequências

- reduz proliferação de papéis quase idênticos;
- permite reutilizar capacidades entre agentes e times;
- exige validação de contrato, versionamento e rastreabilidade da composição
  efetiva usada em cada execução;
- aumenta a superfície de supply chain e exige origem/confiança explícitas;
- não autoriza implementação antecipada;
- a decisão final e o detalhamento ocorrerão quando o roadmap correspondente for
  autorizado.
