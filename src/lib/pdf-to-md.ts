import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  Util,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ConvertOptions, ConvertResult, PageMarker } from "@/lib/pdf-options";
import { dehyphenateAllowed } from "@/lib/acervo/hyphen";

export type { ConvertOptions, ConvertResult, PageMarker };

export class PdfNeedsPasswordError extends Error {
  readonly incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? "Senha incorreta." : "Este PDF pede senha.");
    this.name = "PdfNeedsPasswordError";
    this.incorrect = incorrect;
  }
}

type Glyph = {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
};

type Line = {
  plain: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  boldRatio: number;
  urls: string[];
  /** Right edge of this column, taken from the longer lines. */
  edge: number;
  leader: boolean;
  /** Set when the line is a row of aligned cells, not a sentence. */
  cells: string[] | null;
  splits: number[];
};

type Item = { n: number; text: string; urls: string[] };

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string; urls: string[] }
  | { type: "para"; text: string; urls: string[] }
  | { type: "ul"; items: Item[] }
  | { type: "ol"; items: Item[] }
  | { type: "table"; rows: string[][] };

export function parsePageSpec(spec: string, total: number): number[] {
  const trimmed = spec.trim();
  if (!trimmed) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(token);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) {
        if (n >= 1 && n <= total) pages.add(n);
      }
      continue;
    }
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 1 && n <= total) pages.add(n);
      else throw new Error(`Página ${n} não existe neste PDF (${total} páginas).`);
      continue;
    }
    throw new Error(`Intervalo inválido: “${token}”. Use 1-3, 5.`);
  }
  if (pages.size === 0) throw new Error("Nenhuma página do intervalo existe neste PDF.");
  return [...pages].sort((a, b) => a - b);
}

async function ensureWorker(): Promise<void> {
  if (GlobalWorkerOptions.workerSrc) return;
  const mod = (await import(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
  )) as { default: string };
  GlobalWorkerOptions.workerSrc = mod.default;
}

export async function openPdf(data: Uint8Array) {
  await ensureWorker();
  return getDocument({ data: data.slice(), verbosity: 0, ...assetParams() }).promise;
}

function assetParams(): {
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
} {
  if (typeof window === "undefined") return {};
  const origin = window.location.origin;
  return {
    cMapUrl: `${origin}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${origin}/standard_fonts/`,
  };
}

function isTextItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
} {
  return !!item && typeof item === "object" && "str" in item && typeof (item as { str?: unknown }).str === "string";
}

type FontFlags = { bold: boolean; italic: boolean };

function fontFlags(page: PDFPageProxy, fontName: string, cache: Map<string, FontFlags>): FontFlags {
  const hit = cache.get(fontName);
  if (hit) return hit;
  let bold = false;
  let italic = false;
  if (page.commonObjs.has(fontName)) {
    const font = page.commonObjs.get(fontName) as {
      bold?: boolean;
      italic?: boolean;
      black?: boolean;
      name?: string;
    };
    const name = font?.name ?? "";
    bold = !!(font?.bold || font?.black || /bold|black|heavy|semibold|demi/i.test(name));
    italic = !!(font?.italic || /italic|oblique/i.test(name));
  }
  const flags = { bold, italic };
  cache.set(fontName, flags);
  return flags;
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

function mapPoint(x: number, y: number, matrix: number[]): [number, number] {
  const point = [x, y];
  Util.applyTransform(point, matrix);
  return [point[0], point[1]];
}

function viewportBox(
  rect: number[],
  viewport: { transform: number[] },
): { x: number; y: number; w: number; h: number } | null {
  if (!Array.isArray(rect) || rect.length < 4) return null;
  const a = mapPoint(rect[0], rect[1], viewport.transform);
  const b = mapPoint(rect[2], rect[3], viewport.transform);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

async function extractPage(
  page: PDFPageProxy,
  fontCache: Map<string, FontFlags>,
): Promise<{ lines: Line[]; width: number; height: number; columns: boolean }> {
  try {
    await page.getOperatorList();
  } catch {
    /* font program missing — text still extracts */
  }
  const viewport = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const glyphs: Glyph[] = [];

  for (const item of text.items) {
    if (!isTextItem(item) || !item.str) continue;
    const flags = fontFlags(page, item.fontName, fontCache);
    const pdfX = Number(item.transform[4]) || 0;
    const pdfY = Number(item.transform[5]) || 0;
    const [x, y] = mapPoint(pdfX, pdfY, viewport.transform);
    const fontSize = Math.hypot(Number(item.transform[2]) || 0, Number(item.transform[3]) || 0) || item.height || 12;
    const width = item.width || Math.max(item.str.length * fontSize * 0.45, 0);
    glyphs.push({
      str: item.str.replace(/\u00a0/g, " "),
      x,
      y,
      width,
      fontSize: fontSize || 12,
      bold: flags.bold,
      italic: flags.italic,
    });
  }

  let annots: { url: string; box: { x: number; y: number; w: number; h: number } }[] = [];
  try {
    const raw = await page.getAnnotations({ intent: "display" });
    annots = raw
      .map((ann) => {
        const record = ann as { url?: string; unsafeUrl?: string; rect?: number[] };
        const url = safeUrl(record.url) ?? safeUrl(record.unsafeUrl);
        const box = record.rect ? viewportBox(record.rect, viewport) : null;
        if (!url || !box) return null;
        return { url, box };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  } catch {
    annots = [];
  }

  const columns = splitColumns(glyphs, viewport.width);
  const lines = columns.flatMap((col) => clusterLines(col, annots));

  return {
    lines,
    width: viewport.width,
    height: viewport.height,
    columns: columns.length > 1,
  };
}

function splitColumns(glyphs: Glyph[], pageWidth: number): Glyph[][] {
  const visible = glyphs.filter((g) => g.str.trim());
  if (visible.length < 10 || pageWidth < 200) return [glyphs];
  const bins = 48;
  const binW = pageWidth / bins;
  const cover = new Float64Array(bins);
  for (const g of visible) {
    const a = Math.max(0, Math.floor(g.x / binW));
    const b = Math.min(bins - 1, Math.floor((g.x + Math.max(g.width, 1)) / binW));
    for (let i = a; i <= b; i++) cover[i] += g.fontSize;
  }
  const max = Math.max(...cover);
  if (max <= 0) return [glyphs];
  const low = max * 0.04;
  const i0 = Math.floor(bins * 0.2);
  const i1 = Math.ceil(bins * 0.8);
  let bestStart = -1;
  let bestLen = 0;
  let run = -1;
  for (let i = i0; i <= i1; i++) {
    const empty = i < i1 && cover[i] <= low;
    if (empty) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      const len = i - run;
      if (len > bestLen) {
        bestLen = len;
        bestStart = run;
      }
      run = -1;
    }
  }
  if (bestLen < 2 || bestLen * binW < pageWidth * 0.04) return [glyphs];
  const gutter = (bestStart + bestLen / 2) * binW;
  const left = glyphs.filter((g) => g.x + g.width / 2 < gutter);
  const right = glyphs.filter((g) => g.x + g.width / 2 >= gutter);
  if (left.filter((g) => g.str.trim()).length < 4 || right.filter((g) => g.str.trim()).length < 4) {
    return [glyphs];
  }
  return [left, right];
}

function clusterLines(
  glyphs: Glyph[],
  annots: { url: string; box: { x: number; y: number; w: number; h: number } }[],
): Line[] {
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: Glyph[][] = [];
  for (const glyph of sorted) {
    let placed = false;
    for (let i = groups.length - 1; i >= 0 && i >= groups.length - 3; i--) {
      const group = groups[i];
      const ref = group[0];
      const tol = Math.max(2, Math.min(ref.fontSize, glyph.fontSize) * 0.45);
      const y = group.reduce((s, g) => s + g.y, 0) / group.length;
      if (Math.abs(y - glyph.y) <= tol) {
        group.push(glyph);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([glyph]);
  }

  const lines: Line[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    const rendered = renderGlyphs(group);
    if (!rendered.plain) continue;
    const fontSize = rendered.fontSize;
    const y = group.reduce((s, g) => s + g.y, 0) / group.length;
    const x = group[0].x;
    const end = group[group.length - 1];
    const width = Math.max(0, end.x + end.width - x);
    const urls = annots
      .filter((ann) => {
        const top = y - fontSize;
        const bottom = y + fontSize * 0.35;
        const vertical = bottom >= ann.box.y && top <= ann.box.y + ann.box.h;
        const horizontal = x + width >= ann.box.x && x <= ann.box.x + ann.box.w;
        return vertical && horizontal;
      })
      .map((ann) => ann.url);
    lines.push({
      plain: rendered.plain,
      x,
      y,
      width,
      fontSize,
      boldRatio: rendered.boldRatio,
      urls: [...new Set(urls)],
      edge: 0,
      leader: rendered.leader,
      cells: rendered.cells,
      splits: rendered.splits,
    });
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  const edge = columnEdge(lines);
  for (const line of lines) line.edge = edge;
  return lines;
}

function columnEdge(lines: Line[]): number {
  if (!lines.length) return 0;
  const lengths = lines.map((line) => line.plain.length).sort((a, b) => a - b);
  const median = lengths[Math.floor((lengths.length - 1) / 2)] || 1;
  const long = lines.filter((line) => line.plain.length >= Math.max(24, median));
  const pool = long.length >= 4 ? long : lines;
  const ends = pool.map((line) => line.x + line.width).sort((a, b) => a - b);
  const index = Math.min(ends.length - 1, Math.floor((ends.length - 1) * 0.85));
  return ends[index];
}

function renderGlyphs(glyphs: Glyph[]): {
  plain: string;
  fontSize: number;
  boldRatio: number;
  leader: boolean;
  cells: string[] | null;
  splits: number[];
} {
  let text = "";
  let sizeSum = 0;
  let weight = 0;
  let boldChars = 0;
  let chars = 0;
  let leader = false;
  const segments: { text: string; x: number }[] = [];
  let buf = "";
  let bufX = glyphs[0]?.x ?? 0;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    if (/[.\u2026]{4,}/.test(glyph.str)) leader = true;
    if (i > 0) {
      const prev = glyphs[i - 1];
      const gap = glyph.x - (prev.x + prev.width);
      const threshold = Math.max(prev.fontSize * 0.17, 1.1);
      const prevSpace = /\s$/.test(text);
      const nextSpace = /^\s/.test(glyph.str);
      if (gap > threshold && !nextSpace) {
        const colonish = /^\s*:/.test(glyph.str);
        const wide = !colonish && gap > Math.max(prev.fontSize * 2.2, 16) && glyph.str.trim().length > 0;
        if (wide) {
          if (buf.trim()) segments.push({ text: buf.trim(), x: bufX });
          buf = "";
          bufX = glyph.x;
          text = text.replace(/[ \t]+$/, "") + " · ";
        } else if (!prevSpace) {
          text += " ";
          buf += " ";
        }
      }
    }
    text += glyph.str;
    buf += glyph.str;
    const visible = glyph.str.replace(/\s/g, "");
    const n = visible.length || (glyph.str.trim() ? 1 : 0);
    sizeSum += glyph.fontSize * Math.max(n, glyph.str === " " ? 0 : 1);
    weight += Math.max(n, glyph.str.trim() ? 1 : 0);
    chars += n;
    if (glyph.bold) boldChars += n;
  }
  if (buf.trim()) segments.push({ text: buf.trim(), x: bufX });
  const plain = repairQuotes(cleanPlain(text));
  if (/[.\u2026]{4,}/.test(text)) leader = true;
  const cells =
    segments.length >= 2 && segments.every((segment) => segment.text.length > 0)
      ? segments.map((segment) => repairQuotes(cleanPlain(segment.text)))
      : null;
  return {
    plain,
    fontSize: weight ? sizeSum / weight : glyphs[0]?.fontSize ?? 12,
    boldRatio: chars ? boldChars / chars : 0,
    leader,
    cells: cells && cells.length >= 2 ? cells : null,
    splits: cells && cells.length >= 2 ? segments.map((segment) => segment.x) : [],
  };
}

function cleanPlain(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\u00ad/g, "")
    .replace(/[ﬁﬂﬀﬃﬄ]/g, (ch) => ({ "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl" })[ch] ?? ch)
    .replace(/[ \t]*(?:[.\u2026]{4,})[ \t]*(?:·[ \t]*)?/g, " — ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Some court PDFs map “ and ” to ¿. Portuguese text almost never uses the inverted mark. */
function repairQuotes(input: string): string {
  if (!input.includes("¿")) return input;
  let text = input.replace(/¿¿([^¿]{0,240})¿¿/g, "“$1”");
  text = text.replace(/¿([^¿\n]{0,240})¿/g, "“$1”");
  text = text.replace(/¿(?=\S)/g, "“");
  text = text.replace(/¿/g, "”");
  return text;
}

function normalizeChrome(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function marginZone(line: Line, pageHeight: number): "top" | "bottom" | "body" {
  if (line.y < pageHeight * 0.08) return "top";
  if (line.y > pageHeight * 0.92) return "bottom";
  return "body";
}

function stripRunningChrome(
  pages: { lines: Line[]; height: number }[],
  enabled: boolean,
): { pages: { lines: Line[]; height: number }[]; removed: number; samples: string[] } {
  const samples: string[] = [];
  const seenSample = new Set<string>();
  const note = (line: Line) => {
    const text = line.plain.trim();
    const key = normalizeChrome(text);
    if (text.length < 2 || isLonePageNumber(line, 1) || seenSample.has(key)) return;
    if (samples.length >= 8) return;
    seenSample.add(key);
    samples.push(text);
  };
  if (!enabled || pages.length < 2) {
    let removed = 0;
    const next = pages.map((page) => ({
      ...page,
      lines: page.lines.filter((line) => {
        if (!isLonePageNumber(line, page.height)) return true;
        removed += 1;
        return false;
      }),
    }));
    return { pages: next, removed, samples };
  }
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      const zone = marginZone(line, page.height);
      if (zone === "body") continue;
      const normalized = normalizeChrome(line.plain);
      if (normalized.length < 2 || normalized.length > 420) continue;
      const key = `${zone}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const min = Math.max(2, Math.ceil(pages.length * 0.6));
  let removed = 0;
  const next = pages.map((page) => ({
    ...page,
    lines: page.lines.filter((line) => {
      if (isLonePageNumber(line, page.height)) {
        removed += 1;
        return false;
      }
      const zone = marginZone(line, page.height);
      if (zone === "body") return true;
      const key = `${zone}:${normalizeChrome(line.plain)}`;
      if ((counts.get(key) ?? 0) < min) return true;
      removed += 1;
      note(line);
      return false;
    }),
  }));
  return { pages: next, removed, samples };
}

function isLonePageNumber(line: Line, pageHeight: number): boolean {
  if (marginZone(line, pageHeight) === "body") return false;
  return /^(?:p[aá]g(?:ina|\.)?\s*)?\d{1,4}$/i.test(line.plain.trim());
}

function weightedMedian(lines: Line[]): number {
  const items = lines
    .filter((line) => line.plain.length > 0)
    .map((line) => ({ size: line.fontSize, w: line.plain.length }))
    .sort((a, b) => a.size - b.size);
  const total = items.reduce((s, item) => s + item.w, 0);
  if (!total) return 12;
  let acc = 0;
  for (const item of items) {
    acc += item.w;
    if (acc >= total / 2) return item.size;
  }
  return items[items.length - 1].size;
}

function listMatch(text: string): { kind: "ul" | "ol"; rest: string; n: number } | null {
  const ordered = /^(\d{1,3})[.)]\s+(\S.*)$/.exec(text);
  if (ordered && Number(ordered[1]) <= 200) return { kind: "ol", rest: ordered[2], n: Number(ordered[1]) };
  const letter = /^([a-z])\)\s+(\S.*)$/i.exec(text);
  if (letter) return { kind: "ul", rest: letter[2], n: 0 };
  const bullet = /^[•·▪▸►◦‣–—]\s+(\S.*)$/.exec(text);
  if (bullet) return { kind: "ul", rest: bullet[1], n: 0 };
  const hyphen = /^[-]\s+(\S.*)$/.exec(text);
  if (hyphen && text.length <= 110) return { kind: "ul", rest: hyphen[1], n: 0 };
  return null;
}

function headingLevel(ratio: number): 1 | 2 | 3 {
  if (ratio >= 1.7) return 1;
  if (ratio >= 1.28) return 2;
  return 3;
}

function isHeading(line: Line, body: number): { level: 1 | 2 | 3 } | null {
  const text = line.plain;
  if (text.length < 2 || text.length > 160) return null;
  const ratio = body > 0 ? line.fontSize / body : 1;
  const list = listMatch(text);
  if (list && ratio < 1.2) return null;
  if (looksLikeField(text)) return null;
  if (looksLikeLeader(line)) return null;
  if (looksLikeRubric(text)) return { level: 2 };
  const terminal = /[.!?…]["')\]]*$/.test(text);
  if (ratio >= 1.45 && text.length <= 140) return { level: headingLevel(ratio) };
  if (ratio >= 1.18 && !terminal && text.length <= 140) return { level: headingLevel(ratio) };
  if (line.boldRatio >= 0.8 && ratio >= 0.96 && text.length <= 90 && !/[.!?:,;]$/.test(text) && !list) {
    return { level: 3 };
  }
  return null;
}

function looksLikeField(text: string): boolean {
  const match = /^[\p{Lu}][\p{L}0-9 .()ºª°/-]{1,60}\s*:\s+(\S.*)$/u.exec(text.trim());
  if (!match) return false;
  return match[1].length <= 80;
}

function looksLikeRubric(text: string): boolean {
  if (text.length < 3 || text.length > 56) return false;
  if (/[.!?,;:]$/.test(text) || text.includes(":")) return false;
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÂÊÔÃÕÇ]/g, "").length;
  return upper / letters.length > 0.85;
}

function looksLikeLeader(line: Line): boolean {
  return line.leader || /\.{4,}|…{2,}/.test(line.plain) || / — \d{1,4}$/.test(line.plain);
}

function endsWithBreakHyphen(text: string): boolean {
  return /[-\u2010\u2011]$/.test(text);
}

const CNJ_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

function startsLegalUnit(text: string): boolean {
  const line = text.trim();
  if (CNJ_RE.test(line) && line.length < 140) return true;
  if (/^(?:Processo|Proc\.|Autos|Classe)\b/.test(line) && line.length < 180) return true;
  return /^(?:Ementa|Relatório|Voto|Acórdão|Decisão|Despacho|Dispositivo|Extrato|Intimação|Edital|Portaria|Resolução|Certidão|Conclusão)\b/.test(
    line,
  ) && line.length < 100;
}

function joinKind(prev: Line, next: Line, dehyphenate: boolean): "hyphen" | "space" | "break" {
  const gap = next.y - prev.y;
  const size = Math.max(prev.fontSize, next.fontSize, 1);
  if (gap > size * 1.85) return "break";
  if (Math.abs(prev.fontSize - next.fontSize) > size * 0.22) return "break";
  if (startsLegalUnit(next.plain)) return "break";
  if (looksLikeField(next.plain)) return "break";
  if (looksLikeField(prev.plain) && !/^[\p{Ll}]/u.test(next.plain)) return "break";
  if (looksLikeRubric(prev.plain) || looksLikeRubric(next.plain)) return "break";
  if (looksLikeLeader(prev) || looksLikeLeader(next)) return "break";
  if (listMatch(next.plain)) return "break";
  if (
    dehyphenate &&
    endsWithBreakHyphen(prev.plain) &&
    dehyphenateAllowed(prev.plain, next.plain) &&
    /^[\p{Ll}]/u.test(next.plain) &&
    prev.plain.length >= 20 &&
    gap < size * 1.75
  ) {
    return "hyphen";
  }
  // A wrapped line often stops before the margin when the next word is long.
  if (/^[\p{Ll}(“"]/u.test(next.plain) && gap < size * 1.55) return "space";
  const full = prev.x + prev.width >= prev.edge - Math.max(36, prev.fontSize * 2.8);
  if (!full) return "break";
  if (/[.!?…]["')\]]*$/.test(prev.plain) && /^[\p{Lu}\d“"]/u.test(next.plain) && gap > size * 1.25) {
    return "break";
  }
  if (gap < size * 1.7) return "space";
  return "break";
}

function sameGrid(a: number[], b: number[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  return a.every((x, index) => Math.abs(x - b[index]) <= 16);
}

function tableRun(lines: Line[], start: number): number {
  const first = lines[start];
  if (!first?.cells || first.cells.length < 2 || first.splits.length < 2) return 0;
  if (looksLikeField(first.plain) || looksLikeField(first.plain.replace(/ · /g, " ")) || looksLikeRubric(first.plain) || listMatch(first.plain)) return 0;
  if (first.cells.some((cell) => /^[:·]/.test(cell.trim()))) return 0;
  const count = first.cells.length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const prev = lines[end - 1];
    if (!line.cells || line.cells.length !== count || !sameGrid(first.splits, line.splits)) break;
    if (looksLikeField(line.plain) || looksLikeRubric(line.plain) || listMatch(line.plain)) break;
    if (Math.abs(line.fontSize - first.fontSize) > first.fontSize * 0.28) break;
    if (line.y - prev.y > line.fontSize * 1.9) break;
    end += 1;
  }
  return end - start >= 3 ? end : 0;
}

function linesToBlocks(lines: Line[], options: ConvertOptions): Block[] {
  const body = weightedMedian(lines);
  const blocks: Block[] = [];
  let para: { text: string; urls: string[] } | null = null;
  let list: { kind: "ul" | "ol"; items: Item[] } | null = null;

  const flushPara = () => {
    if (para?.text.trim()) blocks.push({ type: "para", text: para.text.trim(), urls: para.urls });
    para = null;
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push({ type: list.kind, items: list.items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const run = tableRun(lines, i);
    if (run) {
      flushPara();
      flushList();
      blocks.push({
        type: "table",
        rows: lines.slice(i, run).map((row) => row.cells ?? [row.plain]),
      });
      i = run - 1;
      continue;
    }
    const heading = options.inferHeadings ? isHeading(line, body) : null;
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading.level, text: line.plain, urls: line.urls });
      continue;
    }
    const listed = listMatch(line.plain);
    if (listed) {
      flushPara();
      if (!list || list.kind !== listed.kind) {
        flushList();
        list = { kind: listed.kind, items: [] };
      }
      list.items.push({ n: listed.n, text: listed.rest, urls: line.urls });
      continue;
    }
    if (list && para == null) {
      const prevItem = list.items[list.items.length - 1];
      const prevLine = lines[i - 1];
      const gap = prevLine ? line.y - prevLine.y : 999;
      if (prevItem && prevLine && gap < line.fontSize * 1.7 && line.x >= prevLine.x - 2) {
        const kind = joinKind(prevLine, line, options.dehyphenate);
        if (kind !== "break") {
          prevItem.text =
            kind === "hyphen"
              ? prevItem.text.replace(/[-\u2010\u2011]$/, "") + line.plain
              : `${prevItem.text} ${line.plain}`;
          prevItem.urls = [...new Set([...prevItem.urls, ...line.urls])];
          continue;
        }
      }
    }
    flushList();
    if (!options.reflow) {
      flushPara();
      para = { text: line.plain, urls: line.urls };
      flushPara();
      continue;
    }
    if (!para) {
      para = { text: line.plain, urls: [...line.urls] };
      continue;
    }
    const prevLine = lines[i - 1];
    const kind = prevLine ? joinKind(prevLine, line, options.dehyphenate) : "break";
    if (kind === "break") {
      flushPara();
      para = { text: line.plain, urls: [...line.urls] };
    } else if (kind === "hyphen") {
      para.text = para.text.replace(/[-\u2010\u2011]$/, "") + line.plain;
      para.urls = [...new Set([...para.urls, ...line.urls])];
    } else {
      para.text = `${para.text} ${line.plain}`;
      para.urls = [...new Set([...para.urls, ...line.urls])];
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function escapeInline(value: string): string {
  return value.replace(/[\\`*_{}[\]#<>]/g, "\\$&");
}

function escapeCell(value: string): string {
  return escapeInline(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function decorate(text: string, urls: string[]): string {
  const escaped = escapeInline(text);
  if (urls.length === 1) return `[${escaped}](${urls[0]})`;
  if (urls.length > 1) return `${escaped} (${urls.map((url) => `<${url}>`).join(", ")})`;
  return escaped;
}

function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") {
        return `${"#".repeat(block.level)} ${decorate(block.text, block.urls)}`;
      }
      if (block.type === "para") return decorate(block.text, block.urls);
      if (block.type === "ul") return block.items.map((item) => `- ${decorate(item.text, item.urls)}`).join("\n");
      if (block.type === "table") {
        const rows = block.rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
        const width = block.rows[0]?.length ?? 1;
        rows.splice(1, 0, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
        return rows.join("\n");
      }
      return block.items.map((item) => `${item.n}. ${decorate(item.text, item.urls)}`).join("\n");
    })
    .join("\n\n");
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim()}"`;
}

type OutlineNode = { title?: string; items?: OutlineNode[] };

function outlineMarkdown(nodes: OutlineNode[], depth = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const title = repairQuotes((node.title ?? "").replace(/\s+/g, " ").trim());
    if (title) lines.push(`${"  ".repeat(depth)}- ${escapeInline(title)}`);
    if (node.items?.length) lines.push(outlineMarkdown(node.items, depth + 1));
  }
  return lines.filter(Boolean).join("\n");
}

function pageBanner(pageNumber: number, marker: PageMarker, columns: boolean): string {
  const col = columns ? " · 2 colunas" : "";
  if (marker === "comment") return `<!-- página ${pageNumber}${col} -->`;
  if (marker === "rule") return "---";
  if (marker === "heading") return `## Página ${pageNumber}`;
  return columns ? `<!-- página ${pageNumber}${col} -->` : "";
}

function normLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Some generators also paint, clipped, the line that continues on the next page. */
function dropClippedTails(pages: { lines: Line[]; height: number }[]) {
  for (let i = 0; i < pages.length - 1; i++) {
    const cur = pages[i];
    const nxt = pages[i + 1];
    if (!cur.lines.length || !nxt.lines.length) continue;
    const last = cur.lines[cur.lines.length - 1];
    const first = nxt.lines[0];
    if (last.y < cur.height * 0.86) continue;
    const a = normLine(last.plain);
    const b = normLine(first.plain);
    if (a.length < 28) continue;
    if (a === b || (b.startsWith(a) && b.length > a.length + 8)) cur.lines.pop();
  }
}

export async function pdfToMarkdown(
  data: Uint8Array,
  options: ConvertOptions,
  hooks?: { onPage?: (page: number, total: number) => void; signal?: { cancelled: boolean } },
  password?: string,
): Promise<ConvertResult> {
  await ensureWorker();
  const task = getDocument({
    data: data.slice(),
    password: password || undefined,
    verbosity: 0,
    ...assetParams(),
  });
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const selected = parsePageSpec(options.pageRange, total);
    const fontCache = new Map<string, FontFlags>();
    const extracted: { page: number; lines: Line[]; width: number; height: number; columns: boolean }[] = [];

    for (const pageNumber of selected) {
      if (hooks?.signal?.cancelled) throw new Error("Conversão cancelada.");
      hooks?.onPage?.(pageNumber, total);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (hooks?.signal?.cancelled) throw new Error("Conversão cancelada.");
      const page = await doc.getPage(pageNumber);
      const content = await extractPage(page, fontCache);
      extracted.push({ page: pageNumber, ...content });
      page.cleanup();
    }

    const chrome = stripRunningChrome(extracted, options.stripChrome);
    const stripped = chrome.pages;
    if (options.stripChrome) dropClippedTails(stripped);
    const parts: string[] = [];
    let emptyPages = 0;
    let columnsDetected = false;
    let textChars = 0;
    const processes: { cnj: string; page: number }[] = [];
    const seenCnj = new Set<string>();

    extracted.forEach((page, index) => {
      const lines = stripped[index]?.lines ?? page.lines;
      textChars += lines.reduce((sum, line) => sum + line.plain.length, 0);
      if (!lines.length) emptyPages += 1;
      if (page.columns) columnsDetected = true;
      for (const line of lines) {
        for (const match of line.plain.matchAll(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g)) {
          const cnj = match[0];
          if (seenCnj.has(cnj)) continue;
          seenCnj.add(cnj);
          processes.push({ cnj, page: page.page });
        }
      }
      const banner = pageBanner(page.page, options.pageMarker, page.columns);
      const body = blocksToMarkdown(linesToBlocks(lines, options));
      const chunk = [banner, body].filter(Boolean).join("\n\n");
      if (chunk) parts.push(chunk);
    });

    let title: string | null = null;
    let author: string | null = null;
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as { Title?: string; Author?: string };
      title = typeof info.Title === "string" && info.Title.trim() ? info.Title.trim() : null;
      author = typeof info.Author === "string" && info.Author.trim() ? info.Author.trim() : null;
    } catch {
      title = null;
    }

    let outline = "";
    if (options.includeOutline) {
      try {
        const nodes = (await doc.getOutline()) as OutlineNode[] | null;
        if (nodes?.length) outline = outlineMarkdown(nodes);
      } catch {
        outline = "";
      }
    }

    await doc.cleanup().catch(() => undefined);

    const header: string[] = [];
    if (options.frontMatter) {
      const fields = [
        title ? `title: ${yamlQuote(title)}` : "",
        author ? `author: ${yamlQuote(author)}` : "",
        `pages: ${total}`,
        `converted: ${yamlQuote(new Date().toISOString())}`,
      ].filter(Boolean);
      header.push(`---\n${fields.join("\n")}\n---`);
    }
    if (outline) header.push(`## Sumário\n\n${outline}`);

    const markdown = [...header, ...parts].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    const headingCount = (markdown.match(/^#{1,3} /gm) ?? []).length;
    const likelyScan = selected.length > 0 && textChars < selected.length * 20;

    return {
      markdown,
      pageCount: total,
      pagesConverted: selected.length,
      emptyPages,
      headingCount,
      charCount: markdown.length,
      title,
      likelyScan,
      columnsDetected,
      chromeRemoved: chrome.removed,
      chromeSamples: chrome.samples,
      processes,
    };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    if (error instanceof PdfNeedsPasswordError) throw error;
    if (error && typeof error === "object" && "name" in error && (error as { name: string }).name === "PasswordException") {
      const code = (error as { code?: number }).code;
      throw new PdfNeedsPasswordError(code === PasswordResponses.INCORRECT_PASSWORD);
    }
    if (error && typeof error === "object" && "name" in error && (error as { name: string }).name === "InvalidPDFException") {
      throw new Error("Este arquivo não é um PDF válido.");
    }
    if (error instanceof Error && /cancelada|Intervalo|Página|Nenhuma página/.test(error.message)) throw error;
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new Error(`Não foi possível ler o PDF.${detail}`);
  }
}
