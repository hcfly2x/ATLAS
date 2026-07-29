# Filosofia do Produto

## Princípio arquitetural permanente

O ATLAS é um **sistema operacional para administrar uma empresa de agentes**,
não uma ferramenta para desenvolvedores de IA. A **Dashboard é o produto** e o
ambiente operacional principal; Telegram e outros canais são apenas entrada e
notificação. **Workflow antes de tela**: na dúvida entre uma funcionalidade
técnica e melhorar o fluxo de trabalho do usuário, prioriza-se o fluxo.
Métricas técnicas — CPU, RAM, tokens e traces — vivem em áreas específicas,
nunca na Home. Sem chain-of-thought; sem métricas ou progresso sem metodologia
verificável.

## Princípios complementares

- A mensagem do usuário é intenção, não especificação.
- Nenhuma mensagem bruta vai diretamente ao executor.
- O sistema deve saber quando não usar múltiplos agentes.
- Mais agentes não significa automaticamente melhor decisão.
- O supervisor deve justificar decisões.
- Simplicidade operacional tem prioridade no MVP.
- O usuário mantém autoridade final sobre ações sensíveis.
- Toda autonomia deve ser conquistada progressivamente.
- A autonomia cresce onde o erro é reversível, especialmente em branch isolada
  com testes e revisão por pull request.
- A autonomia permanece restrita onde o efeito é irreversível ou afeta produção,
  dados, pagamentos, tracking, orçamento ou áreas protegidas.
