# ADR-021 — Provedor Claude para o revisor pós-execução

## Status

Proposto.

## Contexto

O `AgentRuntime` já separa os agentes do SDK do provedor, mas o runtime
operacional usa OpenAI tanto para o supervisor quanto para o revisor
pós-execução. Os papéis são distintos, porém continuam sujeitos a pontos cegos
correlacionados do mesmo provedor. O QA empírico v1 já fornece evidência
executada ao revisor; falta permitir diversidade de provedor nesse único papel
sem antecipar uma abstração genérica ou alterar a autoridade do QA.

## Proposta

- a configuração `ATLAS_POST_EXECUTION_REVIEWER_PROVIDER` seleciona
  `openai|claude` somente para o `PostExecutionQaService`;
- ausência da configuração preserva o runtime OpenAI atual;
- seleção explícita de Claude exige `ANTHROPIC_API_KEY` no ambiente do
  coordinator e usa Claude Sonnet 5;
- o adaptador chama exclusivamente `https://api.anthropic.com/v1/messages`,
  com saída JSON estruturada, e valida novamente o resultado pelo schema Zod
  recebido pelo `AgentRuntime`;
- timeout, erro de transporte, resposta HTTP não bem-sucedida, recusa,
  truncamento, modelo divergente ou payload inválido retornam apenas códigos
  seguros e seguem o caminho existente de QA indisponível;
- prompts, respostas, corpo de erro remoto e chave não entram em log,
  AuditEvent, evidência empírica ou persistência;
- o supervisor, normalizador, roteador e conselho continuam no runtime OpenAI.

O custo estimado do modelo usa o preço público padrão, de forma conservadora
quando houver preço promocional temporário. Modelo e preço devem ser revistos
em entrega própria quando o provedor alterar sua tabela ou ciclo de vida.

## Consequências

- autor e revisor podem operar em provedores distintos sem mudar a máquina de
  estados, Approval ou `always_human`;
- uma configuração explícita incompleta falha no startup, em vez de cair
  silenciosamente para outro provedor;
- indisponibilidade do Claude nunca aprova, finaliza, faz merge ou deploy;
- esta decisão não cria abstração genérica de provedores e não autoriza Claude
  para qualquer outro agente;
- a confiabilidade e o custo da diversidade devem ser medidos por evals antes
  de qualquer ampliação de autonomia.
