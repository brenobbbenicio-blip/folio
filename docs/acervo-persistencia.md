# Persistência e recuperação do acervo

## Especificação e escopo (SDD/ESDD)

Base examinada: `3d1aa5c5cb8510eb08b924119184453617baecfc`, ainda HEAD de `main` em 04/10/2026. Não havia correções posteriores. Foram lidos `AGENTS.md`, `AGENTS.project.md`, o perfil de engenharia, as instruções e o código atual. Esta proposta não publica o aplicativo nem altera autenticação, documentos reais ou serviços externos.

Invariantes: uma leitura incompleta nunca autoriza substituir o acervo; um salvamento confirmado inclui todos os PDFs declarados; texto, revisão e histórico permanecem juntos; uma aba desatualizada nunca substitui uma revisão mais recente; exclusão exige confirmação; recuperação exige bytes verificáveis. Todo processamento e armazenamento de documentos continua no navegador.

## Implementação e critérios de aceitação

| Requisito | Implementação / evidência |
| --- | --- |
| Leitura segura | Inicialização e recuperação não disparam gravação. Falha bloqueia alterações; carga v2 com PDF ausente é recusada. |
| Identidade persistente | UUIDs substituem o contador. Migração separa IDs repetidos e remapeia referências unívocas; sinaliza referências ambíguas. |
| Concorrência | IndexedDB v2: comparação de revisão e geração dentro da mesma transação atômica. A escrita obsoleta é recusada, inclusive após exclusão/reset. |
| Preservação em falhas | Nenhuma tentativa de salvar somente texto. Aborto mantém o snapshot anterior e seus PDFs; fila bloqueia novas escritas até resolução. |
| Confirmação verdadeira | PDF ausente impede salvar. “Guardado” somente depois de `transaction.oncomplete`; PDFs previamente guardados podem ser reutilizados. |
| Fechamento rápido | Alterações entram imediatamente na fila; sem debounce de 650 ms. `beforeunload` é apenas aviso, não mecanismo de salvamento. |
| Backup completo | Envelope local `folio-backup`, versão 1, `.folio.json`, PDFs originais em base64, textos, classificações, revisões, histórico, metadados e salvaguarda legada. Manifesto SHA-256 dos estados, textos e PDFs e hash do payload. |
| Restauração | Validação estrutural, limites, versão e hashes antes de prévia; políticas explícitas manter/cópia/substituir por identidade. Substituir conserva documentos sem conflito. Commit atômico com revisão. |
| Exclusão | Confirmação com opção de backup, explicação da ausência de lixeira e do alcance da recuperação. Cancelar preserva os dados. |

A migração mantém uma cópia bruta dos documentos e PDFs legados, inclusive bytes órfãos. Em IDs antigos repetidos, um único PDF sobrevivente não prova a qual texto pertencia: as peças recebem alerta. PDFs já sobrescritos na versão anterior não podem ser reconstruídos. Uma peça legada sem bytes preserva seu texto, recebe alerta e não declara PDF disponível; a salvaguarda mantém o registro original.

Conflitos entre abas não são mesclados silenciosamente. A aba perdedora preserva alterações em memória e permite baixar backup antes de recarregar. Restauração com falha também conserva o material pendente para backup/retry. Não se deve usar uma aba antiga enquanto outra migra o banco.

## Verificação em 04/10/2026

Todos os documentos usados foram fictícios. Resultados detalhados: `docs/acervo-browser-results.json`; suíte reproduzível: `scripts/acervo-browser-tests.mjs`.

| Verificação | Resultado |
| --- | --- |
| TypeScript, 83 testes incluindo identidade, backup e regressões existentes | PASS |
| `npm run typecheck` e `npm run build` | PASS |
| Chromium: 15 cenários de persistência e interface | PASS |
| Importar, revisar, reabrir e importar novo documento; encerrar/reiniciar o processo com perfil persistente | PASS |
| Fechar imediatamente após confirmação de gravação; interface com PDF fictício válido | PASS |
| Falha de abertura, falhas de escrita/quota injetadas, PDF ausente e rollback preservando bytes | PASS |
| Duas abas reais: inclusão e exclusão, recusa de snapshot obsoleto; geração após reset | PASS |
| Perfis isolados, backup, apagar e restaurar perfil novo, estado completo e hashes SHA-256 | PASS |
| Migração com colisões, salvaguarda, vínculos cruzados e corrupção de backup recusada | PASS |
| Interface de prévia, conflitos, cancelamento, backup e confirmação de exclusão; desktop e mobile | PASS |
| Firefox e WebKit | NÃO VERIFICADO: binários indisponíveis |
| Quota fisicamente esgotada, kill do processo durante transação, falha de energia, iOS/Safari real | NÃO VERIFICADO |
| Suíte geral `npm test` | FAIL: 183/197 passam; 14 falhas idênticas no checkout limpo da base, relacionadas a configuração/instruções `.grok` ausentes. Etapa TypeScript executada separadamente: 83/83. |

Para repetir: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run build`, comando TypeScript definido na segunda etapa de `npm test`. Inicie `npm run dev`; em outro terminal na mesma rede execute `npm run test:acervo:browser`. Opcional: `FOLIO_TEST_URL` e `FOLIO_BROWSER_EXECUTABLE`. O harness não instala navegadores e registra os indisponíveis explicitamente.

## Limites e orientação para um acervo existente

Antes de usar esta versão, mantenha os PDFs originais fora do Fólio, exporte os textos da versão atual e preserve o perfil/navegador original. O ZIP antigo não contém PDFs nem todo o estado. Não limpe os dados do site e não use o acervo real para testar esta branch. A proposta está em revisão, sem deployment.

Depois de uma atualização revisada, feche as abas antigas, abra no mesmo perfil e confira alertas de migração. Baixe o backup completo e valide a restauração primeiro num perfil separado. Confira documentos, classificações, revisões, histórico e PDFs, especialmente peças com IDs legados repetidos. Guarde backups datados em mais de um local protegido antes de apagar qualquer cópia.

Sem backup anterior, apagar os dados do site, remover o perfil ou sofrer remoção pelo navegador pode perder o acervo. IndexedDB não é armazenamento permanente garantido. Fechar/derrubar antes da confirmação ainda pode perder alterações pendentes. A opção de durabilidade estrita tem fallback para motores que não a suportam; não equivale a garantia contra falha física.

O backup é integral, mas não criptografado. Hashes detectam corrupção, não autenticam o autor. Limites atuais: 200 MiB por arquivo de backup, 100 MiB por PDF e 10.000 entradas por lista validada. JSON/base64 e cópias de snapshots usam memória adicional; acervos grandes precisam de futura solução em streaming. Isolamento entre perfis é esperado: transferência exige backup/restauração manual. No iPhone, uma folha de compartilhamento não prova que o arquivo foi salvo em Arquivos.
