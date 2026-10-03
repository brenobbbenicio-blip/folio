import { classifyAct, fieldValue, inferNature, inferVoice } from "./classify.ts";
import { suggestImprovements } from "./improve.ts";
import { buildQuality, preserveFrom } from "./quality.ts";
import { segmentActs } from "./segment.ts";
import { buildTemplate } from "./template.ts";
import { UNKNOWN, type Act, type ArchiveDoc, type EvidenceField, type IngestInput } from "./types.ts";

let docSeq = 0;

function ownCnjs(text: string): string[] {
  const found: string[] = [];
  const re = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  for (const line of text.split("\n")) {
    if (/jurisprud|precedente|citad|Rel\.|originad/i.test(line)) continue;
    for (const match of line.matchAll(re)) found.push(match[0]);
  }
  return [...new Set(found)];
}

function documentId(text: string): string {
  const match = /\bID(?:\s+do documento)?\s*[:nº°]\s*([A-Z0-9-]{4,})/i.exec(text);
  return match ? match[1] : UNKNOWN;
}

function printedPages(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(?:p[áa]gina|fls?\.?)\s+(\d{1,4})\b/gi)].map((match) => match[1]))];
}

function makeAct(docId: string, index: number, filename: string, raw: { title: string; text: string; pdfPages: number[]; cnj: string[] }): Act {
  const nature = inferNature(raw.title, raw.text);
  const voice = inferVoice(raw.title, raw.text);
  const fields = classifyAct({ title: raw.title, text: raw.text, filename, pages: raw.pdfPages });
  const origin = raw.pdfPages.length ? `${filename} · página ${raw.pdfPages.join(", ")}` : `${filename} · página não marcada`;
  const template = buildTemplate({ filename, title: raw.title, nature, text: raw.text, pages: raw.pdfPages, fields, voice });
  const improvements = suggestImprovements({ text: raw.text, templateText: template.text, nature, fields, origin });
  return {
    id: `${docId}-${index + 1}`,
    title: raw.title,
    nature,
    text: raw.text,
    pdfPages: raw.pdfPages,
    printedPages: printedPages(raw.text),
    documentId: documentId(raw.text),
    cnj: ownCnjs(raw.text),
    fields,
    template,
    improvements,
    voice,
    review: "pendente",
    warning: null,
    duplicateOf: null,
    variantOf: [],
  };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function linkDuplicates(docs: ArchiveDoc[]): ArchiveDoc[] {
  const acts = docs.flatMap((doc) => doc.acts.map((act) => ({ docId: doc.id, act })));
  for (const item of acts) {
    item.act.duplicateOf = null;
    item.act.variantOf = [];
  }
  for (let i = 0; i < acts.length; i++) {
    const left = acts[i].act;
    const leftNorm = left.text.replace(/\s+/g, " ").trim();
    const leftTokens = tokens(left.text);
    for (let j = 0; j < i; j++) {
      const right = acts[j].act;
      const rightNorm = right.text.replace(/\s+/g, " ").trim();
      if (leftNorm === rightNorm) {
        left.duplicateOf = right.id;
        break;
      }
      const sameKind = fieldValue(left.fields, "classe") === fieldValue(right.fields, "classe") && fieldValue(left.fields, "tipo") === fieldValue(right.fields, "tipo");
      if (sameKind && jaccard(leftTokens, tokens(right.text)) >= 0.72) {
        left.variantOf = [...new Set([...left.variantOf, right.id])];
      }
    }
  }
  return docs;
}

export function ingestDocument(input: IngestInput, id = `d${(docSeq += 1).toString(36)}`): ArchiveDoc {
  const reading = input.reading.trim() + (input.reading.endsWith("\n") ? "" : "\n");
  const faithful = input.faithful.trim() + (input.faithful.endsWith("\n") ? "" : "\n");
  const quality = buildQuality(reading, {
    chromeSamples: input.chromeSamples ?? [],
    columnsDetected: input.columnsDetected,
    likelyScan: input.likelyScan,
  });
  const raw = segmentActs(reading);
  const acts = raw.map((act, index) => makeAct(id, index, input.filename, act));
  return {
    id,
    filename: input.filename,
    addedAt: new Date().toISOString(),
    hasPdf: input.hasPdf,
    faithful,
    reading,
    cleanupUndone: false,
    quality,
    preserved: preserveFrom(faithful, input.chromeSamples ?? []),
    acts,
    history: [],
  };
}

function rebuild(doc: ArchiveDoc, source: string, label: string): ArchiveDoc {
  const raw = segmentActs(source);
  const acts = raw.map((act, index) => makeAct(doc.id, index, doc.filename, act));
  return {
    ...doc,
    acts,
    history: [...doc.history, { label, acts: doc.acts }].slice(-12),
  };
}

export function undoCleanup(doc: ArchiveDoc): ArchiveDoc {
  const next = rebuild(doc, doc.faithful, "Desfazer limpeza de cabeçalho e rodapé");
  next.cleanupUndone = true;
  return next;
}

export function redoCleanup(doc: ArchiveDoc): ArchiveDoc {
  const next = rebuild(doc, doc.reading, "Refazer limpeza de cabeçalho e rodapé");
  next.cleanupUndone = false;
  return next;
}

export function undoBoundary(doc: ArchiveDoc): ArchiveDoc {
  const previous = doc.history[doc.history.length - 1];
  if (!previous) return doc;
  return { ...doc, acts: previous.acts, history: doc.history.slice(0, -1) };
}

function reclassify(
  act: Act,
  filename: string,
  patch: Partial<Pick<Act, "title" | "text" | "pdfPages" | "warning">>,
): Act {
  const text = patch.text ?? act.text;
  const title = patch.title ?? act.title;
  const pdfPages = patch.pdfPages ?? act.pdfPages;
  const nature = inferNature(title, text);
  const voice = inferVoice(title, text);
  const fields = classifyAct({ title, text, filename, pages: pdfPages });
  return refresh(
    {
      ...act,
      title,
      text,
      pdfPages,
      printedPages: printedPages(text),
      documentId: documentId(text),
      cnj: ownCnjs(text),
      nature,
      voice,
      fields,
      warning: "warning" in patch ? (patch.warning ?? null) : act.warning,
      review: "pendente",
      duplicateOf: null,
      variantOf: [],
    },
    filename,
  );
}
function refresh(act: Act, filename: string): Act {
  const template = buildTemplate({
    filename,
    title: act.title,
    nature: act.nature,
    text: act.text,
    pages: act.pdfPages,
    fields: act.fields,
    voice: act.voice,
  });
  return {
    ...act,
    template,
    improvements: suggestImprovements({
      text: act.text,
      templateText: template.text,
      nature: act.nature,
      fields: act.fields,
      origin: act.pdfPages.length ? `${filename} · página ${act.pdfPages.join(", ")}` : `${filename} · página não marcada`,
    }),
  };
}

export function splitAct(doc: ArchiveDoc, actId: string, paragraphIndex: number): ArchiveDoc {
  const index = doc.acts.findIndex((act) => act.id === actId);
  if (index < 0) return doc;
  const act = doc.acts[index];
  const parts = act.text.split(/\n{2,}/);
  if (paragraphIndex <= 0 || paragraphIndex >= parts.length) return doc;
  const leftText = parts.slice(0, paragraphIndex).join("\n\n");
  const rightText = parts.slice(paragraphIndex).join("\n\n");
  const left = reclassify(act, doc.filename, { text: leftText });
  const right = reclassify(
    { ...act, id: `${act.id}-b${doc.history.length + 1}` },
    doc.filename,
    {
      text: rightText,
      title: rightText.split("\n").find((line) => line.trim())?.trim().slice(0, 80) || "Trecho dividido",
    },
  );
  const acts = [...doc.acts.slice(0, index), left, right, ...doc.acts.slice(index + 1)];
  return { ...doc, acts, history: [...doc.history, { label: "Dividir ato", acts: doc.acts }].slice(-12) };
}

export function mergeWithNext(doc: ArchiveDoc, actId: string): ArchiveDoc {
  const index = doc.acts.findIndex((act) => act.id === actId);
  if (index < 0 || index + 1 >= doc.acts.length) return doc;
  const left = doc.acts[index];
  const right = doc.acts[index + 1];
  const different = left.cnj.length && right.cnj.length && left.cnj.some((cnj) => !right.cnj.includes(cnj));
  const merged = reclassify(left, doc.filename, {
    text: `${left.text.trim()}\n\n${right.text.trim()}`,
    pdfPages: [...new Set([...left.pdfPages, ...right.pdfPages])].sort((a, b) => a - b),
    warning: different ? "União manual de atos com processos diferentes." : left.warning,
  });
  const acts = [...doc.acts.slice(0, index), merged, ...doc.acts.slice(index + 2)];
  return { ...doc, acts, history: [...doc.history, { label: "Unir atos", acts: doc.acts }].slice(-12) };
}

export function updateField(doc: ArchiveDoc, actId: string, key: string, value: string): ArchiveDoc {
  const acts = doc.acts.map((act) => {
    if (act.id !== actId) return act;
    const fields: EvidenceField[] = act.fields.map((item) =>
      item.key === key
        ? {
            ...item,
            value: value.trim() || UNKNOWN,
            status: value.trim() ? "identificada" : "indeterminada",
            method: "revisão humana",
            evidence: value.trim() ? `${item.evidence} Revisão humana.` : "Revisão humana removeu o valor.",
          }
        : item,
    );
    return refresh({ ...act, fields, review: "revisada" }, doc.filename);
  });
  return { ...doc, acts };
}

export function activeText(doc: ArchiveDoc): string {
  return doc.cleanupUndone ? doc.faithful : doc.reading;
}
