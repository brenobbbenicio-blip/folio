import { chromium, firefox, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const origin = process.env.FOLIO_TEST_URL || "http://127.0.0.1:8080";
const results = [];
const executable = process.env.FOLIO_BROWSER_EXECUTABLE;
const args = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-zygote",
  "--disable-software-rasterizer",
];
const options = { headless: true, ...(executable ? { executablePath: executable, args } : {}) };
const check = async (name, fn) => {
  try {
    const evidence = await fn();
    results.push({ name, status: "PASS", evidence });
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.message });
  }
  console.log(JSON.stringify(results.at(-1)));
};
async function blank(browser) {
  const context = await browser.newContext();
  await context.route("**/__acervo_qa__", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Fólio QA fictício</title>",
    }),
  );
  const page = await context.newPage();
  await page.goto(origin + "/__acervo_qa__");
  await page.evaluate(async () => {
    window.v = await import("/src/lib/acervo/vault.ts");
    window.b = await import("/src/lib/acervo/backup.ts");
    window.p = await import("/src/lib/acervo/pipeline.ts");
    window.make = (name, pdf = true) =>
      window.p.ingestDocument({
        filename: name,
        faithful: "# DESPACHO FICTÍCIO\nTexto exclusivamente sintético de teste.",
        reading: "# DESPACHO FICTÍCIO\nTexto exclusivamente sintético de teste.",
        hasPdf: pdf,
      });
    window.bytes = new Uint8Array([
      37, 80, 68, 70, 45, 49, 46, 55, 10, 70, 73, 67, 84, 73, 67, 73, 79,
    ]);
  });
  return { context, page };
}
const browser = await chromium.launch(options);
await check("gravação atômica, reabertura e novas identidades", async () => {
  const { context, page } = await blank(browser);
  const a = await page.evaluate(async () => {
    let s = await v.loadVault();
    const d = make("A-ficticio.pdf");
    d.acts[0].review = "revisada";
    d.history.push({ label: "Revisão manual fictícia", acts: structuredClone(d.acts) });
    s = await v.saveVault([d], () => bytes, s);
    return { id: d.id, docs: s.docs, pdf: Array.from(s.pdfs[0].data) };
  });
  await page.close();
  const next = await context.newPage();
  await next.goto(origin + "/__acervo_qa__");
  const r = await next.evaluate(async () => {
    const v = await import("/src/lib/acervo/vault.ts"),
      p = await import("/src/lib/acervo/pipeline.ts");
    const s = await v.loadVault();
    const d = p.ingestDocument({
      filename: "B-ficticio.md",
      faithful: "Texto fictício B",
      reading: "Texto fictício B",
      hasPdf: false,
    });
    const n = await v.saveVault([...s.docs, d], () => undefined, s);
    return { docs: n.docs, pdf: Array.from(n.pdfs[0].data), id: d.id };
  });
  assert.deepEqual(r.docs[0], a.docs[0]);
  assert.deepEqual(r.pdf, a.pdf);
  assert.notEqual(r.id, a.id);
  await context.close();
  return "Texto, PDF, revisão e histórico idênticos; nova identidade distinta.";
});
await check("falhas de escrita e quota preservam bytes e estado", async () => {
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async () => {
    let s = await v.loadVault();
    const d = make("Quota-ficticia.pdf");
    s = await v.saveVault([d], () => bytes, s);
    const before = JSON.stringify({
      docs: s.docs,
      pdfs: s.pdfs.map((x) => Array.from(x.data)),
      revision: s.revision,
    });
    const proto = IDBObjectStore.prototype,
      put = proto.put;
    const names = [];
    for (const failure of ["QuotaExceededError", "UnknownError"]) {
      let fired = false;
      proto.put = function (...a) {
        if (this.name === "pdfs" && !fired) {
          fired = true;
          throw new DOMException("Falha sintética", failure);
        }
        return put.apply(this, a);
      };
      const edit = structuredClone(s.docs);
      edit[0].reading += " edição";
      try {
        await v.saveVault(edit, () => bytes, s);
        names.push("não rejeitou");
      } catch (e) {
        names.push(e.name);
      } finally {
        proto.put = put;
      }
      const after = await v.loadVault();
      if (
        JSON.stringify({
          docs: after.docs,
          pdfs: after.pdfs.map((x) => Array.from(x.data)),
          revision: after.revision,
        }) !== before
      )
        throw Error("Estado anterior alterado");
    }
    return names;
  });
  assert.deepEqual(r, ["QuotaExceededError", "UnknownError"]);
  await context.close();
  return r;
});
await check("PDF ausente: reutiliza cópia existente e rejeita novo incompleto", async () => {
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async () => {
    let s = await v.loadVault();
    s = await v.saveVault([make("Existente-ficticio.pdf")], () => bytes, s);
    s = await v.saveVault(s.docs, () => undefined, s);
    const incomplete = make("Ausente-ficticio.pdf");
    let rejected = false;
    try {
      await v.saveVault([...s.docs, incomplete], () => undefined, s);
    } catch (e) {
      rejected = e.name === "MissingPdfError";
    }
    const end = await v.loadVault();
    return { rejected, docs: end.docs.length, pdf: Array.from(end.pdfs[0].data) };
  });
  assert.equal(r.rejected, true);
  assert.equal(r.docs, 1);
  assert.equal(r.pdf.length, 17);
  await context.close();
  return "Cópia guardada reutilizada; nova peça sem bytes recusada sem alterar acervo.";
});
await check("PDF faltante no banco v2 bloqueia leitura sem regravar", async () => {
  const { context, page } = await blank(browser);
  const result = await page.evaluate(async () => {
    const s = await v.saveVault([make("corrompido-ficticio.pdf")], () => bytes, await v.loadVault());
    await new Promise((resolve, reject) => {
      const r = indexedDB.open("folio-acervo", 2);
      r.onsuccess = () => {
        const db = r.result, tx = db.transaction("pdfs", "readwrite");
        tx.objectStore("pdfs").clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      r.onerror = () => reject(r.error);
    });
    try { await v.loadVault(); return false; }
    catch (e) { return e.name === "MissingPdfError" && s.docs.length === 1; }
  });
  assert.equal(result, true);
  await context.close();
  return "Leitura incompleta rejeitada; nenhuma gravação corretiva destrutiva.";
});
await check("duas abas reais: CAS impede sobrescrita e ressurreição", async () => {
  const { context, page } = await blank(browser);
  await page.evaluate(async () => {
    let s = await v.loadVault();
    await v.saveVault([make("Concorrencia-ficticia.pdf")], () => bytes, s);
  });
  const peer = await context.newPage();
  await peer.goto(origin + "/__acervo_qa__");
  await peer.evaluate(async () => {
    window.v = await import("/src/lib/acervo/vault.ts");
    window.stale = await v.loadVault();
  });
  const current = await page.evaluate(async () => {
    const s = await v.loadVault();
    return await v.saveVault([...s.docs, make("Nova-ficticia.md", false)], () => undefined, s);
  });
  assert.equal(current.docs.length, 2);
  const overwrite = await peer.evaluate(async () => {
    try {
      await v.saveVault(stale.docs, () => undefined, stale);
      return false;
    } catch (e) {
      return e.name === "VaultConflictError";
    }
  });
  assert.equal(overwrite, true);
  await page.evaluate(async () => {
    await v.clearVault(await v.loadVault());
  });
  const resurrection = await peer.evaluate(async () => {
    try {
      await v.saveVault(stale.docs, () => stale.pdfs[0].data, stale);
      return false;
    } catch (e) {
      return e.name === "VaultConflictError" && (await v.loadVault()).docs.length === 0;
    }
  });
  assert.equal(resurrection, true);
  await context.close();
  return "Abas separadas compartilharam IndexedDB; escritas obsoletas foram recusadas após inclusão e exclusão.";
});
await check("geração impede escrita obsoleta depois de apagar banco", async () => {
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async () => {
    const old = await v.loadVault();
    await new Promise((ok, no) => {
      const r = indexedDB.deleteDatabase("folio-acervo");
      r.onsuccess = ok;
      r.onerror = no;
    });
    const fresh = await v.loadVault();
    try {
      await v.saveVault([make("Obsoleto-ficticio.md", false)], () => undefined, old);
      return false;
    } catch (e) {
      return (
        old.generation !== fresh.generation &&
        e.name === "VaultConflictError" &&
        (await v.loadVault()).docs.length === 0
      );
    }
  });
  assert.equal(r, true);
  await context.close();
  return "Token de geração bloqueou snapshot do banco anterior.";
});
await check("migração v1 preserva colisões, bytes brutos e alertas", async () => {
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async () => {
    const a = make("Legado-A-ficticio.pdf"),
      c = structuredClone(a);
    a.id = c.id = "doc-1";
    a.acts[0].id = c.acts[0].id = "doc-1-1";
    c.filename = "Legado-B-ficticio.pdf";
    await new Promise((ok, no) => {
      const request = indexedDB.open("folio-acervo", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("docs");
        request.result.createObjectStore("pdfs");
      };
      request.onerror = no;
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(["docs", "pdfs"], "readwrite");
        tx.objectStore("docs").put([a, c], "archive");
        tx.objectStore("pdfs").put(bytes.buffer, "doc-1");
        tx.objectStore("pdfs").put(new Uint8Array([1, 2, 3]).buffer, "pdf-orfao");
        tx.oncomplete = () => {
          db.close();
          ok();
        };
      };
    });
    const s = await v.loadVault();
    return {
      ids: s.docs.map((d) => d.id),
      legacyDocs: s.legacy.docs.length,
      legacyPdfs: s.legacy.pdfs.length,
      activePdfs: s.pdfs.length,
      warnings: s.migrationWarnings.length,
      allBytes: s.pdfs.every((p) => p.data.length === bytes.length),
    };
  });
  assert.equal(new Set(r.ids).size, 2);
  assert.equal(r.legacyDocs, 2);
  assert.equal(r.legacyPdfs, 2);
  assert.equal(r.activePdfs, 2);
  assert.equal(r.allBytes, true);
  assert.ok(r.warnings >= 2);
  await context.close();
  return r;
});
let backup;
await check("backup íntegro com histórico e hashes; corrupções recusadas", async () => {
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async () => {
    let s = await v.loadVault();
    const d = make("Backup-ficticio.pdf");
    d.acts[0].review = "revisada";
    d.history.push({ label: "histórico fictício", acts: structuredClone(d.acts) });
    s = await v.saveVault([d], () => bytes, s);
    const data = await b.createBackup(s);
    const parsed = await b.readBackup(data);
    if (JSON.stringify(parsed.docs) !== JSON.stringify(s.docs)) throw Error("Estado não idêntico");
    const bad = JSON.parse(new TextDecoder().decode(data));
    bad.payload.docs[0].reading += " corrupção";
    let rejected = false;
    try {
      await b.readBackup(new TextEncoder().encode(JSON.stringify(bad)));
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Corrupção aceita");
    await v.clearVault(s);
    return {
      backup: Array.from(data),
      docs: parsed.docs,
      pdfs: parsed.pdfs.map((p) => ({ id: p.id, data: Array.from(p.data) })),
      manifest: JSON.parse(new TextDecoder().decode(data)).manifest,
    };
  });
  backup = r;
  assert.equal(r.manifest.active.pdfs[0].sha256.length, 64);
  await context.close();
  return "Hashes SHA-256 e estado completo conferidos; conteúdo adulterado recusado; origem apagada.";
});
await check("restaurar em outro perfil isolado: estado e PDF idênticos", async () => {
  assert.ok(backup);
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async (saved) => {
    const empty = await v.loadVault();
    if (empty.docs.length) throw Error("Perfil não isolado");
    const incoming = await b.readBackup(Uint8Array.from(saved.backup));
    const plan = b.planRestore(empty, incoming, "keep");
    const s = await v.saveVault(
      plan.docs,
      (id) => plan.pdfs.find((p) => p.id === id)?.data,
      empty,
      { legacy: plan.legacy, migrationWarnings: plan.migrationWarnings },
    );
    return { docs: s.docs, pdfs: s.pdfs.map((p) => ({ id: p.id, data: Array.from(p.data) })) };
  }, backup);
  assert.deepEqual(r.docs, backup.docs);
  assert.deepEqual(r.pdfs, backup.pdfs);
  await context.close();
  return "Perfil novo começou vazio e recebeu acervo completo idêntico.";
});
await check("restauração: políticas explícitas manter, copiar e substituir", async () => {
  const { context, page } = await blank(browser);
  const r = await page.evaluate(async (saved) => {
    const incoming = await b.readBackup(Uint8Array.from(saved.backup)),
      current = structuredClone(incoming);
    current.docs[0].reading = "Versão atual fictícia";
    const kept = b.planRestore(current, incoming, "keep"),
      copied = b.planRestore(current, incoming, "copy"),
      replaced = b.planRestore(current, incoming, "replace");
    return {
      keep: kept.docs[0].reading,
      copy: copied.docs.length,
      unique: new Set(copied.docs.map((d) => d.id)).size,
      replace: replaced.docs[0].reading,
      expected: incoming.docs[0].reading,
    };
  }, backup);
  assert.equal(r.keep, "Versão atual fictícia");
  assert.equal(r.copy, 2);
  assert.equal(r.unique, 2);
  assert.equal(r.replace, r.expected);
  await context.close();
  return r;
});
await check("interface: falha transitória de abertura não grava acervo vazio", async () => {
  const { context, page } = await blank(browser);
  await page.evaluate(async () => {
    const s = await v.loadVault();
    await v.saveVault([make("Leitura-ficticia.pdf")], () => bytes, s);
  });
  await context.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    window.restoreTransaction = () => {
      IDBDatabase.prototype.transaction = original;
    };
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === "readwrite")
        throw new DOMException("Falha de leitura fictícia", "UnknownError");
      return original.apply(this, args);
    };
  });
  await page.goto(origin);
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("input[type=file][multiple]").isDisabled(), true);
  const r = await page.evaluate(async () => {
    window.restoreTransaction();
    const v = await import("/src/lib/acervo/vault.ts");
    const s = await v.loadVault();
    return { docs: s.docs.length, pdfs: s.pdfs.length };
  });
  assert.deepEqual(r, { docs: 1, pdfs: 1 });
  await context.close();
  return "Interface bloqueou importação e preservou documento/PDF anteriores.";
});
await check(
  "interface: importação real, confirmação, fechamento imediato e reabertura",
  async () => {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => document.body.innerText.includes("Arquivo local aberto"));
    await page
      .locator("input[type=file][multiple]")
      .setInputFiles({
        name: "Interface-ficticia.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# DESPACHO FICTÍCIO\nTexto sintético sem documento real."),
      });
    await page.getByRole("button", { name: "Converter documento", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Leitura local concluída"));
    const before = await page.evaluate(
      async () => (await (await import("/src/lib/acervo/vault.ts")).loadVault()).docs,
    );
    await page.close();
    const next = await context.newPage();
    await next.goto(origin);
    await next.waitForFunction(() => document.body.innerText.includes("Acervo recuperado"));
    const after = await next.evaluate(
      async () => (await (await import("/src/lib/acervo/vault.ts")).loadVault()).docs,
    );
    assert.deepEqual(after, before);
    await next
      .locator("input[type=file][multiple]")
      .setInputFiles({
        name: "Interface-nova-ficticia.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# NOVA PEÇA FICTÍCIA\nTexto fictício distinto."),
      });
    await next.getByRole("button", { name: "Converter documento", exact: true }).click();
    await next.waitForFunction(() => document.body.innerText.includes("Leitura local concluída"));
    const ids = await next.evaluate(async () =>
      (await (await import("/src/lib/acervo/vault.ts")).loadVault()).docs.map((d) => d.id),
    );
    assert.equal(new Set(ids).size, 2);
    await context.close();
    return "Duas importações na interface, em aberturas diferentes; nenhuma colisão ou perda após confirmação.";
  },
);
await check("interface: converter PDF fictício válido e preservar original", async () => {
  let text = "%PDF-1.4\n";
  const offsets = [0],
    objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
  const stream = "BT /F1 12 Tf 40 740 Td (DESPACHO FICTICIO - teste sem dados reais) Tj ET";
  objects.push("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(text));
    text += i + 1 + " 0 obj\n" + o + "\nendobj\n";
  });
  const xref = Buffer.byteLength(text);
  text +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF\n";
  const pdf = Buffer.from(text);
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => document.body.innerText.includes("Arquivo local aberto"));
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles({ name: "PDF-valido-ficticio.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Converter documento", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Leitura local concluída"));
  const saved = await page.evaluate(async () => {
    const s = await (await import("/src/lib/acervo/vault.ts")).loadVault();
    return { faithful: s.docs[0].faithful, pdf: Array.from(s.pdfs[0].data) };
  });
  assert.ok(saved.faithful.includes("DESPACHO FICTICIO"));
  assert.deepEqual(saved.pdf, Array.from(pdf));
  await context.close();
  return "PDF sintético válido convertido pela interface; bytes originais íntegros no IndexedDB.";
});
await check("interface: prévia, políticas, backup e confirmação de exclusão", async () => {
  const { context, page } = await blank(browser);
  await page.evaluate(async (saved) => {
    const s = await v.loadVault(),
      incoming = await b.readBackup(Uint8Array.from(saved.backup));
    await v.saveVault(incoming.docs, (id) => incoming.pdfs.find((p) => p.id === id)?.data, s);
  }, backup);
  await page.goto(origin);
  await page.waitForFunction(() => document.body.innerText.includes("Acervo recuperado"));
  await page.getByRole("button", { name: "Ajustes", exact: true }).first().click();
  await page.getByRole("button", { name: "Ver dados armazenados" }).click();
  const backupInput = page.locator('input[accept=".folio.json,application/json"]');
  await backupInput.setInputFiles({
    name: "Teste-ficticio.folio.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup.backup),
  });
  await page.getByRole("region", { name: "Prévia da restauração" }).waitFor();
  assert.ok(
    (await page.getByRole("region", { name: "Prévia da restauração" }).innerText()).includes(
      "1 conflitos",
    ),
  );
  await page.getByLabel("Política de restauração").selectOption("keep");
  await page.getByRole("button", { name: "Confirmar restauração", exact: true }).click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("Backup restaurado e guardado"),
  );
  await page.getByRole("button", { name: "Apagar deste aparelho", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirmar exclusão do acervo" }).waitFor();
  await page.getByRole("button", { name: "Cancelar exclusão", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page.evaluate(
      async () => (await (await import("/src/lib/acervo/vault.ts")).loadVault()).docs.length,
    ),
    1,
  );
  await page.getByRole("button", { name: "Apagar deste aparelho", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar backup antes de apagar", exact: true }).click();
  const file = await download;
  assert.ok(file.suggestedFilename().endsWith(".folio.json"));
  await mkdir("/workspace/screenshots", { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "/workspace/screenshots/folio-persistencia-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/workspace/screenshots/folio-persistencia-mobile.png",
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: "Confirmar apagar todo o acervo", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Apagado deste aparelho"));
  assert.equal(
    await page.evaluate(
      async () => (await (await import("/src/lib/acervo/vault.ts")).loadVault()).docs.length,
    ),
    0,
  );
  await context.close();
  return "Prévia e manter confirmados; cancelamento preservou dados; backup baixado; exclusão explícita apagou somente após confirmação. Desktop/mobile sem overflow.";
});
await browser.close();
await check("encerrar e reabrir processo Chromium com perfil persistente", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-ficticio-"));
  let context = await chromium.launchPersistentContext(dir, options);
  let page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => document.body.innerText.includes("Arquivo local aberto"));
  const expected = await page.evaluate(async () => {
    const v = await import("/src/lib/acervo/vault.ts"),
      p = await import("/src/lib/acervo/pipeline.ts");
    const s = await v.loadVault(),
      d = p.ingestDocument({
        filename: "Processo-ficticio.md",
        faithful: "Conteúdo fictício de reabertura",
        reading: "Conteúdo fictício de reabertura",
        hasPdf: false,
      });
    const saved = await v.saveVault([d], () => undefined, s);
    return saved.docs;
  });
  await context.close();
  context = await chromium.launchPersistentContext(dir, options);
  page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => document.body.innerText.includes("Acervo recuperado"));
  const actual = await page.evaluate(
    async () => (await (await import("/src/lib/acervo/vault.ts")).loadVault()).docs,
  );
  assert.deepEqual(actual, expected);
  await context.close();
  return "Processo encerrado após commit e reiniciado; estado integral recuperado.";
});
for (const [name, engine] of [
  ["Firefox", firefox],
  ["WebKit", webkit],
]) {
  if (!existsSync(engine.executablePath()))
    results.push({
      name: `${name}: cenários de persistência`,
      status: "NÃO VERIFICADO",
      reason: "Binário não disponível; nenhum download repetido.",
    });
  else {
    const b = await engine.launch({ headless: true });
    await check(`${name}: gravação e leitura IndexedDB`, async () => {
      const { context, page } = await blank(b);
      const r = await page.evaluate(async () => {
        let s = await v.loadVault();
        s = await v.saveVault([make("Engine-ficticio.pdf")], () => bytes, s);
        return (await v.loadVault()).pdfs[0].data.length;
      });
      assert.equal(r, 17);
      await context.close();
      return r;
    });
    await b.close();
  }
}
await mkdir("docs", { recursive: true });
await writeFile(
  "docs/acervo-browser-results.json",
  JSON.stringify(
    { runAt: new Date().toISOString(), origin, syntheticDataOnly: true, results },
    null,
    2,
  ) + "\n",
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
