import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Execute the real harness with a synthetic Playwright module, without installing
// browsers or running the application. These cases exercise exit codes and the
// report when the infrastructure or a scenario fails.
async function runHarness(env = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "folio-harness-"));
  try {
    await mkdir(path.join(root, "node_modules/playwright"), { recursive: true });
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs/acervo-browser-results.json"), '{"stale":true}');
    await copyFile(
      new URL("./acervo-browser-tests.mjs", import.meta.url),
      path.join(root, "suite.mjs"),
    );
    await writeFile(
      path.join(root, "node_modules/playwright/package.json"),
      JSON.stringify({ type: "module", exports: "./index.mjs" }),
    );
    await writeFile(
      path.join(root, "node_modules/playwright/index.mjs"),
      `
      function engine(name) {
        return {
          executablePath: () => (process.env.MOCK_AVAILABLE || "").split(",").includes(name)
            ? process.execPath : "/missing-folio-browser",
          launch: async () => {
            if (process.env.MOCK_SCENARIO_FAILURE !== "true") throw Error("Synthetic launch failure");
            return {
              newContext: async () => { throw Error("Synthetic scenario regression"); },
              contexts: () => [],
              close: async () => {},
            };
          },
          launchPersistentContext: async () => { throw Error("Synthetic persistent regression"); },
        };
      }
      export const chromium = engine("chromium"), firefox = engine("firefox"), webkit = engine("webkit");
    `,
    );
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith("FOLIO_") || key.startsWith("MOCK_") || key === "CI") delete childEnv[key];
    }
    const execution = spawnSync(process.execPath, ["suite.mjs"], {
      cwd: root,
      env: { ...childEnv, ...env },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(execution.error, undefined, execution.stderr);
    return {
      code: execution.status,
      report: JSON.parse(
        await readFile(path.join(root, "docs/acervo-browser-results.json"), "utf8"),
      ),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("required browser absent fails and replaces the historical report", async () => {
  const { code, report } = await runHarness({
    FOLIO_TEST_BROWSERS: "chromium,webkit",
    FOLIO_REQUIRED_BROWSERS: "chromium,webkit",
  });
  assert.equal(code, 1);
  assert.equal(report.stale, undefined);
  assert.equal(report.completed, true);
  assert.equal(report.syntheticDataOnly, true);
  assert.deepEqual(
    report.results.map((r) => [r.browser, r.status]),
    [
      ["chromium", "FAIL"],
      ["webkit", "FAIL"],
    ],
  );
});

test("CI cannot silently omit WebKit", async () => {
  const { code, report } = await runHarness({ CI: "true", FOLIO_TEST_BROWSERS: "chromium" });
  assert.equal(code, 1);
  assert.match(report.results[0].error, /obrigatório não selecionado: webkit/);
});

test("missing optional engines stay unverified locally", async () => {
  const { code, report } = await runHarness();
  assert.equal(code, 1); // Chromium is mandatory locally too.
  assert.deepEqual(
    report.results.map((r) => r.status),
    ["FAIL", "NÃO VERIFICADO", "NÃO VERIFICADO"],
  );
});

test("all explicitly required engines must exist, including Firefox", async () => {
  const { code, report } = await runHarness({ FOLIO_REQUIRED_BROWSERS: "chromium,firefox,webkit" });
  assert.equal(code, 1);
  assert.ok(report.results.every((r) => r.status === "FAIL"));
});

test("empty or unknown browser lists fail instead of running zero scenarios", async () => {
  for (const selection of ["", "chromium,safari", "chromium,"]) {
    const { code, report } = await runHarness({ FOLIO_TEST_BROWSERS: selection });
    assert.equal(code, 1);
    assert.match(report.results[0].error, /Lista de browsers inválida/);
  }
});

test("launch failure writes evidence and still attempts the other engines", async () => {
  const { code, report } = await runHarness({ MOCK_AVAILABLE: "chromium,firefox,webkit" });
  assert.equal(code, 1);
  assert.equal(report.results.length, 3);
  assert.ok(
    report.results.every((r) => r.status === "FAIL" && /Synthetic launch failure/.test(r.error)),
  );
  assert.equal(report.completed, true);
});

test("scenario regressions fail the command and retain all scenario results", async () => {
  const { code, report } = await runHarness({
    MOCK_AVAILABLE: "chromium,webkit",
    MOCK_SCENARIO_FAILURE: "true",
    FOLIO_TEST_BROWSERS: "chromium,webkit",
  });
  assert.equal(code, 1);
  for (const engine of ["chromium", "webkit"]) {
    const scenarios = report.results.filter((r) => r.browser === engine);
    assert.equal(scenarios.length, 15);
    assert.ok(scenarios.every((r) => r.status === "FAIL"));
    assert.ok(scenarios.some((r) => /Synthetic scenario regression/.test(r.error)));
  }
});
