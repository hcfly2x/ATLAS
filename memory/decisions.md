# Decisões

- O Telegram será a interface principal.
- O coordinator ficará na nuvem; o worker será local, com conexão iniciada de dentro para fora (ADR-002).
- Monorepo TypeScript com pnpm e Turborepo (ADR-001).
- Fila em PostgreSQL com pg-boss; sem Redis no MVP (ADR-005).
- Codex via CLI encapsulado em adapter (ADR-006).
- Worker↔nuvem por long-polling HTTPS com token Bearer rotativo (ADR-007).
- Agentes deliberativos rodam no coordinator, com teto de custo por tarefa (ADR-008).
- Contratos entre componentes validados com Zod (ADR-009).
- Áreas protegidas aplicadas por verificação de diff no worker + CODEOWNERS (ADR-010).
- O MVP usa apenas supervisor; o conselho multiagente entra na Trilha 2 (ADR-003 mantido para a expansão).
- O supervisor toma a decisão final; não decide por maioria simples.
- O worker não reinterpreta a demanda.
- Projetos possuem memória isolada (ADR-004).
- Ações sensíveis exigem aprovação humana.
- O ATLAS pode desenvolver a si próprio sob política restrita.
- FAILED não gera retry automático de execução no MVP; retry é decisão humana.
- O worker rodará em um Mac mini ou MacBook M1 com 8 GB de RAM e macOS Tahoe 26.4, com Codex CLI instalado localmente.
- O worker não rodará Docker nem banco de dados; esses serviços ficam no coordinator em nuvem. Localmente, precisa apenas de Node.js, Git, Codex CLI e dos repositórios dos projetos.
- `docs/implementation-plan.md` é a fonte canônica da numeração e ordem das fases.
- A produção da Specification usa o estado SPECIFYING; o conselho da Trilha 2 delibera internamente antes dessa emissão.
- O fluxo usa FINALIZING para commit/PR e CANCEL_REQUESTED para cancelamento cooperativo.
- Retrabalho funcional cria nova versão imutável de Specification; retry técnico manual cria nova Execution para a mesma versão.
- Toda memória persistente exige `project_id`; contexto global é configuração estática versionada no MVP.
- O contrato usa `authorized_scope`.
- Aprovações são vinculadas ao alvo versionado e aos hashes da Specification/resultado/diff.
- Projetos usam mínimos obrigatórios com defaults explícitos e só podem ser ativados após validação.
- O contrato de resultado do worker faz parte da documentação do Epic 00.
- ADR-011 aceito na opção 1: perfil portátil macOS/ARM64, concorrência 1 e ferramentas GNU somente quando declaradas.
- Coordinator hospedado em Render Web Service persistente, sem hibernação, com PostgreSQL gerenciado; backups gerenciados são suficientes no MVP.
- Runtime deliberativo operacional: OpenAI, GPT-5.6 Terra como padrão e GPT-5.6 Luna para normalização/roteamento; teto agregado de US$ 25/mês.
- Execução Codex possui teto mensal separado de US$ 75 no plano Pro.
- O teto de US$ 75/mês do Codex é um limite lógico rastreado pelo ATLAS; o consumo está incluído na assinatura ChatGPT Pro.
- O teto de US$ 25/mês da deliberação via API OpenAI deve ser configurado também como hard limit no dashboard do provedor.
- Retenção configurável por classificação: default de 30 dias, prazo menor para dados sensíveis; AuditEvent não expira no MVP.
- Epic 00 aceito. A aceitação não autoriza a Fase 1.
- ADR-012 aceito na opção 1: idempotency keys, lease renovável e fencing token.
- O schema da Fase 2 deve incluir colunas de chaves de idempotência, lease e fencing token; essa modelagem não será postergada para a Fase 5.
- A Fase 1 — Foundation mínima foi autorizada explicitamente em 23/07/2026; a Fase 2 exige autorização separada.
- A Fase 1 foi aceita com ressalvas não bloqueadoras; a Fase 2 — Core mínimo do Coordinator foi autorizada explicitamente em 23/07/2026.
- A persistência do Core usa concorrência otimista por `Task.version`; transição de estado e AuditEvent aceito são atômicos.
- AuditEvent é append-only e Specification é imutável também por triggers PostgreSQL.
- PostgreSQL local do ATLAS usa a porta 5433 por padrão, configurável, para evitar colisão com outros projetos; internamente o container permanece na 5432.
- O repositório canônico é o GitHub privado `hcfly2x/ATLAS`; mudanças seguem o
  fluxo de branch + pull request. A proteção obrigatória da `main` permanece
  desejada, mas não está ativa porque o plano atual não permite branch
  protection em repositório privado.
- CI e desenvolvimento usam Node.js >=22.13, requisito do pnpm 11.9.0.
- A Fase 2 foi aceita sem correções de código; a Fase 3 — Telegram MVP foi
  autorizada explicitamente, mas deve partir da `main` após a integração
  sequencial das Fases 1, 2 e da entrega documental `idea-intake`.
- Ideias são capturadas via GitHub Issues com template `idea`, amadurecidas em
  triagem externa e só entram no repositório como escopo de fase ou ADR
  Proposto; nenhuma ideia é implementada fora da fase correspondente.
