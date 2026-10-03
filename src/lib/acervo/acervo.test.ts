import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dehyphenateAllowed } from "./hyphen.ts";
import { fieldValue } from "./classify.ts";
import { ingestDocument, linkDuplicates, mergeWithNext, splitAct } from "./pipeline.ts";
import { archiveZip } from "./zip.ts";
import { keepable, shouldWrite } from "./vault.ts";
import { UNKNOWN } from "./types.ts";

const P1 = "0600001-23.2026.6.14.0002";
const P2 = "0600005-94.2025.6.14.0002";
const P3 = "0600010-11.2024.6.14.0001";
const P4 = "0600020-22.2024.6.14.0003";
const P5 = "0600021-07.2024.6.14.0003";
const P6 = "0600100-85.2026.6.14.0004";
const P7 = "0600099-10.2022.6.14.0004";
const P8 = "0600030-51.2024.6.14.0008";
const P9 = "0600031-36.2024.6.14.0008";

function doc(name: string, reading: string, faithful = reading) {
  return ingestDocument({ filename: name, faithful, reading, hasPdf: name.endsWith(".pdf") });
}

test("não remove hífen de número, código ou composta", () => {
  assert.equal(dehyphenateAllowed("autos 0600001-", "23.2026"), false);
  assert.equal(dehyphenateAllowed("guarda-", "chuva e o mais"), false);
  assert.equal(dehyphenateAllowed("a apre-", "sentação da conta"), false);
  assert.equal(dehyphenateAllowed("jurisdi-", "ção eleitoral restante"), true);
});

test("dois atos de processos diferentes na mesma página", () => {
  const reading = `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte.\n\nDECISÃO\n\nProcesso ${P2}\n\nJulgo procedente o pedido.\n`;
  const archive = doc("ficticio.md", reading);
  assert.equal(archive.acts.length, 2);
  assert.deepEqual(archive.acts[0].cnj, [P1]);
  assert.deepEqual(archive.acts[1].cnj, [P2]);
  assert.equal(archive.acts[0].pdfPages[0], 1);
  assert.ok(!archive.acts[0].text.includes(P2));
});

test("um ato em duas páginas", () => {
  const reading = `<!-- página 1 -->\n\nSENTENÇA\n\nProcesso ${P3}\n\nO juízo examina a prova produzida na zona eleitoral.\n\n<!-- página 2 -->\n\nPelo exposto, julgo improcedente o pedido.\n`;
  const archive = doc("sentenca.md", reading);
  assert.equal(archive.acts.length, 1);
  assert.deepEqual(archive.acts[0].pdfPages, [1, 2]);
  assert.match(archive.acts[0].text, /improcedente/);
});

test("PCA e contas eleitorais não se misturam", () => {
  const reading = `<!-- página 1 -->\n\nPRESTAÇÃO DE CONTAS ANUAL\n\nProcesso ${P1}\n\nExercício 2025. Contas do órgão partidário.\n\nPRESTAÇÃO DE CONTAS ELEITORAIS\n\nProcesso ${P2}\n\nContas de campanha das Eleições 2024.\n`;
  const archive = doc("contas.md", reading);
  assert.equal(archive.acts.length, 2);
  assert.equal(fieldValue(archive.acts[0].fields, "classe"), "prestação de contas anual partidária");
  assert.equal(fieldValue(archive.acts[1].fields, "classe"), "prestação de contas eleitorais");
  assert.equal(fieldValue(archive.acts[0].fields, "exercicio"), "2025");
  assert.equal(fieldValue(archive.acts[1].fields, "eleicao"), "2024");
  assert.equal(fieldValue(archive.acts[0].fields, "eleicao"), UNKNOWN);
  assert.notEqual(fieldValue(archive.acts[0].fields, "classe"), fieldValue(archive.acts[0].fields, "rito"));
});

test("representações com objetos diferentes", () => {
  const reading = `<!-- página 4 -->\n\nREPRESENTAÇÃO\n\nProcesso ${P4}\n\nRepresentação por propaganda irregular antecipada.\n\nREPRESENTAÇÃO\n\nProcesso ${P5}\n\nRepresentação por captação ilícita de sufrágio.\n`;
  const archive = doc("reps.md", reading);
  assert.equal(archive.acts.length, 2);
  assert.equal(fieldValue(archive.acts[0].fields, "classe"), "representação");
  assert.equal(fieldValue(archive.acts[1].fields, "classe"), "representação");
  assert.notEqual(fieldValue(archive.acts[0].fields, "assunto"), fieldValue(archive.acts[1].fields, "assunto"));
  assert.equal(fieldValue(archive.acts[0].fields, "rito"), UNKNOWN);
  assert.match(archive.acts[0].fields.find((item) => item.key === "assunto")?.evidence ?? "", /propaganda/i);
});

test("cumprimento de sentença não vira a ação originária", () => {
  const reading = `<!-- página 5 -->\n\nDESPACHO\n\nCumprimento de sentença originado da AIJE ${P7}.\n\nProcesso ${P6}\n\nIntime-se para pagamento.\n`;
  const archive = doc("cumprimento.md", reading);
  assert.equal(archive.acts.length, 1);
  assert.equal(fieldValue(archive.acts[0].fields, "classe"), "cumprimento de sentença");
  assert.match(fieldValue(archive.acts[0].fields, "subtipo"), /AIJE/);
  assert.notEqual(fieldValue(archive.acts[0].fields, "classe"), "AIJE");
  assert.ok(archive.acts[0].cnj.includes(P6));
});

test("extrato do DJE não vira decisão integral", () => {
  const reading = `<!-- página 8 -->\n\nEXTRATO DE DESPACHO\n\nProcesso ${P1}\n\nInteressado: Maria Souza\n\nAdvogado: João Lima\n`;
  const archive = doc("dje.md", reading);
  assert.equal(archive.acts[0].nature, "extrato");
  assert.match(archive.acts[0].template.limits.join(" "), /não é a decisão integral/i);
  assert.ok(archive.acts[0].improvements.some((item) => item.kind === "jurídica" && /extrato/i.test(item.problem)));
  assert.equal(archive.acts[0].template.text.includes("Maria Souza"), false);
});

test("página sem texto pede OCR e não declara leitura integral", () => {
  const reading = `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se.\n\n<!-- página 2 -->\n\n`;
  const archive = doc("scan.pdf", reading, reading);
  assert.deepEqual(archive.quality.emptyPages, [2]);
  assert.deepEqual(archive.quality.needsOcr, [2]);
  assert.equal(archive.quality.integral, false);
  assert.equal(archive.acts.length, 1);
});

test("markdown sem marcador não inventa página", () => {
  const reading = `DESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte.\n`;
  const archive = doc("solto.md", reading);
  assert.equal(archive.quality.markersPresent, false);
  assert.equal(archive.quality.pagesProcessed, null);
  assert.deepEqual(archive.acts[0].pdfPages, []);
  assert.match(archive.quality.changes.join(" "), /reconstituída/i);
  assert.equal(archive.acts[0].documentId, UNKNOWN);
});

test("modelos semelhantes permanecem e a duplicata exata não é apagada", () => {
  const common = "O juízo determina a manifestação da parte interessada no prazo de cinco dias, com vista dos autos.";
  const reading = `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P8}\n\n${common}\n\nIntime-se.\n\nDESPACHO\n\nProcesso ${P9}\n\n${common}\n\nCite-se.\n\nDESPACHO\n\nProcesso ${P8}\n\n${common}\n\nIntime-se.\n`;
  const linked = linkDuplicates([doc("dup.md", reading)]);
  const acts = linked[0].acts;
  assert.equal(acts.length, 3);
  assert.ok(acts[1].variantOf.includes(acts[0].id));
  assert.equal(acts[2].duplicateOf, acts[0].id);
  assert.ok(acts[2].text.length > 0);
});

test("citação de precedente não vira campo nem novo ato", () => {
  const reading = `<!-- página 1 -->\n\nDECISÃO\n\nProcesso ${P1}\n\nJulgo procedente.\n\nJurisprudência citada: TRE-PA, Rel. Des. Paulo Cesar, ${P2}.\n`;
  const archive = doc("cit.md", reading);
  assert.equal(archive.acts.length, 1);
  assert.ok(archive.acts[0].template.text.includes(P2));
  assert.ok(archive.acts[0].template.text.includes("[PROCESSO]"));
  assert.equal(archive.acts[0].template.text.includes(P1), false);
});

test("dividir e unir registra histórico e avisa processos diferentes", () => {
  const reading = `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nPrimeiro bloco.\n\nSegundo bloco da mesma peça.\n`;
  const archive = doc("edit.md", reading);
  const split = splitAct(archive, archive.acts[0].id, 2);
  assert.equal(split.acts.length, 2);
  assert.equal(split.history.length, 1);
  const base = doc("mix.md", `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nUm.\n\nDECISÃO\n\nProcesso ${P2}\n\nDois.\n`);
  const joined = mergeWithNext(base, base.acts[0].id);
  assert.equal(joined.acts.length, 1);
  assert.match(joined.acts[0].warning ?? "", /processos diferentes/);
  const missing = mergeWithNext(base, "will");
  assert.equal(missing.acts.length, base.acts.length);
});

test("exportação zip abre e lista as peças", () => {
  const archive = linkDuplicates([
    doc("peca.md", `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se.\n`),
  ])[0];
  const bytes = archiveZip([archive]);
  const dir = mkdtempSync(join(tmpdir(), "folio-zip-"));
  const file = join(dir, "acervo.zip");
  writeFileSync(file, bytes);
  const list = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
  assert.match(list, /indice\.csv/);
  assert.match(list, /indice\.json/);
  assert.match(list, /relatorio-melhorias\.md/);
  assert.match(list, /relatorio-lacunas\.md/);
  assert.match(list, /\.fiel\.md/);
  assert.match(list, /modelos\//);
  execFileSync("unzip", ["-t", file]);
});

test("página impressa e id documental não são inventados", () => {
  const reading = `<!-- página 3 -->\n\nDESPACHO\n\nID do documento: DOC-8841\n\nfls. 14\n\nProcesso ${P1}\n\nIntime-se.\n`;
  const archive = doc("id.md", reading);
  assert.deepEqual(archive.acts[0].pdfPages, [3]);
  assert.deepEqual(archive.acts[0].printedPages, ["14"]);
  assert.equal(archive.acts[0].documentId, "DOC-8841");
  const plain = doc("sem-id.md", `DESPACHO\n\nProcesso ${P1}\n\nIntime-se.\n`);
  assert.equal(plain.acts[0].documentId, UNKNOWN);
  assert.deepEqual(plain.acts[0].printedPages, []);
  assert.deepEqual(plain.acts[0].pdfPages, []);
});

test("dividir reclassifica o trecho e não herda a classe do outro", () => {
  const reading = `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte sobre o expediente.\n\nContas de campanha das Eleições 2024. Julgo procedente o pedido de contas eleitorais.\n`;
  const archive = doc("mistura.md", reading);
  assert.equal(archive.acts.length, 1);
  const parts = archive.acts[0].text.split(/\n{2,}/);
  const split = splitAct(archive, archive.acts[0].id, parts.length - 1);
  assert.equal(split.acts.length, 2);
  assert.notEqual(fieldValue(split.acts[0].fields, "classe"), "prestação de contas eleitorais");
  assert.equal(fieldValue(split.acts[1].fields, "classe"), "prestação de contas eleitorais");
  assert.equal(fieldValue(split.acts[1].fields, "eleicao"), "2024");
  assert.equal(split.acts[1].cnj.includes(P1), false);
});

test("exemplo não apaga o acervo guardado", () => {
  const real = doc("ato.md", `DESPACHO\n\nProcesso ${P1}\n\nIntime-se.\n`);
  const example = { ...doc("ficticio.md", `DESPACHO\n\nProcesso ${P2}\n\nIntime-se.\n`), example: true as const };
  assert.equal(keepable([real, example]).length, 1);
  assert.equal(keepable([real, example])[0].filename, "ato.md");
  assert.equal(shouldWrite([example]), false);
  assert.equal(shouldWrite([real, example]), true);
  assert.equal(shouldWrite([]), true);
});
