import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reading } from "@/components/reading";
import { CadernoReader } from "@/components/caderno-reader";
import { SavePanel } from "@/components/save-panel";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FileUp,
  Lock,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { samplePdfBytes, SAMPLE_PDF_NAME } from "@/lib/sample-pdf";
import { saveTextFile } from "@/lib/save-text-file";
import {
  defaultOptions,
  loadOptions,
  saveOptions,
  type ConvertOptions,
  type ConvertResult,
  type PageMarker,
} from "@/lib/pdf-options";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; page: number; total: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

type SourceFile = { name: string; data: Uint8Array; size: number };

const MARKERS: { id: PageMarker; label: string }[] = [
  { id: "none", label: "Nenhuma" },
  { id: "comment", label: "Comentário" },
  { id: "rule", label: "Régua" },
  { id: "heading", label: "Título" },
];

export function FolioApp({
  embedded = false,
  onInclude,
  onBatch,
}: {
  embedded?: boolean;
  onInclude?: (payload: { name: string; data: Uint8Array }) => void;
  onBatch?: (files: File[]) => void;
} = {}) {
  const [mode, setMode] = useState<"dje" | "pdf">("pdf");
  if (mode === "dje") return <CadernoReader onConvertOther={() => setMode("pdf")} />;
  return (
    <Converter
      embedded={embedded}
      onOpenDiary={() => setMode("dje")}
      onInclude={onInclude}
      onBatch={onBatch}
    />
  );
}

function Converter({
  embedded,
  onOpenDiary,
  onInclude,
  onBatch,
}: {
  embedded: boolean;
  onOpenDiary: () => void;
  onInclude?: (payload: { name: string; data: Uint8Array }) => void;
  onBatch?: (files: File[]) => void;
}) {
  const [options, setOptions] = useState<ConvertOptions>(defaultOptions);
  const [file, setFile] = useState<SourceFile | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [view, setView] = useState<"md" | "read">("md");
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveText, setSaveText] = useState<string | null>(null);
  const [focusCnj, setFocusCnj] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  const [passwordHint, setPasswordHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const cancelRef = useRef({ cancelled: false });

  useEffect(() => {
    setOptions(loadOptions());
  }, []);

  function patchOptions(partial: Partial<ConvertOptions>) {
    setOptions((current) => {
      const next = { ...current, ...partial };
      saveOptions(next);
      return next;
    });
  }

  function takeFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    const files = [...list];
    const batch = files.length > 1 || files.some((item) => item.name.toLowerCase().endsWith(".md") || item.type.startsWith("text/"));
    if (batch && onBatch) {
      onBatch(files);
      return;
    }
    takeFile(files[0] ?? null);
  }

  function takeFile(next: File | null) {
    if (!next) return;
    const looksPdf = next.type === "application/pdf" || next.name.toLowerCase().endsWith(".pdf");
    if (!looksPdf) {
      setPhase({ kind: "error", message: "Escolha um arquivo PDF." });
      return;
    }
    if (next.size > 60 * 1024 * 1024) {
      setPhase({ kind: "error", message: "O PDF passa de 60 MB. Divida o arquivo antes de converter." });
      return;
    }
    void next.arrayBuffer().then((buffer) => {
      cancelRef.current.cancelled = true;
      setFile({ name: next.name, data: new Uint8Array(buffer), size: next.size });
      setResult(null);
      setAskPassword(false);
      setPassword("");
      setPasswordHint(null);
      setPhase({ kind: "idle" });
    });
  }

  function loadSample() {
    const data = samplePdfBytes();
    cancelRef.current.cancelled = true;
    setFile({ name: SAMPLE_PDF_NAME, data, size: data.byteLength });
    setResult(null);
    setAskPassword(false);
    setPassword("");
    setPasswordHint(null);
    setPhase({ kind: "idle" });
  }

  function clearAll() {
    cancelRef.current.cancelled = true;
    setFile(null);
    setResult(null);
    setAskPassword(false);
    setPassword("");
    setPasswordHint(null);
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function convert() {
    if (!file) return;
    const token = { cancelled: false };
    cancelRef.current = token;
    setPhase({ kind: "reading", page: 0, total: 0 });
    setCopied(false);
    setSaveNote(null);
    setSaveText(null);
    setFocusCnj(null);
    let pdf: typeof import("@/lib/pdf-to-md") | null = null;
    try {
      pdf = await import("@/lib/pdf-to-md");
      const converted = await pdf.pdfToMarkdown(
        file.data,
        options,
        {
          signal: token,
          onPage: (page, total) => {
            if (!token.cancelled) setPhase({ kind: "reading", page, total });
          },
        },
        password,
      );
      if (token.cancelled) return;
      setResult(converted);
      setAskPassword(false);
      setPasswordHint(null);
      setPhase({ kind: "done" });
      setView("md");
      requestAnimationFrame(() => {
        outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      if (token.cancelled) return;
      if (pdf && error instanceof pdf.PdfNeedsPasswordError) {
        setAskPassword(true);
        setPasswordHint(error.incorrect ? "Senha incorreta." : "Este PDF pede senha.");
        setPhase({ kind: "idle" });
        return;
      }
      const message = error instanceof Error ? error.message : "Não foi possível ler o PDF.";
      setPhase({ kind: "error", message });
    }
  }

  async function copyMarkdown() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setPhase({ kind: "error", message: "O navegador bloqueou a cópia. Baixe o .md." });
    }
  }

  async function downloadMarkdown() {
    if (!result || !file) return;
    const name = `${file.name.replace(/\.pdf$/i, "") || "documento"}.md`;
    const outcome = await saveTextFile(name, result.markdown);
    if (outcome === "cancelled") return;
    if (outcome === "failed") {
      setSaveText(result.markdown);
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

  const busy = phase.kind === "reading";

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className={embedded ? "hidden" : "border-b border-line px-4 py-5 lg:px-8"}>
        <div className="mx-auto flex max-w-6xl items-start gap-4">
          <img src="/favicon.svg" alt="" width={40} height={40} className="mt-1 size-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs tracking-widest text-muted uppercase">PDF para Markdown</p>
            <h1 className="text-balance font-sans text-4xl leading-none font-medium">Folio</h1>
            <p className="mt-2 max-w-xl text-pretty text-muted">
              Converte no navegador. A leitura não envia o arquivo.
            </p>
            <button type="button" onClick={onOpenDiary} className="mt-3 text-sm text-accent underline underline-offset-2">
              Ler o DJE nº 223 já convertido
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl lg:grid-cols-12">
        <section className="border-b border-line px-4 py-5 lg:col-span-4 lg:border-r lg:border-b-0 lg:px-6 lg:py-6">
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              takeFiles(event.dataTransfer.files);
            }}
            className={
              "flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 py-6 text-center " +
              (dragOver ? "border-accent bg-surface" : "border-line bg-surface")
            }
          >
            <FileUp className="size-6 text-accent" aria-hidden />
            <span className="mt-3 text-lg leading-tight">Solte PDF ou Markdown</span>
            <span className="mt-1 text-sm text-muted">um ou vários arquivos, só neste navegador</span>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf,text/markdown,.md,text/plain"
              multiple
              className="sr-only"
              onChange={(event) => {
                takeFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={loadSample}
              className="h-11 flex-1 rounded-md border border-line bg-surface px-3 text-sm"
            >
              Abrir exemplo
            </button>
            {file ? (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm text-muted"
              >
                <Trash2 className="size-4" aria-hidden />
                Limpar
              </button>
            ) : null}
          </div>

          {file ? (
            <p className="mt-4 text-sm">
              <span className="font-medium">{file.name}</span>
              <span className="mt-1 block font-mono text-xs text-muted tabular-nums">{formatBytes(file.size)}</span>
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted">Nenhum arquivo ainda.</p>
          )}

          <fieldset className="mt-6 border-0 p-0" disabled={busy}>
            <legend className="text-xs tracking-widest text-muted uppercase">Ajustes</legend>
            <div className="mt-2 divide-y divide-line">
              <Toggle
                checked={options.inferHeadings}
                onChange={(inferHeadings) => patchOptions({ inferHeadings })}
                label="Inferir títulos"
                hint="Pelo tamanho da fonte e pelo negrito"
              />
              <Toggle
                checked={options.reflow}
                onChange={(reflow) => patchOptions({ reflow })}
                label="Juntar linhas em parágrafos"
              />
              <Toggle
                checked={options.dehyphenate}
                onChange={(dehyphenate) => patchOptions({ dehyphenate })}
                label="Desfazer hífen de quebra"
              />
              <Toggle
                checked={options.stripChrome}
                onChange={(stripChrome) => patchOptions({ stripChrome })}
                label="Remover cabeçalho e rodapé"
                hint="Texto repetido nas margens, a partir de 2 páginas"
              />
              <Toggle
                checked={options.includeOutline}
                onChange={(includeOutline) => patchOptions({ includeOutline })}
                label="Incluir sumário do PDF"
              />
              <Toggle
                checked={options.frontMatter}
                onChange={(frontMatter) => patchOptions({ frontMatter })}
                label="Metadados no topo"
              />
            </div>

            <label className="mt-4 block text-sm">
              Marca de página
              <select
                value={options.pageMarker}
                onChange={(event) => patchOptions({ pageMarker: event.target.value as PageMarker })}
                className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 text-fg"
              >
                {MARKERS.map((marker) => (
                  <option key={marker.id} value={marker.id}>
                    {marker.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-sm">
              Intervalo de páginas
              <input
                value={options.pageRange}
                onChange={(event) => patchOptions({ pageRange: event.target.value })}
                placeholder="todas, ou 1-3, 5"
                className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-mono text-sm text-fg placeholder:text-muted"
              />
            </label>
          </fieldset>

          {askPassword ? (
            <label className="mt-4 block text-sm">
              <span className="inline-flex items-center gap-2">
                <Lock className="size-4 text-accent" aria-hidden />
                Senha do PDF
              </span>
              <input
                type="password"
                value={password}
                autoComplete="off"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void convert();
                }}
                className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 text-fg"
              />
              {passwordHint ? <span className="mt-1 block text-sm text-accent">{passwordHint}</span> : null}
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => {
              if (busy) {
                cancelRef.current.cancelled = true;
                setPhase({ kind: "idle" });
                return;
              }
              void convert();
            }}
            disabled={!file && !busy}
            className="mt-5 h-12 w-full rounded-md bg-accent text-base font-medium text-accent-fg disabled:opacity-40"
          >
            {busy ? "Cancelar" : "Converter"}
          </button>

          <p className="mt-3 min-h-5 text-sm text-muted" aria-live="polite">
            {phase.kind === "reading"
              ? phase.total
                ? `Página ${phase.page} de ${phase.total}`
                : "Abrindo o PDF…"
              : phase.kind === "error"
                ? ""
                : "Sem OCR: digitalização sem camada de texto não é lida."}
          </p>

          {phase.kind === "error" ? (
            <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-accent">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {phase.message}
            </p>
          ) : null}
        </section>

        <section ref={outputRef} className="min-w-0 px-4 py-5 lg:col-span-8 lg:px-8 lg:py-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-line p-1">
              <Tab active={view === "md"} onClick={() => setView("md")} label="Markdown" />
              <Tab active={view === "read"} onClick={() => setView("read")} label="Leitura" icon={<BookOpen className="size-4" aria-hidden />} />
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => void copyMarkdown()}
                disabled={!result}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm disabled:opacity-40"
              >
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={() => void downloadMarkdown()}
                disabled={!result}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm disabled:opacity-40"
              >
                <Download className="size-4" aria-hidden />
                Baixar .md
              </button>
              {onInclude && file ? (
                <button
                  type="button"
                  onClick={() => onInclude({ name: file.name, data: file.data })}
                  disabled={!result || busy}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
                >
                  Incluir no acervo
                </button>
              ) : null}
            </div>
          </div>
          {saveNote ? (
            <p className="mt-2 text-sm text-muted" role="status">
              {saveNote}
            </p>
          ) : null}
          <SavePanel text={saveText} />

          {result ? (
            <p className="mt-3 font-mono text-xs text-muted tabular-nums">
              {result.pagesConverted} de {result.pageCount} páginas
              {" · "}
              {result.headingCount} títulos
              {" · "}
              {result.charCount.toLocaleString("pt-BR")} caracteres
              {result.columnsDetected ? " · colunas detectadas" : ""}
              {result.chromeRemoved > 0 ? ` · ${result.chromeRemoved} linhas de cabeçalho ou rodapé fora` : ""}
              {result.processes.length > 0 ? ` · ${result.processes.length} processos` : ""}
            </p>
          ) : null}

          {result && result.chromeSamples.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Ver o que foi removido do topo e do rodapé</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
                {result.chromeSamples.map((sample) => (
                  <li key={sample} className="truncate">{sample}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {result && result.processes.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs tracking-widest text-muted uppercase">Processos</p>
              <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {result.processes.slice(0, 40).map((item) => (
                  <li key={item.cnj}>
                    <button
                      type="button"
                      onClick={() => {
                        setView("md");
                        setFocusCnj(item.cnj);
                      }}
                      className="font-mono text-sm text-accent underline-offset-2 hover:underline"
                    >
                      {item.cnj}
                      <span className="text-muted"> · p. {item.page}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {result.processes.length > 40 ? (
                <p className="mt-1 text-xs text-muted">E mais {result.processes.length - 40}. Estão no Markdown.</p>
              ) : null}
            </div>
          ) : null}

          {result?.likelyScan ? (
            <p role="status" className="mt-3 flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              Quase não há texto selecionável. Se for uma digitalização, o Folio não lê a imagem.
            </p>
          ) : null}

          {result && result.emptyPages > 0 && !result.likelyScan ? (
            <p className="mt-3 text-sm text-muted">
              {result.emptyPages} {result.emptyPages === 1 ? "página sem texto" : "páginas sem texto"}.
            </p>
          ) : null}

          <div className="mt-4 min-h-96 rounded-md border border-line bg-surface">
            {!result ? (
              <p className="px-5 py-8 text-muted">O Markdown aparece aqui.</p>
            ) : view === "md" ? (
              <pre className="overflow-x-auto px-5 py-5 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">
                <MarkdownText text={result.markdown} focus={focusCnj} />
              </pre>
            ) : (
              <article className="px-5 py-6 text-base leading-relaxed">
                <Reading source={result.markdown} />
              </article>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MarkdownText({ text, focus }: { text: string; focus: string | null }) {
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [focus, text]);
  if (!focus) return <>{text}</>;
  const index = text.indexOf(focus);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark ref={markRef} className="rounded-sm bg-accent/25 text-fg">
        {focus}
      </mark>
      {text.slice(index + focus.length)}
    </>
  );
}

function Tab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "inline-flex h-9 items-center gap-2 rounded-sm px-3 text-sm " +
        (active ? "bg-surface-2 text-fg" : "text-muted")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-3 text-left"
    >
      <span>
        <span className="block text-sm">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-snug text-muted">{hint}</span> : null}
      </span>
      <span
        aria-hidden
        className={"relative h-6 w-11 shrink-0 rounded-full " + (checked ? "bg-accent" : "bg-surface-2")}
      >
        <span
          className={
            "absolute top-0.5 size-5 rounded-full bg-fg transition-transform " +
            (checked ? "translate-x-5" : "translate-x-0.5")
          }
        />
      </span>
    </button>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
