import { fieldValue } from "./classify.ts";
import { templateMarkdown } from "./template.ts";
import { UNKNOWN, type ArchiveDoc } from "./types.ts";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[index] = crc;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function slug(value: string): string {
  const folded = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\[|\]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!folded || folded === "nao-identificado") return "a-classificar";
  return folded.slice(0, 60);
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function zipStore(files: { path: string; text: string }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encode(file.path);
    const data = encode(file.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function archiveFiles(docs: ArchiveDoc[]): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  const indexRows: string[][] = [];
  const gaps: string[] = [];
  const improvements: string[] = ["# Melhorias", ""];
  for (const doc of docs) {
    const base = slug(doc.filename.replace(/\.pdf$|\.md$/i, "")) || doc.id;
    files.push({ path: `fontes/${base}.fiel.md`, text: doc.faithful });
    files.push({ path: `fontes/${base}.leitura.md`, text: doc.cleanupUndone ? doc.faithful : doc.reading });
    if (!doc.quality.integral) {
      gaps.push(`- ${doc.filename}: leitura não integral. Páginas sem texto: ${doc.quality.emptyPages.join(", ") || "não marcadas"}. OCR: ${doc.quality.needsOcr.join(", ") || "nenhuma página indicada"}.`);
    }
    for (const act of doc.acts) {
      const classe = fieldValue(act.fields, "classe");
      const rito = fieldValue(act.fields, "rito");
      const fase = fieldValue(act.fields, "fase");
      const path = `modelos/${slug(classe)}/${slug(rito)}/${slug(fase)}/${slug(act.id)}.md`;
      files.push({ path, text: templateMarkdown(act) });
      indexRows.push([
        act.id,
        act.template.title,
        act.nature,
        classe,
        rito,
        fase,
        fieldValue(act.fields, "tipo"),
        fieldValue(act.fields, "assunto"),
        fieldValue(act.fields, "exercicio"),
        fieldValue(act.fields, "eleicao"),
        act.review,
        doc.filename,
        act.pdfPages.join(" ") || "sem-pagina",
        path,
        act.duplicateOf ?? "",
        act.variantOf.join(" "),
        act.documentId,
      ]);
      for (const item of act.fields) {
        if (item.value === UNKNOWN) gaps.push(`- ${act.id} · ${item.label}: ${UNKNOWN}. Origem: ${item.origin}.`);
      }
      if (act.nature === "extrato") gaps.push(`- ${act.id}: extrato de publicação. A decisão integral não foi reconstruída.`);
      improvements.push(`## ${act.id} · ${act.title}`, "");
      improvements.push("| Problema | Trecho e origem | Alteração proposta | Justificativa | Prioridade |");
      improvements.push("| --- | --- | --- | --- | --- |");
      for (const item of act.improvements) {
        improvements.push(
          `| ${item.kind}: ${item.problem} | ${item.excerpt || "—"} (${item.origin}) | ${item.proposal} | ${item.reason} | ${item.priority} |`,
        );
      }
      improvements.push("");
    }
  }
  const header = ["id", "titulo", "natureza", "classe", "rito", "fase", "tipo", "assunto", "exercicio", "eleicao", "revisao", "origem", "paginas", "arquivo", "duplicata_de", "variantes", "id_documento"];
  files.push({
    path: "indice.csv",
    text: [header, ...indexRows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n",
  });
  files.push({
    path: "indice.json",
    text: JSON.stringify(
      docs.map((doc) => ({
        id: doc.id,
        arquivo: doc.filename,
        pdf: doc.hasPdf,
        qualidade: doc.quality,
        preservado: doc.preserved,
        atos: doc.acts.map((act) => ({
          id: act.id,
          natureza: act.nature,
          titulo: act.title,
          paginas: act.pdfPages,
          paginasImpressas: act.printedPages,
          idDocumento: act.documentId,
          processos: act.cnj,
          voz: act.voice,
          revisao: act.review,
          aviso: act.warning,
          duplicataDe: act.duplicateOf,
          variantes: act.variantOf,
          campos: act.fields,
          modelo: { titulo: act.template.title, campos: act.template.fields, limites: act.template.limits, pendencias: act.template.pending },
        })),
      })),
      null,
      2,
    ),
  });
  files.push({ path: "relatorio-melhorias.md", text: improvements.join("\n") });
  files.push({
    path: "relatorio-lacunas.md",
    text: ["# Lacunas", "", gaps.length ? gaps.join("\n") : "Nenhuma lacuna registrada.", ""].join("\n"),
  });
  return files;
}

export function archiveZip(docs: ArchiveDoc[]): Uint8Array {
  return zipStore(archiveFiles(docs));
}
