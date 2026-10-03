import type { ArchiveDoc } from "./types.ts";

const DB_NAME = "folio-acervo";
const DB_VERSION = 1;

export function keepable(docs: ArchiveDoc[]): ArchiveDoc[] {
  return docs.filter((doc) => !doc.example);
}

/** Exemplos sozinhos não apagam o que já foi guardado. Lista vazia de verdade apaga. */
export function shouldWrite(docs: ArchiveDoc[]): boolean {
  return keepable(docs).length > 0 || !docs.some((doc) => doc.example);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs");
      if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("não abriu o arquivo local"));
  });
}

function done(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("falha ao gravar"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("falha ao gravar"));
    tx.onabort = () => reject(tx.error ?? new Error("gravação cancelada"));
  });
}

async function write(docs: ArchiveDoc[], pdfs: { id: string; data: Uint8Array }[]): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(["docs", "pdfs"], "readwrite");
    tx.objectStore("docs").put(docs, "archive");
    const pdfStore = tx.objectStore("pdfs");
    pdfStore.clear();
    for (const pdf of pdfs) pdfStore.put(pdf.data.buffer.slice(pdf.data.byteOffset, pdf.data.byteOffset + pdf.data.byteLength), pdf.id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function saveVault(docs: ArchiveDoc[], pdfOf: (id: string) => Uint8Array | undefined): Promise<"ok" | "sem-pdf" | "ignorado"> {
  if (!shouldWrite(docs)) return "ignorado";
  const kept = keepable(docs);
  const pdfs = kept.flatMap((doc) => {
    if (!doc.hasPdf) return [];
    const data = pdfOf(doc.id);
    return data ? [{ id: doc.id, data }] : [];
  });
  try {
    await write(kept, pdfs);
    return "ok";
  } catch {
    await write(kept.map((doc) => ({ ...doc, hasPdf: false })), []);
    return "sem-pdf";
  }
}

export async function loadVault(): Promise<{ docs: ArchiveDoc[]; pdfs: { id: string; data: Uint8Array }[] }> {
  const db = await openDb();
  try {
    const tx = db.transaction(["docs", "pdfs"], "readonly");
    const stored = (await done(tx.objectStore("docs").get("archive"))) as ArchiveDoc[] | undefined;
    const ids = (await done(tx.objectStore("pdfs").getAllKeys())) as IDBValidKey[];
    const buffers = (await done(tx.objectStore("pdfs").getAll())) as ArrayBuffer[];
    const pdfs = ids.map((id, index) => ({ id: String(id), data: new Uint8Array(buffers[index]) }));
    return { docs: Array.isArray(stored) ? stored : [], pdfs };
  } finally {
    db.close();
  }
}

export async function clearVault(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(["docs", "pdfs"], "readwrite");
    tx.objectStore("docs").clear();
    tx.objectStore("pdfs").clear();
    await transactionDone(tx);
  } finally {
    db.close();
  }
}
