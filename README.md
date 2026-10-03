# Folio

Leitura de PDF e Markdown no navegador, com acervo classificado de atos eleitorais.

A conversão, a classificação e os modelos rodam no cliente. O arquivo não é enviado. A classificação é regra local: não é código do PJe e não é análise jurídica. Norma citada no texto não é conferida em fonte oficial, e o modelo histórico não é reescrito sozinho.

## Uso

```bash
npm install
npm run dev
```

O servidor de desenvolvimento escuta na porta 8080.

- **Converter** — um ou mais PDF ou Markdown. Os exemplos fictícios servem para conferir a classificação.
- **Conferir extração** — páginas, pedido de OCR, cabeçalho removido e campos preservados à parte.
- **Classificar** — busca, filtros combinados, correção de campos, unir e dividir atos, com desfazer.
- **Modelos** — fonte e modelo lado a lado. A página do PDF aparece enquanto o arquivo está nesta sessão.
- **Melhorias** — tabela editorial e jurídica. A adequação normativa fica pendente.
- **Exportar ZIP** — fontes fiel e de leitura, um modelo por ato, índices CSV e JSON, relatórios de melhorias e de lacunas.

O caderno do DJE/TRE-PA 2026 n. 223 está em `public/cadernos/` e abre pelo botão na capa. Ele não passa pelo classificador do acervo.

## Testes

```bash
npm test
npm run typecheck
```

## Limites

Não há OCR, classificação por IA nem taxonomia oficial do PJe. O acervo aberto na sessão só permanece se for exportado em ZIP.
