import type { ArchiveDoc, Act } from "./types.ts";

export function archiveId(): string { return `doc-${crypto.randomUUID()}`; }

export function assertArchive(docs: ArchiveDoc[], unique = true): void {
  if (!Array.isArray(docs)) throw new Error("O acervo local está inválido. Nada foi substituído.");
  const ids = new Set<string>(), acts = new Set<string>();
  for (const doc of docs) {
    if (!doc || typeof doc.id !== "string" || !doc.id || typeof doc.filename !== "string" ||
        typeof doc.faithful !== "string" || typeof doc.reading !== "string" || typeof doc.hasPdf !== "boolean" ||
        !Array.isArray(doc.acts) || !Array.isArray(doc.history) || !doc.quality || !doc.preserved) {
      throw new Error("Um documento local está inválido. Nada foi substituído.");
    }
    if (unique && ids.has(doc.id)) throw new Error("Há IDs repetidos no acervo. Nada foi substituído.");
    ids.add(doc.id);
    for (const act of doc.acts) {
      if (!act || typeof act.id !== "string" || !act.id || typeof act.text !== "string" || !Array.isArray(act.fields) || !act.template) throw new Error("Um ato local está inválido. Nada foi substituído.");
      if (unique && acts.has(act.id)) throw new Error("Há IDs de atos repetidos. Nada foi substituído.");
      acts.add(act.id);
    }
  }
}

/** The raw legacy snapshot remains in vault in addition to this migration. */
export function migrateIdentities(input: ArchiveDoc[]): { docs: ArchiveDoc[]; warnings: string[] } {
  assertArchive(input, false);
  const docs = structuredClone(input), warnings: string[] = [];
  const counts = new Map<string, number>();
  for (const doc of docs) counts.set(doc.id, (counts.get(doc.id) ?? 0) + 1);
  const usedDocs = new Set<string>(), usedActs = new Set<string>();
  const global = new Map<string, Set<string>>();
  for (const doc of docs) {
    const old = doc.id, collision = (counts.get(old) ?? 0) > 1;
    if (usedDocs.has(old)) doc.id = archiveId();
    usedDocs.add(doc.id);
    if (collision) {
      doc.legacyId = old;
      doc.storageWarning = doc.hasPdf
        ? "ID legado repetido: o PDF guardado foi preservado, mas seu vínculo com esta peça precisa ser conferido. PDFs já sobrescritos não podem ser reconstruídos."
        : "ID legado repetido: todos os textos disponíveis foram preservados com identidades separadas.";
      warnings.push(`${doc.filename}: ${doc.storageWarning}`);
    }
    const local = new Map<string, string>(), current = new Set<string>();
    const assign = (act: Act, active: boolean) => {
      const previous = act.id;
      const repeated = active && current.has(previous);
      let next = local.get(previous);
      if (!next || repeated) {
        next = usedActs.has(previous) || doc.id !== old || repeated ? `${doc.id}-act-${crypto.randomUUID()}` : previous;
        usedActs.add(next);
        if (!local.has(previous)) local.set(previous, next);
      }
      if (active) current.add(previous);
      act.id = next;
      const values = global.get(previous) ?? new Set<string>(); values.add(next); global.set(previous, values);
      if (repeated) warnings.push(`${doc.filename}: atos com ID legado repetido foram separados; confira o histórico.`);
    };
    doc.acts.forEach(act => assign(act, true));
    for (const history of doc.history) history.acts.forEach(act => assign(act, false));
  }
  for (const doc of docs) {
    const reference = (previous: string): string | null => {
      const values = global.get(previous);
      if (!values) return previous;
      if (values.size === 1) return [...values][0];
      warnings.push(`${doc.filename}: vínculo legado ambíguo (${previous}) não foi tratado como confirmado. A salvaguarda bruta conserva a referência original.`);
      return null;
    };
    for (const act of [...doc.acts, ...doc.history.flatMap(history => history.acts)]) {
      act.duplicateOf = act.duplicateOf ? reference(act.duplicateOf) : null;
      act.variantOf = act.variantOf.map(reference).filter((id): id is string => id !== null);
    }
  }
  assertArchive(docs);
  return { docs, warnings };
}
