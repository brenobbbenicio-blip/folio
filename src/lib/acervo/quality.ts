import type { Preserved, QualityReport } from "./types.ts";

const CNJ = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
const PAGE = /<!--\s*página\s+(\d+)([^>]*)-->/g;

export function pageSlices(markdown: string): { page: number | null; note: string; text: string }[] {
  const marks = [...markdown.matchAll(PAGE)];
  if (!marks.length) return [{ page: null, note: "", text: markdown.trim() }];
  const slices: { page: number | null; note: string; text: string }[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? markdown.length) : markdown.length;
    slices.push({
      page: Number(marks[i][1]),
      note: marks[i][2] ?? "",
      text: markdown.slice(start, end).trim(),
    });
  }
  return slices;
}

export function buildQuality(
  reading: string,
  extra?: { chromeSamples?: string[]; columnsDetected?: boolean; likelyScan?: boolean },
): QualityReport {
  const slices = pageSlices(reading);
  const markersPresent = slices.some((slice) => slice.page !== null);
  const emptyPages = slices.filter((slice) => slice.page !== null && slice.text.length < 15).map((slice) => slice.page as number);
  const readingOrderRisks: string[] = [];
  const damagedTables: string[] = [];
  const illegible: string[] = [];
  for (const slice of slices) {
    const where = slice.page === null ? "texto sem página" : `página ${slice.page}`;
    if (slice.note.includes("2 colunas") || extra?.columnsDetected) {
      if (!readingOrderRisks.includes(where)) readingOrderRisks.push(`${where}: possível leitura em colunas`);
    }
    const rows = slice.text.split("\n").filter((line) => line.trim().startsWith("|"));
    const counts = rows.map((line) => line.split("|").length);
    if (counts.length >= 2 && new Set(counts).size > 1) damagedTables.push(`${where}: tabela com colunas irregulares`);
    const letters = slice.text.replace(/[^\p{L}]/gu, "").length;
    const bad = (slice.text.match(/�|¿/g) ?? []).length;
    if (slice.text.length > 40 && (bad > 4 || letters / slice.text.length < 0.35)) {
      illegible.push(`${where}: trecho com caracteres ilegíveis`);
    }
  }
  if (extra?.columnsDetected && !readingOrderRisks.length) {
    readingOrderRisks.push("O PDF tem página em duas colunas. A ordem de leitura pode ter falhado.");
  }
  const needsOcr = extra?.likelyScan ? slices.map((slice) => slice.page).filter((page): page is number => page !== null) : emptyPages;
  const integral = markersPresent && emptyPages.length === 0 && illegible.length === 0 && !extra?.likelyScan;
  const changes = [
    "Markdown fiel conserva a extração antes da limpeza.",
    "Markdown de leitura pode ter cabeçalho, rodapé e hífen de fim de linha ajustados.",
    "Hífen de número processual, código ou palavra composta não é removido.",
  ];
  if (!markersPresent) changes.push("Markdown sem marcadores de página. Nenhuma página foi reconstituída.");
  return {
    pagesProcessed: markersPresent ? slices.length : null,
    emptyPages,
    markersPresent,
    readingOrderRisks: [...new Set(readingOrderRisks)],
    damagedTables,
    illegible,
    needsOcr,
    integral,
    chromeSamples: extra?.chromeSamples ?? [],
    changes,
  };
}

export function preserveFrom(faithful: string, chromeSamples: string[]): Preserved {
  const bag = `${chromeSamples.join("\n")}\n${faithful}`;
  const take = (re: RegExp, limit = 6) => [...new Set([...bag.matchAll(re)].map((match) => match[0].trim()))].slice(0, limit);
  return {
    orgao: take(/(?:Tribunal Regional Eleitoral[^\n]{0,60}|\d+ª\s+Zona Eleitoral[^\n]{0,40}|Ju[íi]zo da[^\n]{0,60})/gi),
    datas: take(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g),
    edicao: take(/(?:Ano\s+\d{4}[^\n]{0,40}|Diário da Justiça[^\n]{0,80}|n[ºo°]\s*\d{1,4})/gi),
    processos: take(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g),
    assinaturas: take(/(?:[Aa]ssinado[^\n]{0,80}|Documento assinado digitalmente[^\n]{0,40})/g),
  };
}
