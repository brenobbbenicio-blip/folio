import { pageSlices } from "./quality.ts";

const CNJ_SRC = String.raw`\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}`;

function cnjsIn(line: string): string[] {
  return [...line.matchAll(new RegExp(CNJ_SRC, "g"))].map((match) => match[0]);
}

const START =
  /^(?:extrato(?:\s+de\s+\p{L}+)?|despacho|senten[çc]a|decis[ãa]o|certid[ãa]o|parecer|peti[çc][ãa]o|edital|portaria|intima[çc][ãa]o|ac[óo]rd[ãa]o|minuta|modelo|representa[çc][ãa]o|presta[çc][ãa]o de contas(?:\s+\p{L}+)?|cumprimento de senten[çc]a)\b/iu;

export type RawAct = {
  title: string;
  text: string;
  pdfPages: number[];
  cnj: string[];
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function isDocStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80 || trimmed.startsWith("<!--")) return false;
  if (trimmed.split(/\s+/).length > 4) return false;
  if (/^(?:ementa|relatorio|voto|dispositivo|fundamentacao|conclusao)\b/i.test(fold(trimmed))) return false;
  return START.test(trimmed);
}

function isProcessHeader(line: string): boolean {
  if (/jurisprud|precedente|citad|Rel\.|originad/i.test(line)) return false;
  return /(?:^|\b)(?:processo|autos|proc\.)\b/i.test(line) && cnjsIn(line).length > 0;
}

export function segmentActs(markdown: string): RawAct[] {
  const slices = pageSlices(markdown);
  const acts: RawAct[] = [];
  let current: { title: string; lines: string[]; pages: Set<number>; cnj: Set<string> } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (!text) {
      current = null;
      return;
    }
    acts.push({
      title: current.title,
      text,
      pdfPages: [...current.pages].sort((a, b) => a - b),
      cnj: [...current.cnj],
    });
    current = null;
  };

  for (const slice of slices) {
    const lines = slice.text.split("\n");
    for (const line of lines) {
      const header = isDocStart(line);
      const otherProcess =
        !!current &&
        current.cnj.size > 0 &&
        isProcessHeader(line) &&
        [...cnjsIn(line)].some((cnj) => !current?.cnj.has(cnj));
      if ((header || otherProcess) && current && current.lines.join("\n").trim()) flush();
      if (!current) {
        current = {
          title: header ? line.trim().slice(0, 80) : "Trecho sem título",
          lines: [],
          pages: new Set(),
          cnj: new Set(),
        };
      }
      if (header && current.lines.length === 0) current.title = line.trim().slice(0, 80);
      if (slice.page !== null && line.trim()) current.pages.add(slice.page);
      for (const cnj of cnjsIn(line)) {
        if (!/jurisprud|precedente|citad|Rel\.|originad/i.test(line)) current.cnj.add(cnj);
      }
      current.lines.push(line);
    }
  }
  flush();
  return acts.filter((act) => act.text.replace(/\s/g, "").length > 0);
}
