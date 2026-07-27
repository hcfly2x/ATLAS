# Amostra real — shadow de paths protegidos

## Escopo

Amostra operacional coletada em staging depois do merge do PR #35, com o
coordinator saudável e o worker local executando a `main` integrada. O registro
contém somente identificadores, decisões e hashes já emitidos pelo log
estruturado; nenhuma mensagem de usuário, diff, credencial ou conteúdo de
arquivo foi copiado.

## Execução observada

- Task: `9b04c71e-5930-430d-a9e3-ba6b8b48f986`
- Execution: `116cc41e-4afc-4499-be03-f14872587225`
- estado terminal: `COMPLETED`
- tentativas: `1`
- decisão legada: `allow`
- decisão determinística: `allow`
- divergência: `none`
- código de motivo: `allowed`
- input hash:
  `sha256:726433fc39e9adedf43c1f7387c507ade926e3e0efe428432efa8a5fd76b71e2`
- decision hash:
  `sha256:cf37ce2400c4044166833d4871d35f469a7148b809328124dde5f02ade056ade`

O AuditEvent da mesma Task confirma QA pós-execução concluído, finalização da
Execution e entrega terminal Telegram. Não houve perda de lease, falha,
reexecução ou `MORE_PERMISSIVE`.

## Conclusão limitada

Esta amostra satisfaz o gate definido para iniciar a entrega própria de cutover:
uma execução real versionada sem divergência mais permissiva. O corpus
adversarial continua obrigatório e o fallback legado permanece durante a
revisão completa. A amostra não autoriza caller de comandos, AuditEvent,
alteração de autonomia, Fase 8, merge ou deploy.
