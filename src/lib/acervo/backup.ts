import type { ArchiveDoc } from "./types.ts";

export type PdfRecord = { id: string; data: Uint8Array };
export type LegacySnapshot = { docs: ArchiveDoc[]; pdfs: PdfRecord[] };
export type BackupSource = LegacySnapshot & { legacy?: LegacySnapshot | null; migrationWarnings?: string[] };
const FORMAT = "folio-backup";
const VERSION = 1;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_ITEMS = 10000;
const encoder = new TextEncoder();
const fail = (message: string): never => { throw new Error(`Backup inválido: ${message}`); };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail("objeto esperado");
  return v as Record<string, unknown>;
};
function str(v: unknown): asserts v is string { if (typeof v !== "string" || v.length > 50_000_000) fail("texto inválido"); }
function id(v: unknown): asserts v is string { str(v); if (!v || v.length > 500) fail("identificador inválido"); }
function bool(v: unknown) { if (typeof v !== "boolean") fail("booleano esperado"); }
function num(v: unknown) { if (!Number.isSafeInteger(v) || (v as number) < 0) fail("inteiro não negativo esperado"); }
function arr(v: unknown, validate: (v: unknown) => void): asserts v is unknown[] {
  if (!Array.isArray(v)) return fail("lista inválida");
  if (v.length > MAX_ITEMS) return fail("lista extensa demais");
  for (const item of v) validate(item);
}
const strings = (v: unknown) => arr(v, str);
const numbers = (v: unknown) => arr(v, num);
function choice(v: unknown, options: string[]) { if (!options.includes(v as string)) fail("valor não permitido"); }
const voice = (v: unknown) => choice(v, ["juízo", "parte", "parecer", "não identificada"]);
function acts(v: unknown, unique = true) {
  arr(v, (value) => {
    const a = obj(value);
    id(a.id);
    for (const key of ["title", "text", "documentId"]) str(a[key]);
    choice(a.nature, ["modelo", "ato", "extrato", "incompleto", "apoio"]);
    numbers(a.pdfPages); strings(a.printedPages); strings(a.cnj); strings(a.variantOf);
    if (a.warning !== null) str(a.warning);
    if (a.duplicateOf !== null) id(a.duplicateOf);
    voice(a.voice); choice(a.review, ["pendente", "revisada"]);
    arr(a.fields, (value) => {
      const f = obj(value);
      for (const key of ["key", "label", "value", "evidence", "origin"]) str(f[key]);
      choice(f.status, ["identificada", "sugerida", "indeterminada"]);
      choice(f.method, ["campo expresso", "regra local", "revisão humana"]);
    });
    const t = obj(a.template);
    for (const key of ["title", "purpose", "when", "text", "origin", "pages"]) str(t[key]);
    for (const key of ["requirements", "fields", "limits", "pending"]) strings(t[key]);
    num(t.version); voice(t.voice);
    arr(a.improvements, (value) => {
      const i = obj(value); id(i.id);
      for (const key of ["problem", "excerpt", "origin", "proposal", "reason"]) str(i[key]);
      choice(i.kind, ["editorial", "jurídica"]); choice(i.priority, ["alta", "média", "baixa"]);
    });
  });
  const ids = (v as { id: string }[]).map(a => a.id);
  if (unique && new Set(ids).size !== ids.length) fail("IDs de atos repetidos no mesmo estado");
}
function document(value: unknown, unique = true) {
  const d = obj(value); id(d.id);
  for (const key of ["filename", "addedAt", "faithful", "reading"]) str(d[key]);
  bool(d.hasPdf); bool(d.cleanupUndone);
  if (d.example !== undefined) bool(d.example);
  if (d.legacyId !== undefined) str(d.legacyId);
  if (d.storageWarning !== undefined) str(d.storageWarning);
  const q = obj(d.quality);
  if (q.pagesProcessed !== null) num(q.pagesProcessed);
  for (const key of ["emptyPages", "needsOcr"]) numbers(q[key]);
  for (const key of ["readingOrderRisks", "damagedTables", "illegible", "chromeSamples", "changes"]) strings(q[key]);
  bool(q.markersPresent); bool(q.integral);
  const p = obj(d.preserved);
  for (const key of ["orgao", "datas", "edicao", "processos", "assinaturas"]) strings(p[key]);
  acts(d.acts, unique);
  arr(d.history, value => { const h = obj(value); str(h.label); acts(h.acts, unique); });
}
function validateSnapshot(value: unknown, legacy = false): asserts value is LegacySnapshot {
  const s = obj(value); arr(s.docs, value => document(value, !legacy));
  arr(s.pdfs, value => {
    const p = obj(value); id(p.id);
    if (!(p.data instanceof Uint8Array) || p.data.byteLength > MAX_PDF_BYTES || (!legacy && !p.data.byteLength)) fail("PDF inválido ou grande demais");
  });
  if (legacy) return;
  const docs = s.docs as ArchiveDoc[], pdfs = s.pdfs as PdfRecord[];
  if (new Set(docs.map(d => d.id)).size !== docs.length || new Set(pdfs.map(p => p.id)).size !== pdfs.length) fail("IDs repetidos");
  const actOwners = new Map<string, string>();
  for (const d of docs) {
    for (const a of [...d.acts, ...d.history.flatMap(h => h.acts)]) {
      if (actOwners.has(a.id) && actOwners.get(a.id) !== d.id) fail("ID de ato compartilhado entre documentos");
      actOwners.set(a.id, d.id);
    }
    if (d.hasPdf && !pdfs.some(p => p.id === d.id)) fail(`PDF ausente: ${d.id}`);
  }
  if (pdfs.some(p => !docs.some(d => d.id === p.id && d.hasPdf))) fail("PDF sem documento correspondente");
}
function validateSource(value: unknown): asserts value is BackupSource {
  validateSnapshot(value);
  const s = value as BackupSource;
  if (s.legacy != null) validateSnapshot(s.legacy, true);
  if (s.migrationWarnings !== undefined) strings(s.migrationWarnings);
}
function base64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(raw);
}
function decode(value: unknown): Uint8Array {
  if (typeof value !== "string") return fail("base64 inválido");
  if (value.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail("base64 inválido");
  const raw = atob(value);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function hash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value));
function serializeSnapshot(s: LegacySnapshot) { return { docs: s.docs, pdfs: s.pdfs.map(p => ({ id: p.id, data: base64(p.data) })) }; }
function deserializeSnapshot(v: unknown): LegacySnapshot {
  const s = obj(v);
  arr(s.pdfs, value => { const p = obj(value); id(p.id); str(p.data); });
  return { docs: s.docs as ArchiveDoc[], pdfs: (s.pdfs as { id: string; data: string }[]).map(p => ({ id: p.id, data: decode(p.data) })) };
}
async function manifest(source: BackupSource) {
  const snapshot = async (s: LegacySnapshot) => ({
    docs: await Promise.all(s.docs.map(async d => ({ id: d.id, state: await hash(jsonBytes(d)), faithful: await hash(encoder.encode(d.faithful)), reading: await hash(encoder.encode(d.reading)) }))),
    pdfs: await Promise.all(s.pdfs.map(async p => ({ id: p.id, bytes: p.data.byteLength, sha256: await hash(p.data) }))),
  });
  return { active: await snapshot(source), legacy: source.legacy ? await snapshot(source.legacy) : null };
}
/** Portable local file, NOT encrypted. Hashes detect corruption, not malicious replacement of the entire file. */
export async function createBackup(source: BackupSource): Promise<Uint8Array> {
  validateSource(source);
  // Freeze a point-in-time snapshot before asynchronous hashing.
  source = structuredClone(source);
  const payload = { ...serializeSnapshot(source), ...(source.legacy !== undefined ? { legacy: source.legacy ? serializeSnapshot(source.legacy) : null } : {}), ...(source.migrationWarnings !== undefined ? { migrationWarnings: source.migrationWarnings } : {}) };
  const result = jsonBytes({ format: FORMAT, version: VERSION, manifest: await manifest(source), payloadSha256: await hash(jsonBytes(payload)), payload });
  if (result.byteLength > MAX_BACKUP_BYTES) fail("arquivo excede 200 MiB");
  return result;
}
export async function readBackup(bytes: Uint8Array): Promise<BackupSource> {
  if (!bytes.length || bytes.length > MAX_BACKUP_BYTES) fail("tamanho do arquivo");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail("JSON ou UTF-8 inválido"); }
  const e = obj(parsed);
  if (e.format !== FORMAT || e.version !== VERSION) fail("formato ou versão não suportada");
  if (await hash(jsonBytes(e.payload)) !== e.payloadSha256) fail("hash do conteúdo divergente");
  const p = obj(e.payload);
  const source: BackupSource = { ...deserializeSnapshot(p), ...(p.legacy !== undefined ? { legacy: p.legacy === null ? null : deserializeSnapshot(p.legacy) } : {}), ...(p.migrationWarnings !== undefined ? { migrationWarnings: p.migrationWarnings as string[] } : {}) };
  validateSource(source);
  if (JSON.stringify(await manifest(source)) !== JSON.stringify(e.manifest)) fail("manifesto divergente");
  return source;
}
export function previewBackup(current: ArchiveDoc[], incoming: BackupSource) {
  validateSource(incoming);
  const currentIds = new Set(current.map(d => d.id));
  const conflicts = incoming.docs.filter(d => currentIds.has(d.id)).map(d => ({ id: d.id, filename: d.filename, currentFilename: current.find(c => c.id === d.id)!.filename }));
  return { documents: incoming.docs.length, pdfs: incoming.pdfs.length, newDocuments: incoming.docs.length - conflicts.length, conflicts, legacyDocuments: incoming.legacy?.docs.length ?? 0, warnings: incoming.migrationWarnings ?? [] };
}
/** Only ID conflicts are replaced. All inputs are left untouched. */
export function planRestore(current: BackupSource, incoming: BackupSource, policy: "keep" | "copy" | "replace"): BackupSource {
  validateSource(current); validateSource(incoming);
  if (!["keep", "copy", "replace"].includes(policy)) fail("política de conflito obrigatória");
  const currentIds = new Set(current.docs.map(d => d.id));
  const selected = incoming.docs.filter(d => policy !== "keep" || !currentIds.has(d.id));
  const replacing = new Set(policy === "replace" ? selected.map(d => d.id) : []);
  const retained = current.docs.filter(d => !replacing.has(d.id));
  const occupiedActs = new Set(retained.flatMap(d => [...d.acts, ...d.history.flatMap(h => h.acts)].map(a => a.id)));
  const docMap = new Map<string, string>();
  const localMaps = new Map<string, Map<string, string>>();
  for (const d of selected) {
    docMap.set(d.id, policy === "copy" && currentIds.has(d.id) ? crypto.randomUUID() : d.id);
    const map = new Map<string, string>();
    for (const a of [...d.acts, ...d.history.flatMap(h => h.acts)]) {
      if (!map.has(a.id)) { const next = occupiedActs.has(a.id) || docMap.get(d.id) !== d.id ? crypto.randomUUID() : a.id; map.set(a.id, next); occupiedActs.add(next); }
    }
    localMaps.set(d.id, map);
  }
  const globalMap = new Map<string, string>();
  for (const map of localMaps.values()) for (const [before, after] of map) globalMap.set(before, after);
  const imported = selected.map(d => {
    const copy = structuredClone(d), local = localMaps.get(d.id)!;
    const reference = (ref: string) => local.get(ref) ?? globalMap.get(ref) ?? ref;
    copy.id = docMap.get(d.id)!;
    for (const a of [...copy.acts, ...copy.history.flatMap(h => h.acts)]) {
      a.id = local.get(a.id)!;
      a.duplicateOf = a.duplicateOf === null ? null : reference(a.duplicateOf);
      a.variantOf = a.variantOf.map(reference);
    }
    return copy;
  });
  // Salvaguardas brutas são acumuladas: jamais substituir uma por outra.
  const legacyParts = [current.legacy, incoming.legacy].filter((s): s is LegacySnapshot => !!s);
  const result: BackupSource = {
    docs: [...structuredClone(retained), ...imported],
    pdfs: [...current.pdfs.filter(p => !replacing.has(p.id)).map(p => ({ id: p.id, data: p.data.slice() })), ...incoming.pdfs.filter(p => docMap.has(p.id)).map(p => ({ id: docMap.get(p.id)!, data: p.data.slice() }))],
    ...(legacyParts.length ? { legacy: { docs: legacyParts.flatMap(s => structuredClone(s.docs)), pdfs: legacyParts.flatMap(s => s.pdfs.map(p => ({ id: p.id, data: p.data.slice() }))) } } : {}),
    ...((current.migrationWarnings || incoming.migrationWarnings) ? { migrationWarnings: [...new Set([...(current.migrationWarnings ?? []), ...(incoming.migrationWarnings ?? [])])] } : {}),
  };
  validateSource(result);
  return result;
}
