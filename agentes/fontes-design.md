# Fontes do agente de Design e Conteúdo

Consulta em 03/10/2026, somente leitura. Os seis projetos abaixo aparecem na lista autenticada de estrelas em `/workspace/github-starred/starred-authenticated.ndjson`; seus READMEs foram obtidos diretamente de `raw.githubusercontent.com`. A lista de estrelas serviu para selecionar os projetos, não para comprovar capacidades locais. As URLs apontam para branches que podem mudar.

## 1. Impeccable — pbakaus/impeccable

- [README consultado](https://github.com/pbakaus/impeccable/blob/main/README.md) · [conteúdo bruto](https://raw.githubusercontent.com/pbakaus/impeccable/main/README.md)
- **O que foi lido:** apresentação, comandos de `init`, `shape`, `critique`, `audit`, `polish`, `harden`, orientação de design e instalação. O README distingue contexto do produto em `PRODUCT.md` da direção visual em `DESIGN.md`.
- **Aplicação concreta:** começar pela finalidade e pelo público, organizar hierarquia antes de polir e revisar interface por clareza, acessibilidade e responsividade. Um site do Teimosia Literária pode aplicar essa sequência sem depender de um novo plugin.
- **Limite:** os comandos e detectores descritos pertencem ao projeto; não foram instalados ou executados. Preferências estéticas do README, como evitar certas fontes, são heurísticas desse projeto e não regras absolutas deste perfil. O perfil não replica hooks nem altera a configuração do usuário.

## 2. OpenDesign — nexu-io/open-design

- [README consultado](https://github.com/nexu-io/open-design/blob/main/README.md) · [conteúdo bruto](https://raw.githubusercontent.com/nexu-io/open-design/main/README.md)
- **O que foi lido:** “What is OpenDesign”, “Why OpenDesign”, fluxo do brief ao artefato, integração com agentes, skills/templates, design systems e licença.
- **Aplicação concreta:** reunir referências e decisões de marca em um contrato de design, produzir arquivos reais e melhorar o mesmo artefato com feedback. Serve para manter capas, página do podcast e peças sociais coerentes, e para documentar uma identidade distinta em outros produtos.
- **Limite:** o README anuncia aplicativo, MCP, exportações e providers configuráveis; nenhum desses serviços foi instalado ou chamado. Funcionalidades descritas dependem da instalação, do provedor e das entradas apropriadas. O projeto informa Apache-2.0, com licenças próprias para alguns componentes; isso não autoriza presumir a mesma licença para todos os assets.

## 3. Remotion — remotion-dev/remotion

- [README consultado](https://github.com/remotion-dev/remotion/blob/main/README.md) · [conteúdo bruto](https://raw.githubusercontent.com/remotion-dev/remotion/main/README.md)
- **O que foi lido:** README completo, incluindo criação de vídeo com React, automação, renderização em lote, links de legendas/renderização e aviso de licença.
- **Aplicação concreta:** opção para vinhetas, audiogramas e vídeos de episódios com títulos e legendas substituíveis; templates podem permitir novas versões a partir dos dados de cada episódio.
- **Limite:** possuir Node.js não significa possuir Remotion. A pesquisa não gerou nem renderizou um vídeo. O README remete a documentação para detalhes operacionais e avisa que uma licença empresarial pode ser exigida em alguns casos; conferir a condição aplicável antes de adotar o projeto.

## 4. FFmpeg — FFmpeg/FFmpeg

- [README consultado](https://github.com/FFmpeg/FFmpeg/blob/master/README.md) · [conteúdo bruto](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/README.md)
- **O que foi lido:** README completo, com bibliotecas, filtros, ferramentas `ffmpeg`, `ffprobe`, documentação e licença.
- **Aplicação concreta:** inspecionar gravações com ffprobe; usar FFmpeg para preparar áudio, recortar trechos, montar exportações e converter formatos nos trabalhos do podcast.
- **Limite:** `ffmpeg` e `ffprobe` foram encontrados em `/usr/bin`, mas não se executou o projeto ou os binários nesta análise. Não foram verificados codecs, filtros, versão ou desempenho. O README apresenta a família de recursos; parâmetros concretos devem ser conferidos na documentação e na instalação real. A licença varia conforme componentes LGPL/GPL habilitados.

## 5. Whisper — openai/whisper

- [README consultado](https://github.com/openai/whisper/blob/main/README.md) · [conteúdo bruto](https://raw.githubusercontent.com/openai/whisper/main/README.md)
- **O que foi lido:** finalidade, abordagem, setup, tabela de modelos, variação de desempenho por idioma, comandos de transcrição/tradução e licença.
- **Aplicação concreta:** produzir uma primeira transcrição dos episódios para revisão, legendas, capítulos, descrições e seleção de cortes. Planejar revisão de nomes literários e falas com ruído.
- **Limite:** não havia CLI `whisper` nem módulo Python `whisper` na consulta. O projeto depende de pacotes, FFmpeg, download de modelos e recursos de máquina. O README informa que velocidade e qualidade dependem de idioma e hardware. A tradução documentada é para inglês; `turbo` não é treinado para essa tarefa. Não presumir identificação de pessoas ou transcrição perfeita. O README informa MIT para código e pesos.

## 6. Voicebox — jamiepine/voicebox

- [README consultado](https://github.com/jamiepine/voicebox/blob/main/README.md) · [conteúdo bruto](https://raw.githubusercontent.com/jamiepine/voicebox/main/README.md)
- **O que foi lido:** visão geral, download, engines de voz, “Stories Editor”, “Speech-to-Text”, exemplos de API e integração MCP, roadmap e licença.
- **Aplicação concreta:** opção futura para organizar narrações, versões de fala e uma timeline com múltiplas faixas. Pode apoiar rascunhos de áudio quando a tarefa pedir síntese; as gravações reais do podcast continuam como fonte editorial.
- **Limite:** aplicação, serviço, modelos e MCP não foram instalados ou acionados. Recursos e idiomas variam entre engines; testar português com o engine selecionado antes de prometer qualidade. O README registra que binários Linux prontos ainda não estão disponíveis e inclui recursos planejados no roadmap, que não devem ser tratados como implementados. A licença MIT declarada do aplicativo não dispensa conferir as condições dos modelos.

## Verificação local e escopo

Foi feita apenas detecção de executáveis no PATH e de presença do módulo Python, sem executar esses projetos. Encontrados: FFmpeg, ffprobe, Node.js e npm. Não encontrados: CLI e módulo Whisper. A sessão anuncia `image_gen.imagegen`, `view_image` e conectores Adobe; presença de uma ferramenta não comprova que toda integração ou formato funcionará para um futuro pedido.

O uso obrigatório de `image_gen.imagegen` para criar/editar imagens vem das instruções da ferramenta desta sessão, não destes READMEs. A identidade inicial do Teimosia Literária vem das imagens anexadas pelo usuário. O projeto `zarazhangrui/frontend-slides` também consta entre as estrelas, mas seu README não foi usado como fonte deste perfil; a seleção ficou nos seis projetos acima.

Nenhum projeto foi instalado, clonado ou executado nesta análise. Não houve geração de mídia, envio de mensagens, publicação, mudança em GitHub ou edição de configurações compartilhadas.
