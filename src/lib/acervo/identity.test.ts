import assert from "node:assert/strict";
import test from "node:test";
import { ingestDocument } from "./pipeline.ts";
import { assertArchive, migrateIdentities } from "./identity.ts";

const fictional = (id?: string) => ingestDocument({ filename: "ficticio.md", faithful: "DESPACHO\n\nTexto fictício.", reading: "DESPACHO\n\nTexto fictício.", hasPdf: false }, id);
test("identidades independem de contador e exemplos", () => {
  const docs = Array.from({ length: 100 }, () => fictional());
  assert.equal(new Set(docs.map(d => d.id)).size, 100);
  assert.ok(docs.every(d => /^doc-/.test(d.id)));
  assertArchive(docs);
});
test("migração preserva todos os textos, revisões e histórico das colisões", () => {
  const a = fictional("d1"), b = fictional("d1");
  b.faithful = "Outro texto fictício"; b.acts[0].review = "revisada";
  b.history.push({ label: "histórico fictício", acts: structuredClone(b.acts) });
  const original = structuredClone([a, b]);
  const migrated = migrateIdentities([a, b]);
  assert.deepEqual([a, b], original);
  assert.equal(migrated.docs.length, 2);
  assert.notEqual(migrated.docs[0].id, migrated.docs[1].id);
  assert.notEqual(migrated.docs[0].acts[0].id, migrated.docs[1].acts[0].id);
  assert.equal(migrated.docs[1].faithful, b.faithful);
  assert.equal(migrated.docs[1].acts[0].review, "revisada");
  assert.equal(migrated.docs[1].history[0].acts[0].id, migrated.docs[1].acts[0].id);
  assert.equal(migrated.docs[1].legacyId, "d1");
  assertArchive(migrated.docs);
});
test("migração conserva IDs únicos já existentes", () => {
  const doc = fictional("antigo-unico");
  assert.deepEqual(migrateIdentities([doc]), { docs: [doc], warnings: [] });
});
test("estrutura corrompida não vira acervo vazio", () => {
  assert.throws(() => migrateIdentities({} as never), /inválido/);
  assert.throws(() => migrateIdentities([{ id: "a" }] as never), /inválido/);
});
test("migração remapeia vínculos cruzados unívocos e sinaliza os ambíguos", () => {
  const a = fictional("d1"), b = fictional("d1"), c = fictional("d3");
  b.acts[0].id = "ato-b-unico";
  c.acts[0].variantOf = ["ato-b-unico"];
  const fixed = migrateIdentities([a, b, c]);
  assert.deepEqual(fixed.docs[2].acts[0].variantOf, [fixed.docs[1].acts[0].id]);
  b.acts[0].id = a.acts[0].id;
  c.acts[0].duplicateOf = a.acts[0].id;
  const ambiguous = migrateIdentities([a, b, c]);
  assert.equal(ambiguous.docs[2].acts[0].duplicateOf, null);
  assert.ok(ambiguous.warnings.some(w => w.includes("ambíguo")));
});
