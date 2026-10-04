import type { ArchiveDoc } from "./types.ts";
import { assertArchive, migrateIdentities } from "./identity.ts";
const DB_NAME = "folio-acervo", DB_VERSION = 2;
const STORES = ["docs", "pdfs", "meta", "legacy"];
export type PdfRecord = { id: string; data: Uint8Array };
export type LegacySnapshot = { docs: ArchiveDoc[]; pdfs: PdfRecord[] };
export type VaultSnapshot = { docs: ArchiveDoc[]; pdfs: PdfRecord[]; revision: number; generation: string; migrationWarnings: string[]; legacy: LegacySnapshot | null };
type Meta = { revision: number; generation: string; migrationWarnings: string[] };
export class VaultConflictError extends Error {
  constructor() { super("O acervo mudou em outra aba. Suas alterações não sobrescreveram o acervo guardado. Faça um backup das alterações e recarregue antes de continuar."); this.name = "VaultConflictError"; }
}
export class MissingPdfError extends Error {
  constructor(filename: string) { super(`O PDF de ${filename} não está disponível. A última cópia guardada foi preservada; a alteração não foi confirmada.`); this.name = "MissingPdfError"; }
}
export function keepable(docs: ArchiveDoc[]): ArchiveDoc[] { return docs.filter((doc) => !doc.example); }
export function shouldWrite(docs: ArchiveDoc[]): boolean { return keepable(docs).length > 0 || !docs.some((doc) => doc.example); }
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => { for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store); };
    request.onblocked = () => { blocked = true; reject(new Error("Feche as abas antigas do Fólio para atualizar o arquivo local. Nenhum dado foi apagado.")); };
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o acervo local."));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); if (blocked) db.close(); else resolve(db); };
  });
}
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("Falha no arquivo local.")); });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("Gravação cancelada. A última cópia foi preservada.")); tx.onerror = () => {}; });
}
function transaction(db: IDBDatabase): IDBTransaction {
  try { return db.transaction(STORES, "readwrite", { durability: "strict" }); }
  catch (error) { if (error instanceof TypeError) return db.transaction(STORES, "readwrite"); throw error; }
}
async function read(tx: IDBTransaction): Promise<VaultSnapshot> {
  // Enqueue all requests before awaiting, also on engines closing idle transactions.
  const [docs, ids, buffers, meta, legacy] = await Promise.all([
    done(tx.objectStore("docs").get("archive")), done(tx.objectStore("pdfs").getAllKeys()), done(tx.objectStore("pdfs").getAll()),
    done(tx.objectStore("meta").get("state")), done(tx.objectStore("legacy").get("original")),
  ]);
  const archive = docs === undefined ? [] : docs as ArchiveDoc[];
  assertArchive(archive, false);
  const pdfs = ids.map((id, index) => { if (!(buffers[index] instanceof ArrayBuffer)) throw new Error("Um PDF guardado está inválido. Nada foi substituído."); return { id: String(id), data: new Uint8Array(buffers[index]) }; });
  const state = meta as Meta | undefined;
  if (state && (!Number.isSafeInteger(state.revision) || state.revision < 1 || typeof state.generation !== "string" || !state.generation || !Array.isArray(state.migrationWarnings))) throw new Error("A versão do acervo local está inválida. Nada foi substituído.");
  return { docs: archive, pdfs, revision: state?.revision ?? 0, generation: state?.generation ?? "", migrationWarnings: state?.migrationWarnings ?? [], legacy: legacy ?? null };
}
function write(tx: IDBTransaction, snapshot: VaultSnapshot): void {
  tx.objectStore("docs").put(snapshot.docs, "archive");
  const pdfs = tx.objectStore("pdfs"); pdfs.clear();
  for (const pdf of snapshot.pdfs) pdfs.put(Uint8Array.from(pdf.data).buffer, pdf.id);
  tx.objectStore("meta").put({ revision: snapshot.revision, generation: snapshot.generation, migrationWarnings: snapshot.migrationWarnings }, "state");
  if (snapshot.legacy) tx.objectStore("legacy").put(snapshot.legacy, "original"); else tx.objectStore("legacy").delete("original");
}
async function atomic<T>(action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = transaction(db), complete = transactionDone(tx); void complete.catch(() => undefined);
    try { const value = await action(tx); await complete; return value; }
    catch (error) { try { tx.abort(); } catch {} await complete.catch(() => undefined); throw error; }
  } finally { db.close(); }
}
export async function loadVault(): Promise<VaultSnapshot> {
  return atomic(async (tx) => {
    const snapshot = await read(tx);
    if (snapshot.revision) {
      assertArchive(snapshot.docs);
      for (const doc of snapshot.docs) if (doc.hasPdf && !snapshot.pdfs.some(pdf => pdf.id === doc.id && pdf.data.byteLength)) {
        throw new MissingPdfError(doc.filename);
      }
      return snapshot;
    }
    const migrated = migrateIdentities(snapshot.docs), byId = new Map(snapshot.pdfs.map((pdf) => [pdf.id, pdf.data]));
    const pdfs: PdfRecord[] = [];
    for (let i = 0; i < migrated.docs.length; i++) {
      const doc = migrated.docs[i]; if (!doc.hasPdf) continue;
      const data = byId.get(snapshot.docs[i].id);
      if (data?.byteLength) pdfs.push({ id: doc.id, data });
      else { doc.hasPdf = false; doc.storageWarning = "PDF já ausente no acervo legado. O texto e a salvaguarda bruta foram preservados; o PDF não foi reconstruído."; migrated.warnings.push(`${doc.filename}: ${doc.storageWarning}`); }
    }
    const next: VaultSnapshot = { ...snapshot, docs: migrated.docs, pdfs, revision: 1, generation: crypto.randomUUID(), migrationWarnings: migrated.warnings,
      legacy: snapshot.docs.length || snapshot.pdfs.length ? { docs: snapshot.docs, pdfs: snapshot.pdfs } : null };
    write(tx, next); return next;
  });
}
export async function saveVault(docs: ArchiveDoc[], pdfOf: (id: string) => Uint8Array | undefined, expected: Pick<VaultSnapshot, "revision" | "generation">,
  extras?: { legacy?: LegacySnapshot | null; migrationWarnings?: string[] }): Promise<VaultSnapshot> {
  const kept = structuredClone(keepable(docs)); assertArchive(kept);
  return atomic(async (tx) => {
    const previous = await read(tx);
    if (!previous.revision || (previous.revision !== expected.revision || previous.generation !== expected.generation)) throw new VaultConflictError();
    if (!shouldWrite(docs)) return previous;
    const existing = new Map(previous.pdfs.map((pdf) => [pdf.id, pdf.data]));
    const pdfs = kept.filter((doc) => doc.hasPdf).map((doc) => { const data = pdfOf(doc.id) ?? existing.get(doc.id); if (!data?.byteLength) throw new MissingPdfError(doc.filename); return { id: doc.id, data: data.slice() }; });
    const next: VaultSnapshot = { docs: kept, pdfs, revision: previous.revision + 1, generation: previous.generation, legacy: extras?.legacy === undefined ? previous.legacy : extras.legacy, migrationWarnings: extras?.migrationWarnings ?? previous.migrationWarnings };
    write(tx, next); return next;
  });
}
export async function clearVault(expected: Pick<VaultSnapshot, "revision" | "generation">): Promise<VaultSnapshot> { return saveVault([], () => undefined, expected, { legacy: null, migrationWarnings: [] }); }
export class VaultWriter {
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  public snapshot: VaultSnapshot;
  constructor(snapshot: VaultSnapshot) { this.snapshot = snapshot; }
  save(docs: ArchiveDoc[], pdfOf: (id: string) => Uint8Array | undefined,
    extras?: { legacy?: LegacySnapshot | null; migrationWarnings?: string[] }): Promise<VaultSnapshot> {
    const captured = structuredClone(docs), bytes = new Map(captured.filter((doc) => doc.hasPdf).map((doc) => [doc.id, pdfOf(doc.id)?.slice()]));
    const operation = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      try { const saved = await saveVault(captured, (id) => bytes.get(id), this.snapshot, extras); this.snapshot = saved; return saved; }
      catch (error) { this.failure = error; throw error; }
    });
    this.tail = operation.then(() => undefined, () => undefined); return operation;
  }
  async flush(): Promise<VaultSnapshot> { await this.tail; if (this.failure) throw this.failure; return this.snapshot; }
  retry(): void { this.failure = null; }
}
