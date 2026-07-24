# Master Implementation Specification

## 1. Visão

O ATLAS é uma plataforma pessoal de coordenação de agentes. Sua função é receber demandas pelo Telegram, compreender o projeto e o contexto, reunir pareceres de agentes especializados, produzir uma decisão consolidada e encaminhar uma especificação executável para um worker local que utiliza o Codex.

O ATLAS não é apenas um chatbot, nem apenas um gerador de prompts. Ele deve atuar como uma camada de gestão técnica, memória, segurança, auditoria e automação.

## 2. Missão

Permitir que o usuário desenvolva e opere projetos de software com maior autonomia, qualidade e consistência, usando o Telegram como interface principal e mantendo aprovação humana nas ações sensíveis.

## 3. Princípios

- Arquitetura antes de implementação.
- Implementação incremental.
- Código sempre compilando.
- Separação entre deliberação e execução.
- Memória isolada por projeto.
- Segurança por padrão.
- Auditabilidade.
- Autonomia progressiva.
- Menor privilégio.
- Toda decisão relevante deve ser explicável.

## 4. Tipos de agentes

### 4.1 Agentes de desenvolvimento

Responsáveis por analisar e planejar alterações de software.

Conselho inicial (canônico, ver `.atlas/agents.yaml`):
- Produto.
- Contexto do projeto.
- Arquitetura.
- Segurança.
- Qualidade.
- Supervisor técnico.

Papéis futuros, registrados somente quando necessários: Backend, Frontend, Dados, DevOps.

Nota MVP: na Trilha 1 do plano, apenas normalização + supervisor operam; o conselho completo entra na Trilha 2.

### 4.2 Agentes operacionais

Responsáveis por operar processos de negócio em sistemas já publicados.

Exemplos futuros:
- Classificador financeiro.
- Estrategista de marketing.
- Pesquisador de conteúdo.
- Criador de conteúdo.
- Revisor de marca.
- Agendador de publicações.
- Analista de dados.
- Gestor de Meta Ads.
- Gestor de Google Ads.
- Supervisor de marketing.

Agentes operacionais não devem possuir acesso irrestrito ao ambiente de desenvolvimento.

## 5. Fluxo principal

Telegram
→ Gateway
→ Agente de entrada
→ Roteador de complexidade
→ Conselho de agentes (Trilha 2; no MVP, apenas supervisor)
→ Supervisor
→ Aprovação humana quando necessária
→ Fila
→ Worker local
→ Codex Adapter
→ Codex
→ Git worktree
→ Testes
→ Resultado
→ Telegram

## 6. Deliberação multiagente

A deliberação deve ser estruturada.

### Rodada 1 — parecer independente

Cada agente recebe:
- demanda normalizada;
- contexto relevante;
- memória do projeto;
- escopo permitido;
- restrições.

Cada agente retorna:
- entendimento;
- achados;
- riscos;
- recomendação;
- critérios de aceite;
- confiança;
- questões relevantes.

### Rodada 2 — divergências

O supervisor identifica apenas conflitos materiais e solicita revisão direcionada.

Máximo de duas rodadas, salvo autorização explícita.

### Decisão final

O supervisor:
- resolve divergências;
- elimina escopo desnecessário;
- define estratégia;
- aplica políticas;
- decide se precisa de aprovação humana;
- gera uma única especificação executável.

O supervisor não decide por maioria simples.

## 7. Roteamento por complexidade

### Nível 1 — simples
Entrada + contexto + supervisor.

### Nível 2 — moderado
Entrada + contexto + arquitetura + qualidade + supervisor.

### Nível 3 — crítico
Produto + contexto + arquitetura + segurança + qualidade + especialistas adicionais + supervisor.

Demandas críticas incluem:
- autenticação;
- pagamentos;
- banco de dados;
- produção;
- migração;
- infraestrutura;
- exclusão de dados;
- aumento de gastos;
- alteração de tracking;
- autoalteração do ATLAS.

## 8. Worker local

O worker:
- recebe uma especificação final;
- cria worktree e branch;
- executa Codex;
- roda comandos permitidos;
- transmite progresso;
- roda testes;
- retorna logs e resumo.

O worker não pode:
- ampliar escopo;
- alterar arquitetura por conta própria;
- executar deploy;
- fazer merge;
- acessar secrets não autorizados;
- executar comandos destrutivos sem aprovação.

## 9. Projetos iniciais

### 9.1 Conciliador financeiro pessoal

Importação de extratos e faturas PF, classificação de centros de custo e análise interna.

Classificação: alta sensibilidade.

Políticas:
- logs sem dados bancários completos;
- arquivos protegidos;
- retenção configurável;
- nenhuma alteração retroativa silenciosa;
- auditoria de classificações;
- revisão humana de regras novas.

### 9.2 Plataforma de curso online

Site próprio integrado ao Mercado Pago e ferramentas de marketing e rastreamento.

Integrações previstas:
- Mercado Pago;
- Meta Pixel;
- Google Tag Manager;
- Google Analytics;
- eventos de conversão;
- e-mail e automação futura.

Alterações em checkout, preço, pagamento, webhook ou tracking são críticas.

### 9.3 ATLAS

O ATLAS pode desenvolver a si próprio, mas áreas protegidas exigem revisão e aprovação.

Áreas protegidas:
- autenticação;
- permissões;
- políticas;
- secrets;
- supervisor;
- worker;
- auditoria;
- isolamento;
- comandos permitidos.

Política: `SELF_MODIFICATION_RESTRICTED`.

### 9.4 Autonomia por projeto

Os níveis 0–4 valem para qualquer projeto, não apenas para marketing:

0. **observação** — somente análise;
1. **recomendação** — aprovação prévia e de resultado;
2. **autonomia limitada** — tarefas simples e moderadas podem executar em branch
   isolada e abrir pull request automaticamente quando testes passam e nenhum
   path protegido é tocado; merge permanece humano;
3. **autonomia supervisionada** — inclui tarefas críticas sem aprovação prévia e
   retry automático apenas de falha técnica segura, com fencing token;
4. **reservado** — não habilitado no MVP e dependente de decisão futura.

O nível padrão decidido é 2 para todos os projetos. As ações `always_human`
permanecem humanas em qualquer nível. O detalhamento e o enforcement futuro estão
registrados no ADR-014 proposto.

O time multiagente de marketing permanece um projeto futuro separado, construído
pelo ATLAS, com agentes de estratégia, pesquisa, conteúdo, revisão, publicação,
dados, analytics, Meta Ads, Google Ads e supervisão de marketing. Seus gastos
continuam sujeitos a tetos e às ações `always_human`.

## 10. Processo obrigatório de implementação

`docs/implementation-plan.md` é a fonte canônica para a numeração, ordem e separação das fases em duas trilhas.

Toda fase segue o ciclo:

planejamento → implementação incremental → testes → documentação → resumo → aprovação.

O trabalho deve parar ao final de cada entrega. Hardening ocorre na fase definida pelo plano e não inclui novas features.

## 11. Definition of Done

Uma entrega só termina quando:
- implementada;
- compilando;
- lint aprovado;
- testes passando;
- documentação atualizada;
- memória atualizada;
- resumo técnico produzido;
- riscos registrados;
- sem regressões conhecidas.
