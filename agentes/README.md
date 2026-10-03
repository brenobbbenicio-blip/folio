# Sua equipe de agentes

Consultei os **127 repositórios com estrela** da conta [brenobbbenicio-blip](https://github.com/brenobbbenicio-blip) com paginação completa na API autenticada do GitHub. A equipe foi organizada para atender desenvolvimento de software, pesquisa e criação, incluindo o podcast **Teimosia Literária**.

Os três agentes foram criados e executados nesta conversa para pesquisar referências e preparar seus perfis. Os documentos abaixo permitem reutilizar suas instruções; os arquivos TOML correspondentes definem agentes personalizados para clientes locais do Codex que carreguem a configuração deste workspace.

## Agentes

| Agente | Responsabilidade | Perfil | Definição Codex |
| --- | --- | --- | --- |
| Engenharia e Automação | Código, sites, APIs, integrações, automações e verificação técnica. | [Perfil](engenharia-automacao.md) | [engenharia_automacao.toml](../.codex/agents/engenharia_automacao.toml) |
| Pesquisa e Documentos | Pesquisa com fontes, leitura de PDFs, OCR, referências e transcrições. | [Perfil](pesquisa-documentos.md) | [pesquisa_documentos.toml](../.codex/agents/pesquisa_documentos.toml) |
| Design e Conteúdo | Identidade visual, materiais do podcast, texto, áudio, vídeo e interfaces. | [Perfil](design-conteudo.md) | [design_conteudo.toml](../.codex/agents/design_conteudo.toml) |

Eu coordeno a divisão do trabalho, integro as entregas e confiro o resultado. Agentes são chamados para tarefas concretas e podem ser reutilizados enquanto a conversa mantiver essas tarefas disponíveis. Os perfis locais conservam as instruções para futuras sessões; não constituem um serviço em execução permanente nem garantem memória entre conversas.

## Como chamar

Você pode pedir em linguagem natural:

- “Use Engenharia e Automação para criar o site do podcast neste repositório.”
- “Use Pesquisa e Documentos para comparar estes livros e citar as páginas relevantes.”
- “Use Design e Conteúdo para preparar uma pauta e a capa do próximo episódio.”
- “Divida entre os três agentes a preparação de um episódio: pesquisa, materiais e organização dos arquivos.”

Em um cliente local compatível do Codex, abra este workspace e peça o agente pelos nomes `engenharia_automacao`, `pesquisa_documentos` ou `design_conteudo`. Quando a interface não aceitar um agente personalizado pelo nome, o perfil em Markdown pode ser fornecido à tarefa de delegação. A política de confiança do cliente pode afetar o carregamento de configurações do projeto; a validação dos arquivos não comprova carregamento em todos os clientes.

## Referências

- [Catálogo completo dos 127 favoritos](repositorios-estrelados.md) e [dados em JSON](repositorios-estrelados.json).
- [Fontes de Engenharia e Automação](fontes-engenharia.md): Superpowers, Compound Engineering, LangGraph, Supabase, Playwright e n8n.
- [Fontes de Pesquisa e Documentos](fontes-pesquisa.md): PyMuPDF, RapidOCR, Trafilatura, PageIndex, LlamaIndex e Whisper.
- [Fontes de Design e Conteúdo](fontes-design.md): Impeccable, OpenDesign, Remotion, FFmpeg, Whisper e Voicebox.
- [Documentação oficial do Codex sobre subagentes](https://developers.openai.com/codex/subagents): arquivos TOML locais com `name`, `description` e `developer_instructions`.

Os READMEs de **17 projetos distintos** foram consultados para orientar os perfis. Ferramentas externas que exigem instalação, credenciais, modelos ou serviços estão identificadas nos registros de fontes. Os agentes usam primeiro as capacidades realmente disponíveis nesta sessão.

## Configuração e verificação

As definições ficam em `.codex/agents/`, sem alterar configurações pessoais ou escolher outro modelo. Cada definição incorpora o perfil correspondente e herda modelo, esforço e políticas da sessão principal.

Foram verificados os campos obrigatórios e a sintaxe TOML, a correspondência entre perfis e definições, os links locais e a cobertura dos 127 repositórios no catálogo. Essa verificação cobre os arquivos preparados; não inclui a execução de bibliotecas dos projetos de referência.
