import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfToMarkdown } from "../src/lib/pdf-to-md.ts";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;

const src =
  "/workspace/attachments/blob-https-:dje-consulta.tse.jus.br:20dd5422-2023-4ff7-a716-82f84d2c8846.pdf";
const data = new Uint8Array(readFileSync(src));
const t0 = Date.now();
let last = 0;
const result = await pdfToMarkdown(
  data,
  {
    inferHeadings: true,
    reflow: true,
    stripChrome: true,
    dehyphenate: true,
    includeOutline: false,
    frontMatter: false,
    pageMarker: "comment",
    pageRange: "",
  },
  {
    onPage: (page, total) => {
      if (page === 1 || page === total || page - last >= 40) {
        console.error(`${page}/${total} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        last = page;
      }
    },
  },
);

const body = result.markdown.trim() + "\n";
const banner = `---
title: "Diário da Justiça Eletrônico do TRE-PA"
edition: "Ano 2026, nº 223"
disponibilizacao: "2026-10-01"
publicacao: "2026-10-02"
pages: ${result.pageCount}
source: "PDF oficial do DJE/TRE-PA, edição 223. Camada de texto do arquivo. Sem OCR e sem resumo."
---

# DJE/TRE-PA · Ano 2026, nº 223

Disponibilizado em quinta-feira, 1º de outubro de 2026. Publicação dos atos em 02/10/2026.

`;

mkdirSync("public/cadernos", { recursive: true });
writeFileSync("public/cadernos/dje-tre-pa-2026-n223.md", banner + body);

const chunks = body.split(/<!--\s*página\s+(\d+)(?:\s*·[^>]*)?\s*-->/);
const pages = [];
for (let i = 1; i < chunks.length; i += 2) {
  pages.push({ page: Number(chunks[i]), text: (chunks[i + 1] ?? "").trim() });
}

const cnjRe = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
const byCnj = new Map();
for (const page of pages) {
  const found = page.text.match(cnjRe) ?? [];
  for (const cnj of new Set(found)) {
    let rec = byCnj.get(cnj);
    if (!rec) {
      rec = { cnj, pages: [] };
      byCnj.set(cnj, rec);
    }
    rec.pages.push(page.page);
  }
}
const processes = [...byCnj.values()].sort(
  (a, b) => a.pages[0] - b.pages[0] || a.cnj.localeCompare(b.cnj),
);

const caderno = {
  tribunal: "Tribunal Regional Eleitoral do Pará",
  edition: "Ano 2026, nº 223",
  disponibilizacao: "quinta-feira, 01 de outubro de 2026",
  publicacao: "02/10/2026",
  pageCount: result.pageCount,
  pagesConverted: pages.length,
  charCount: banner.length + body.length,
  emptyPages: result.emptyPages,
  processCount: processes.length,
  markdownHref: "/cadernos/dje-tre-pa-2026-n223.md",
  pages,
  processes,
};

writeFileSync("public/cadernos/dje-tre-pa-2026-n223.json", JSON.stringify(caderno));
const mb = (Buffer.byteLength(JSON.stringify(caderno)) / 1024 / 1024).toFixed(2);
console.error(
  `done pages=${pages.length} processos=${processes.length} empty=${result.emptyPages} json=${mb}MB ${(Date.now() - t0) / 1000}s`,
);
