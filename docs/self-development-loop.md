# Loop de auto-desenvolvimento

## Status e regra de autorização

Este documento registra a direção de arquitetura e sua ordem de avaliação. QA
empírico, provedor independente, reconciliação e a primeira política de
autonomia proporcional foram autorizados em entregas próprias. Qualquer avanço
além desse limite — especialmente liberar resultado crítico com base em evals —
continua sujeito à regra **registrado não equivale a autorizado** e exige ADR e
autorização explícita próprios.

## Meta

Fazer o ATLAS conduzir o próprio desenvolvimento ponta a ponta:

```text
supervisor especifica
→ worker/Codex implementa
→ revisor audita
→ resultado volta para aprovação
```

O dono deve atuar apenas na aprovação de merge e deploy e nas decisões de
negócio ou funcionalidade. O vaivém manual de copiar e colar entre ferramentas
deixa de ser necessário para a execução do fluxo.

Esta meta não altera os gates atuais. Merge e deploy continuam humanos, e
auto-modificação permanece sujeita às proteções existentes.

## Insight crítico: plugar uma API não basta

O valor do revisor não está somente no modelo. Ele depende do modelo mais um
sandbox de execução que rode a entrega do worker:

- instalação com lockfile congelado;
- execução dos testes;
- geração e execução de probes adversariais;
- comparação byte a byte do diff contra a base.

Um revisor que apenas lê o diff reproduz o QA atual, mais fraco, com outro nome.
A peça de maior valor é o **QA empírico**: um revisor que executa a entrega, não
apenas a lê.

## Revisor independente do autor

A regra revisor diferente de quem escreve a Specification permanece e deve se
tornar mais forte. Recomenda-se diversidade de provedor — por exemplo, autor da
Specification em um provedor e revisor empírico em outro — para reduzir pontos
cegos correlacionados.

A API do Claude é candidata ao papel de revisor. Isso é uma direção de
avaliação, não autorização de integração nem escolha definitiva de provedor.
Diversidade de provedor é um avanço sobre o estado atual de provedor único, mas
não elimina todos os riscos de correlação.

## Merge e deploy permanecem humanos

Merge na `main` e deploy em produção permanecem `always_human`. Esses gates são
o backstop que permite avaliar maior automação no restante do fluxo: nada entra
na branch principal nem em produção sem a ação do dono.

Pull requests de alto risco — incluindo enforcement, máquina de estados,
`always_human` e autonomia — recebem revisão humana adicional até que evals
comprovem a confiabilidade do revisor automático. Pull requests de baixo risco
seguem a política proporcional de merge já existente.

## Auto-modificação é a fronteira de maior risco

Quando o ATLAS desenvolve o próprio ATLAS, ele toca sua governança. O risco é
recursivo: um defeito no revisor pode enfraquecer o mecanismo que deveria
detectar esse mesmo defeito.

Por isso, auto-modificação é a última capacidade a receber autonomia, não a
primeira, e permanece sempre atrás do gate humano de merge e deploy.

## Limitação conhecida: perda de olhos externos

Internalizar o revisor reduz a independência oferecida por um sistema totalmente
separado. A diversidade de provedor recupera parte dessa independência, mas não
toda. Essa limitação deve permanecer explícita na avaliação e nos evals.

## Sequência proposta

Esta é uma ordem de dependência, não uma autorização:

1. **QA empírico:** avaliar um revisor que instala, roda testes e ataca casos de
   borda em sandbox, emitindo veredito para a máquina existente de Approval e
   retrabalho.
2. **Provedor Claude para revisão:** disponibilizar o escopo mínimo necessário
   ao papel de revisor, sem antecipar a abstração genérica inteira.
3. **Integração independente:** ligar o QA empírico ao pipeline preservando
   revisor diferente do autor.
4. **Autonomia proporcional:** ajustar autonomia por risco somente conforme os
   evals, mantendo merge e deploy sempre humanos.

A primeira decisão proporcional permanece fechada para risco crítico enquanto
não há baseline versionado de evals. Nenhum item posterior dessa sequência
constitui fase antes de ADR e autorização explícita.
