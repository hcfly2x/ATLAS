# Análise de Lacunas — Organização Autônoma do ATLAS

## Estrutura-alvo

O objetivo de longo prazo é uma organização de agentes em que a pessoa usuária
aprova apenas o que é crítico ou irreversível e o ATLAS conduz o ciclo até a
entrega:

```text
usuário → conselheiros → decisão → diretor/distribuidor → times → especialistas
        → controle de qualidade pós-execução → entrega final
```

Esse objetivo não autoriza expansão de autonomia nesta entrega. A ordem de
evolução é deliberadamente: estabilizar runtime e recuperação, introduzir QA
pós-execução, e só então avaliar maior autonomia.

## Mapeamento estrutural

| Elemento da estrutura-alvo | Equivalente existente | Situação |
| --- | --- | --- |
| Usuário | Telegram, aprovações versionadas e ações `always_human` | Existe. A política de autonomia do ADR-014 proposto define quando a intervenção humana é exigida. |
| Conselheiros | Conselho multiagente da Fase 7, com pareceres independentes e no máximo duas rodadas | Existe. |
| Decisão | Supervisor consolida pareceres e emite a `Specification` imutável | Existe. |
| Diretor/distribuidor | Supervisor, roteamento canônico por complexidade e fila/worker | Existe. Não criar um segundo diretor. |
| Times | `engineering_council` em `.atlas/agents.yaml` e roteamento em `.atlas/routing.yaml` | Existe para engenharia. Times permanentes de marketing e financeiro não entram agora. |
| Especialistas | Papéis do conselho e especialistas temporários chamados pelo roteamento | Existe como capacidade operacional. Novas competências devem entrar como skills anexáveis, conforme ADR-016 proposto, e não como proliferação de papéis permanentes. Personas continuam proposta do ADR-017. |
| QA antes da execução | Parecer do papel `qa` no conselho | Existe, mas avalia a demanda e a Specification antes da execução. |
| QA pós-execução | Nenhum componente | **Única peça estrutural ausente.** Deve revisar o resultado do worker antes de considerar o ciclo confiável para ampliar autonomia. O revisor segue a regra do Epic 07: não pode ser quem emitiu a Specification e pode usar modelo distinto do supervisor. |
| Entrega final | Publicação de progresso Telegram existente; entrega do resultado ao autor está no PR #20, ainda pendente de integração | Cobertura em conclusão, não uma nova camada arquitetural. O destino deriva exclusivamente da origem da Task. |

## Lacunas de estabilização, não de estrutura

Os demais gaps não justificam entidades novas. Devem estender os mecanismos já
existentes e ser tratados nos blocos de estabilização planejados:

- **Bloco 1 — bloqueios do piloto:** supervisor, worker e adapter já possuem
  correções pós-piloto em integração; a base permanece o fluxo atual, não um
  novo orquestrador.
- **Bloco 2 — runtime reproduzível por projeto:** implementação em revisão no
  PR próprio. O contrato `Project.runtime` declara bootstrap, validate, timeout,
  allowlist e negações duras; ele estende a allowlist e o executor existentes,
  sem criar executor paralelo. A conclusão ainda exige validação em worktree
  limpa de um projeto real configurado.
- **Bloco 3 — recuperação durável:** implementação em revisão no PR próprio;
  estende idempotência, leases, fencing e reconciliação do ADR-012 para Tasks
  `NEW` e Execuções com lease expirado. O backoff do worker já cobre
  indisponibilidade transitória. Não cria dead-letter separado.
- **Enforcement determinístico:** estender a allowlist do worker e a checagem de
  paths protegidos do ADR-010, que já formam a base do futuro Policy Engine/Tool
  Gateway. Não duplicar essas fronteiras.
- **Observabilidade:** estender `AuditEvent` com `correlation_id`, logs e o
  dashboard somente-leitura, que já são a base do Atlas Trace. Não criar uma
  trilha paralela.
- **Evals:** usar os contratos Zod, resultados persistidos e auditoria para
  medições reprodutíveis antes de alterar políticas ou autonomia.

Toda fase dessa sequência só poderá criar nova entidade quando esta análise
demonstrar que não existe equivalente extensível.
