import test from "node:test";
import assert from "node:assert/strict";
import { createBackup, readBackup, planRestore, previewBackup, type BackupSource } from "./backup.ts";
import { ingestDocument } from "./pipeline.ts";
const bytes = new Uint8Array([37,80,68,70,45,49,10,0,255]);
function source(id = "ficticio-a", pdf = true): BackupSource {
  const d = ingestDocument({ filename: "FICTICIO.pdf", faithful: "DECISÃO FICTÍCIA\nTexto de teste sem documentos reais.\n", reading: "DECISÃO FICTÍCIA\nTexto de teste sem documentos reais.\n", hasPdf: pdf }, id);
  d.acts[0].review = "revisada";
  d.history.push({ label: "Revisão fictícia", acts: structuredClone(d.acts) });
  d.acts[0].variantOf = [d.acts[0].id];
  return { docs: [d], pdfs: pdf ? [{ id, data: bytes.slice() }] : [] };
}
test("backup completo conserva exatamente textos, estados, histórico e bytes PDF", async () => {
  const s = source(); s.migrationWarnings = ["fictício"];
  s.legacy = { docs: [structuredClone(s.docs[0]), structuredClone(s.docs[0])], pdfs: [{ id: "órfão", data: bytes.slice() }] };
  s.legacy.docs[0].acts.push(structuredClone(s.legacy.docs[0].acts[0]));
  s.legacy.pdfs.push({ id: "legado-vazio", data: new Uint8Array() });
  assert.deepEqual(await readBackup(await createBackup(s)), s);
});
test("hash rejeita mudança de um byte PDF, texto, manifesto ou estado", async () => {
  const b = await createBackup(source());
  for (const change of [(e: any) => e.payload.docs[0].reading += "x", (e: any) => e.payload.pdfs[0].data = "AAAA", (e: any) => e.manifest.active.docs[0].state = "bad", (e: any) => e.payload.docs[0].acts[0].review = "pendente"]) {
    const e = JSON.parse(new TextDecoder().decode(b)); change(e);
    await assert.rejects(readBackup(new TextEncoder().encode(JSON.stringify(e))), /hash|manifesto/);
  }
});
test("rejeita IDs repetidos, PDF ausente e estrutura nested inválida", async () => {
  const s = source();
  await assert.rejects(createBackup({ ...s, docs: [...s.docs, structuredClone(s.docs[0])] }), /IDs repetidos/);
  await assert.rejects(createBackup({ ...s, pdfs: [] }), /PDF ausente/);
  for (const change of [(s: any) => s.docs[0].acts[0].fields[0].status = "inventado", (s: any) => s.docs[0].quality.emptyPages = [-1], (s: any) => s.docs[0].history[0].acts[0].template.voice = "inválida"]) {
    const bad = structuredClone(s); change(bad); await assert.rejects(createBackup(bad), /Backup inválido/);
  }
});
test("não aceita versão futura, UTF8 inválido nem arquivo acima do limite", async () => {
  const e = JSON.parse(new TextDecoder().decode(await createBackup(source()))); e.version = 999;
  await assert.rejects(readBackup(new TextEncoder().encode(JSON.stringify(e))), /versão/);
  await assert.rejects(readBackup(new Uint8Array([255,255])), /UTF-8/);
  await assert.rejects(readBackup(new Uint8Array(200 * 1024 * 1024 + 1)), /tamanho/);
});
test("prévia identifica conflitos e keep/copy/replace são explícitos e preservam entradas", () => {
  const a = source(), b = source(); b.docs[0].filename = "incoming-ficticio.pdf";
  const before = structuredClone(a), incomingBefore = structuredClone(b);
  assert.equal(previewBackup(a.docs, b).conflicts.length, 1);
  const keep = planRestore(a,b,"keep"); assert.equal(keep.docs.length,1); assert.equal(keep.docs[0].filename,a.docs[0].filename);
  const replace = planRestore(a,b,"replace"); assert.equal(replace.docs.length,1); assert.equal(replace.docs[0].filename,b.docs[0].filename);
  const copy = planRestore(a,b,"copy"); assert.equal(copy.docs.length,2); assert.notEqual(copy.docs[1].id,b.docs[0].id);
  assert.notEqual(copy.docs[1].acts[0].id,a.docs[0].acts[0].id);
  assert.equal(copy.docs[1].history[0].acts[0].id,copy.docs[1].acts[0].id);
  assert.equal(copy.docs[1].acts[0].variantOf[0],copy.docs[1].acts[0].id);
  assert.equal(copy.pdfs[1].id,copy.docs[1].id);
  assert.deepEqual(a,before); assert.deepEqual(b,incomingBefore);
});
test("replace não apaga itens não conflitantes; importação remapeia colisão de ato", () => {
  const a = source(), extra = source("extra");
  const current = { docs: [...a.docs,...extra.docs], pdfs: [...a.pdfs,...extra.pdfs] };
  const incoming = source(); incoming.docs[0].filename = "Substituto.pdf";
  assert.deepEqual(planRestore(current,incoming,"replace").docs[0],extra.docs[0]);
  const other = source("outro"); other.docs[0].acts[0].id = a.docs[0].acts[0].id; other.docs[0].history = [];
  const merged = planRestore(a,other,"keep"); assert.notEqual(merged.docs[1].acts[0].id,a.docs[0].acts[0].id);
});
test("restaura perfil vazio com o estado completo; acumula salvaguardas sem descartar PDFs", async () => {
  const s = source();
  assert.deepEqual(planRestore({docs:[],pdfs:[]},await readBackup(await createBackup(s)),"keep"),s);
  s.legacy = {docs:[structuredClone(s.docs[0])],pdfs:[{id:s.docs[0].id,data:bytes.slice()}]};
  const restored = planRestore(s,s,"keep"); assert.equal(restored.legacy!.docs.length,2); assert.equal(restored.legacy!.pdfs.length,2);
});
