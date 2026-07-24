# Pilot Setup Wizard — Resumo de entrega

## O que foi implementado

- Interface local em `/setup` para listar, criar, editar, validar e salvar
  projetos em `.atlas/projects.yaml`.
- Servidor independente `pnpm pilot`, sem inicializar Prisma, Telegram,
  supervisor ou worker.
- Validação canônica de ativação e gravação atômica com preservação de campos
  desconhecidos.
- Allowlist visual estruturada em executável e argumentos, compatível com o
  contrato do worker.
- Fronteira HTTP limitada ao loopback; escritas exigem o header de intenção
  enviado pela própria interface.
- Comando `pnpm coordinator:local` para carregar o `.env.local` já ignorado pelo
  Git quando o piloto completo for iniciado.

## Como validar

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm pilot
```

Com o último comando ativo, abrir
[http://localhost:3000/setup](http://localhost:3000/setup), selecionar um projeto
e usar **Validar ativação**. Salvar altera somente
`.atlas/projects.yaml`; revise o diff antes de commitar.

## Testes adicionados

- defaults aplicados em memória sem alterar o arquivo;
- recusa de projeto ativo incompleto;
- gravação atômica de projeto válido e preservação de extensões;
- cabeçalhos de segurança e carregamento da página;
- leitura da configuração e exigência de intenção explícita para escrita;
- recusa de acesso fora do loopback.

## Riscos e limites

- O wizard não testa acesso remoto ao repositório nem executa os comandos
  permitidos; esses checks continuam no preflight do worker.
- A interface não administra Telegram, credenciais, agentes, times, Tasks,
  approvals ou memória.
- A gravação local deixa o arquivo protegido modificado no working tree; revisão
  humana por `git diff` continua obrigatória.
- Não há deploy, staging, dashboard nem autorização da Fase 6 nesta entrega.

## Memória atualizada

- `memory/decisions.md`: fronteira local e fonte de verdade preservada.
- `memory/todos.md`: checklist de ativação e seed.
- `memory/changelog.md`: versão documental 0.0.9.
- `memory/current-state.md`: entrega pendente de revisão, Fase 6 não autorizada.

## Próximo passo

Revisar o PR. Após merge autorizado, abrir o wizard no checkout principal,
configurar o primeiro projeto, revisar o diff, aplicar migrações/seed e executar
uma tarefa pequena pelo Telegram. Parar antes de qualquer Fase 6.
