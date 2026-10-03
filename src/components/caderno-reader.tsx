import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Copy, Check, Download, FileUp, Search } from "lucide-react";
import { Reading } from "@/components/reading";
import { saveTextFile } from "@/lib/save-text-file";
import { SavePanel } from "@/components/save-panel";

type PageSlice = { page: number; text: string };
type ProcessHit = { cnj: string; pages: number[] };
type Caderno = {
  tribunal: string;
  edition: string;
  disponibilizacao: string;
  publicacao: string;
  pageCount: number;
  charCount: number;
  emptyPages: number;
  processCount: number;
  markdownHref: string;
  pages: PageSlice[];
  processes: ProcessHit[];
};

type TocItem = { label: string; page: number };
type TextHit = { page: number; snippet: string };

const PAGE_KEY = "folio.dje.page";

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function plain(markdown: string): string {
  return markdown.replace(/^#{1,3}\s+/gm, "").replace(/\\([\\`*_{}[\]#<>])/g, "$1");
}

function highlightRegex(query: string): RegExp | null {
  const stripped = query.normalize("NFD").replace(/\p{M}/gu, "").trim();
  if (stripped.length < 3) return null;
  const body = [...stripped]
    .map((ch) => {
      const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /[a-z0-9]/i.test(ch) ? `${escaped}\\p{M}*` : escaped;
    })
    .join("");
  return new RegExp(body, "giu");
}

function snippet(text: string, query: string): string {
  const clean = plain(text).replace(/\s+/g, " ").trim();
  const re = highlightRegex(query);
  const match = re ? re.exec(clean) : null;
  if (!match) return clean.slice(0, 180);
  const start = Math.max(0, match.index - 64);
  const end = Math.min(clean.length, match.index + match[0].length + 96);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function tocFrom(pages: PageSlice[]): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Set<string>();
  for (const page of pages.slice(0, 3)) {
    for (const line of page.text.split("\n")) {
      const match = /^(.+?)\s*(?:\.{4,}|—)\s*(\d+)\s*$/.exec(line.trim());
      if (!match) continue;
      const label = match[1].replace(/\\/g, "").trim();
      const target = Number(match[2]);
      if (!label || target < 1 || seen.has(label)) continue;
      seen.add(label);
      items.push({ label, page: target });
    }
  }
  return items;
}

export function CadernoReader({ onConvertOther }: { onConvertOther: () => void }) {
  const [caderno, setCaderno] = useState<Caderno | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => {
  if (typeof sessionStorage === "undefined") return 1;
  const stored = Number(sessionStorage.getItem(PAGE_KEY));
  return stored >= 1 ? stored : 1;
});
  const [draft, setDraft] = useState("1");
  const [query, setQuery] = useState("");
  const [showHits, setShowHits] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveText, setSaveText] = useState<string | null>(null);
  const [fullMd, setFullMd] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/cadernos/dje-tre-pa-2026-n223.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Falha ao abrir o diário convertido.");
        return response.json() as Promise<Caderno>;
      })
      .then((data) => {
        setCaderno(data);
        setPage((current) => (current > data.pageCount ? 1 : current));
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Falha ao abrir o diário convertido.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!caderno) return;
    const controller = new AbortController();
    fetch(caderno.markdownHref, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("md");
        return response.text();
      })
      .then(setFullMd)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setFullMd(null);
      });
    return () => controller.abort();
  }, [caderno]);

  useEffect(() => {
    setDraft(String(page));
    try {
      sessionStorage.setItem(PAGE_KEY, String(page));
    } catch {
      /* private mode */
    }
  }, [page]);

  const toc = useMemo(() => (caderno ? tocFrom(caderno.pages) : []), [caderno]);
  const current = caderno?.pages.find((item) => item.page === page) ?? null;

  const hits = useMemo(() => {
    if (!caderno) return { processes: [] as ProcessHit[], texts: [] as TextHit[] };
    const needle = fold(query.trim());
    if (needle.length < 3) return { processes: [] as ProcessHit[], texts: [] as TextHit[] };
    const processes = caderno.processes.filter((item) => fold(item.cnj).includes(needle)).slice(0, 12);
    const texts: TextHit[] = [];
    for (const item of caderno.pages) {
      if (!fold(plain(item.text)).includes(needle)) continue;
      texts.push({ page: item.page, snippet: snippet(item.text, query) });
      if (texts.length >= 24) break;
    }
    return { processes, texts };
  }, [caderno, query]);

  const searching = fold(query.trim()).length >= 3;
  const hitCount = hits.processes.length + hits.texts.length;

  function go(next: number) {
    if (!caderno) return;
    const clamped = Math.min(caderno.pageCount, Math.max(1, next));
    setPage(clamped);
    setShowHits(false);
  }

  function commitDraft() {
    const value = Number(draft);
    if (!Number.isFinite(value)) {
      setDraft(String(page));
      return;
    }
    go(value);
  }

  async function downloadAll() {
    if (!caderno) return;
    const text =
      fullMd ??
      caderno.pages.map((item) => `<!-- página ${item.page} -->\n\n${item.text.trim()}`).join("\n\n") + "\n";
    const outcome = await saveTextFile("DJE-TRE-PA-2026-n223.md", text);
    if (outcome === "cancelled") return;
    if (outcome === "failed") {
      setSaveText(text);
      setSaveNote("O aparelho bloqueou o download e a cópia. O texto abaixo está selecionado: use Compartilhar e Salvar em Arquivos.");
      return;
    }
    setSaveText(null);
    if (outcome === "copied") {
      setSaveNote("O iPhone não baixa o arquivo direto. O Markdown foi copiado — cole em Arquivos ou Notas.");
      return;
    }
    if (outcome === "shared") {
      setSaveNote("Na folha do sistema, escolha Salvar em Arquivos.");
      return;
    }
    setSaveNote("Download iniciado.");
    window.setTimeout(() => setSaveNote(null), 2500);
  }

  async function copyPage() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(plain(current.text).trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("O navegador bloqueou a cópia. Baixe o Markdown.");
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-line px-4 py-5 lg:px-8">
        <div className="mx-auto flex max-w-3xl items-start gap-4">
          <img src="/favicon.svg" alt="" width={40} height={40} className="mt-1 size-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs tracking-widest text-muted uppercase">PDF para Markdown</p>
            <h1 className="font-sans text-4xl leading-none font-medium">Folio</h1>
            <p className="mt-2 text-pretty text-muted">
              DJE/TRE-PA · {caderno?.edition ?? "Ano 2026, nº 223"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5 lg:px-8 lg:py-6">
        <p className="text-pretty text-sm text-muted">
          Disponibilizado em {caderno?.disponibilizacao ?? "01 de outubro de 2026"}. Publicação dos atos em{" "}
          {caderno?.publicacao ?? "02/10/2026"}. Texto integral da camada do PDF, sem resumo.
          {caderno ? ` ${caderno.pageCount} páginas · ${caderno.processCount} processos com número CNJ.` : ""}
        </p>

        {!caderno && !error ? (
          <p className="mt-8 text-muted" aria-live="polite">
            Abrindo as 459 páginas…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-6 text-sm text-accent">
            {error}
          </p>
        ) : null}

        {caderno && current ? (
          <>
            <label className="mt-5 block text-sm">
              <span className="inline-flex items-center gap-2 text-muted">
                <Search className="size-4" aria-hidden />
                Buscar no diário
              </span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setShowHits(true);
                }}
                placeholder="Processo, parte ou trecho"
                className="mt-1 h-12 w-full rounded-md border border-line bg-surface px-3 text-fg placeholder:text-muted"
              />
            </label>

            {toc.length > 0 ? (
              <label className="mt-3 block text-sm">
                Sumário
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const target = event.currentTarget;
                    if (target.value) go(Number(target.value));
                    target.value = "";
                  }}
                  className="mt-1 h-12 w-full rounded-md border border-line bg-surface px-3 text-fg"
                >
                  <option value="">Ir para uma seção</option>
                  {toc.map((item) => (
                    <option key={`${item.label}-${item.page}`} value={item.page}>
                      {item.label} · p. {item.page}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {searching && showHits ? (
              <section className="mt-4" aria-live="polite">
                <h2 className="text-sm text-muted">
                  {hitCount === 0 ? "Nada com esse trecho." : `${hitCount} resultado${hitCount === 1 ? "" : "s"} nesta leva.`}
                </h2>
                <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                  {hits.processes.map((item) => (
                    <li key={item.cnj} className="px-3 py-3">
                      <p className="font-mono text-sm">{item.cnj}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.pages.map((target) => (
                          <button
                            key={target}
                            type="button"
                            onClick={() => go(target)}
                            className="h-10 rounded-md border border-line px-3 text-sm"
                          >
                            p. {target}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                  {hits.texts.map((item) => (
                    <li key={item.page}>
                      <button type="button" onClick={() => go(item.page)} className="w-full px-3 py-3 text-left">
                        <span className="font-mono text-xs text-accent">p. {item.page}</span>
                        <span className="mt-1 block text-sm break-words text-pretty">{item.snippet}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {searching && !showHits ? (
              <button type="button" onClick={() => setShowHits(true)} className="mt-3 text-sm text-accent underline underline-offset-2">
                Voltar aos {hitCount} resultados
              </button>
            ) : null}

            {!showHits || !searching ? (
              <>
                <div className="sticky top-0 z-10 -mx-4 mt-4 flex items-center gap-2 border-y border-line bg-bg px-4 py-2 lg:-mx-8 lg:px-8">
                  <button
                    type="button"
                    onClick={() => go(page - 1)}
                    disabled={page <= 1}
                    aria-label="Página anterior"
                    className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md border border-line px-3 text-sm disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    <span className="max-sm:sr-only">Anterior</span>
                  </button>
                  <label className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm">
                    <span className="sr-only">Página</span>
                    <input
                      inputMode="numeric"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
                      onBlur={commitDraft}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitDraft();
                      }}
                      className="h-11 w-16 rounded-md border border-line bg-surface text-center font-mono text-fg"
                      aria-label="Número da página"
                    />
                    <span className="text-muted tabular-nums">/ {caderno.pageCount}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => go(page + 1)}
                    disabled={page >= caderno.pageCount}
                    aria-label="Página seguinte"
                    className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md border border-line px-3 text-sm disabled:opacity-40"
                  >
                    <span className="max-sm:sr-only">Próxima</span>
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </div>

                <article className="mt-2 min-w-0 rounded-md border border-line bg-surface px-4 py-5">
                  <p className="mb-4 inline-flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
                    <BookOpen className="size-4" aria-hidden />
                    Página {page}
                  </p>
                  <Reading source={current.text} query={searching ? query : ""} />
                </article>
              </>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadAll()}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg"
              >
                <Download className="size-4" aria-hidden />
                Baixar .md
              </button>
              <button
                type="button"
                onClick={() => void copyPage()}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm"
              >
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Página copiada" : "Copiar página"}
              </button>
              <button
                type="button"
                onClick={onConvertOther}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm"
              >
                <FileUp className="size-4" aria-hidden />
                Converter outro PDF
              </button>
            </div>
            {saveNote ? (
              <p className="mt-2 text-sm text-muted" role="status">
                {saveNote}
              </p>
            ) : null}
            <SavePanel text={saveText} />

            <p className="mt-4 text-sm text-pretty text-muted">
              Cabeçalho e rodapé repetidos foram retirados. Hífen de fim de linha foi recomposto. Aspas que o PDF
              gravou como ¿ foram restituídas. O enunciado não foi reescrito. {caderno.charCount.toLocaleString("pt-BR")}{" "}
              caracteres.
              {caderno.emptyPages > 0 ? ` ${caderno.emptyPages} páginas sem texto.` : " Nenhuma página veio vazia."}
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
