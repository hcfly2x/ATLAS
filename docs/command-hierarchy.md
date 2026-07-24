# Hierarquia de comando implementada

## Propósito

O ATLAS transforma uma demanda recebida pelo Telegram em uma especificação
executável, aplica as aprovações exigidas e delega a execução a um worker local.
A deliberação e a execução permanecem separadas.

## Cadeia de comando

```text
Usuário
→ Telegram / Coordinator
→ Conselho selecionado por complexidade
→ Supervisor de Engenharia
→ Aprovação humana, quando exigida
→ Worker local
→ Codex
→ Resultado e testes
→ Aprovação do resultado, quando exigida
→ Telegram
```

O roteamento implementado seleciona:

- demanda simples: Contexto do Projeto e Supervisor;
- demanda moderada: Contexto do Projeto, Arquitetura, Qualidade e Supervisor;
- demanda crítica: Produto, Contexto do Projeto, Arquitetura, Segurança,
  Qualidade e Supervisor.

## Responsabilidades e reporte

- **Usuário:** autoridade humana final para ações sensíveis, incluindo alterações
  em áreas protegidas, merge na `main` e deploy em produção.
- **Agentes especialistas:** emitem pareceres independentes dentro de seu papel.
  Produto cuida de valor e escopo; Contexto verifica memória e decisões;
  Arquitetura avalia componentes e contratos; Segurança avalia permissões e
  riscos; Qualidade define testes e critérios verificáveis. Todos reportam seus
  pareceres ao Supervisor.
- **Supervisor de Engenharia:** identifica divergências materiais, pode solicitar
  uma segunda e última rodada focada, aplica políticas e consolida uma única
  especificação. Não decide por maioria simples e não revisa a própria saída.
- **Worker local:** executa somente a especificação validada, em worktree
  isolada, usando comandos permitidos. Não redefine escopo ou arquitetura e não
  pode fazer merge ou deploy.
- **Codex:** executa sob o controle do worker; não recebe autoridade própria para
  alterar o escopo.

## Escalonamento principal

Complexidade maior amplia o conselho consultado. Divergências materiais retornam
aos especialistas em no máximo uma segunda rodada. Ações classificadas como
críticas ou `always_human` são escaladas para aprovação do usuário. Resultado
com alteração protegida também exige a aprovação aplicável antes da finalização.

## Ressalvas críticas

- A Fase 7 está implementada; a Fase 8 não está autorizada.
- O nível de autonomia não elimina as ações `always_human`.
- O Telegram é o canal operacional, mas este documento não configura integração
  nem autoriza publicação.

## Fontes oficiais

- `docs/master-implementation-specification.md`
- `docs/architecture.md`
- `.atlas/agents.yaml`
- `.atlas/routing.yaml`
- `.atlas/policies.yaml`
- `agents/engineering/*.md`
- `memory/current-state.md`
