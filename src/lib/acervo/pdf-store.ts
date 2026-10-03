const store = new Map<string, Uint8Array>();

export function rememberPdf(id: string, data: Uint8Array): void {
  store.set(id, data.slice());
}

export function pdfBytes(id: string): Uint8Array | undefined {
  const data = store.get(id);
  return data ? data.slice() : undefined;
}

export function retainPdfs(ids: Iterable<string>): void {
  const keep = new Set(ids);
  for (const id of [...store.keys()]) {
    if (!keep.has(id)) store.delete(id);
  }
}
