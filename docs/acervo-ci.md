# CI de persistência do Fólio

## Escopo

O workflow `.github/workflows/acervo-persistencia.yml` executa em pull requests
para `main`, pushes em `main` e acionamento manual. A base revisada foi o merge
da PR #1 (`ec2dce8`); não existia outro workflow de CI nem PR aberta concorrente.

Um runner Ubuntu 24.04 com Node 22 instala o lockfile usando `npm ci` e os
executáveis e dependências de **Chromium, Firefox e WebKit** usando a versão
de Playwright já registrada no projeto:

```sh
npx --no-install playwright install --with-deps chromium firefox webkit
```

A instalação segue a [documentação oficial de CI do Playwright](https://playwright.dev/docs/ci).
O job tem permissão somente de leitura do repositório, não usa segredos e
inicia o aplicativo localmente com `npm run dev`. Não acessa acervos reais,
Drive, contas pessoais ou bancos externos. `VITE_AUTH_ENABLED=false` vale
somente no ambiente de teste e não altera a configuração de produção.

## Critérios de aprovação

1. `npm run typecheck`, os testes TypeScript em `src/lib/acervo/*.test.ts` e os
   testes do executor em `scripts/acervo-browser-tests.test.mjs` passam.
2. O servidor responde em até 60 segundos; saída precoce ou timeout falham o job.
3. Os **15 cenários completos existentes** executam em cada motor: 45 resultados
   esperados quando os três motores iniciam normalmente. O teste simples de
   IndexedDB antes reservado a Firefox/WebKit foi incorporado à cobertura
   completa de gravação, bytes, reabertura, falhas, concorrência e restauração.
4. Qualquer cenário `FAIL`, erro de inicialização ou browser obrigatório
   ausente produz código de saída 1. Não há `continue-on-error`, retry que
   apague falhas, nem conversão de ausência obrigatória em aprovação.

O job mantém o script `test:acervo:browser` e os testes atuais. Não usa a suíte
geral `npm test` como gate desta camada: a análise anterior registrou 14 falhas
em testes de infraestrutura `.grok` ausente no checkout. Esses testes continuam
no projeto; este workflow cobre persistência e não declara que a suíte geral passou.

## Evidências por execução

O artefato `acervo-persistencia-<run_id>-<run_attempt>` é retido por **30 dias** e
o upload usa `if: always()`, inclusive quando a suíte falha. Inclui:

- `docs/acervo-browser-results.json`, com horário, motor, cenário, status,
  evidência/erro, indicação de dados fictícios, SHA do commit e ID da execução;
- logs do servidor e da suíte;
- screenshots de desktop e viewport móvel separados por motor, quando produzidos.

O relatório histórico versionado é removido do checkout do CI antes da
instalação. Assim ele não pode ser apresentado como prova de uma execução
nova. O harness cria um relatório novo antes de iniciar os motores e o
atualiza após cada resultado. `completed=false` identifica uma execução
interrompida; `completed=true` significa que o executor terminou, **não que
todos os testes passaram**: é preciso examinar os status.

Se o job falhar antes de chamar o harness (instalação, verificações ou servidor),
não haverá JSON de testes dessa execução. Consulte os logs do Actions e os
logs disponíveis no artefato; a ausência de relatório não significa aprovação.
O workflow não faz commits automáticos de relatórios nem altera `main`.

## Repetição local

Em ambiente compatível com Playwright, instale as dependências e browsers:

```sh
npm ci
npx --no-install playwright install --with-deps chromium firefox webkit
npm run dev
```

Com o servidor em execução, em outra sessão:

```sh
CI=true FOLIO_TEST_BROWSERS=chromium,firefox,webkit FOLIO_REQUIRED_BROWSERS=chromium,firefox,webkit npm run test:acervo:browser
```

`FOLIO_TEST_BROWSERS` seleciona motores; `FOLIO_REQUIRED_BROWSERS` define os
obrigatórios. Listas vazias, nomes desconhecidos ou obrigatórios fora da
seleção falham. Sem configuração explícita, a execução local seleciona os
três motores e exige Chromium; Firefox/WebKit ausentes ficam `NÃO VERIFICADO`.
Com `CI=true`, Chromium e WebKit são obrigatórios por padrão; o workflow
exige também Firefox explicitamente. Um motor disponível que falha ao iniciar
ou em um cenário sempre produz `FAIL`, mesmo quando opcional.

`FOLIO_TEST_URL` define a origem de teste; `FOLIO_BROWSER_EXECUTABLE` continua
permitindo um executável alternativo **somente para Chromium**. Use apenas
origens e perfis de teste. Cada cenário usa contextos isolados; a reabertura de
processo usa um diretório temporário próprio, removido ao final.

## WebKit não valida Safari/iPhone real

**Passar em WebKit automatizado no Linux não equivale a validar Safari, iOS
ou um iPhone real.** O engine do Playwright e uma viewport de 390 × 844 são
evidências de execução automatizada e layout, não de comportamento do sistema
Apple. Downloads/Arquivos, folha de compartilhamento, suspensão do aplicativo,
descarte de armazenamento, quotas físicas e diferenças de versão precisam de
validação separada em dispositivo Apple. Não marque Safari/iPhone como PASS
com base neste workflow.

Também permanecem fora desta suíte falha de energia, kill durante transação e
esgotamento físico de quota: os testes de erro de quota usam falhas injetadas.

## Validação na preparação desta mudança

| Check | Resultado |
| --- | --- |
| 83 testes TypeScript já existentes, executados separadamente | PASS |
| 7 testes novos do executor (ausência, configuração, inicialização e falhas de cenários) | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| 45 cenários em browsers reais neste ambiente | NÃO VERIFICADO |

O ambiente de preparação não permitiu instalar dependências de sistema; o
download dos binários retornou arquivos incompletos. A inicialização do
servidor também falhou com `uv_interface_addresses`. Os testes do executor
usaram um módulo Playwright fictício para verificar saída/relatório em falhas;
não são evidência de aprovação dos engines reais. O primeiro run do GitHub
Actions deve confirmar a execução completa antes de integrar a mudança.
