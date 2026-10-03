import { useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FileUp,
  Folder,
  Info,
  Link2,
  Lock,
  Plus,
  Scale,
  Scissors,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { CadernoReader } from "@/components/caderno-reader";
import { PdfOrigin } from "@/components/pdf-origin";
import { classificationDisclaimer, fieldValue } from "@/lib/acervo/classify";
import { fictionalArchive } from "@/lib/acervo/fixtures";
import { pageSlices } from "@/lib/acervo/quality";
import { pdfBytes, rememberPdf, retainPdfs } from "@/lib/acervo/pdf-store";
import {
  ingestDocument,
  linkDuplicates,
  mergeWithNext,
  splitAct,
  undoBoundary,
  updateField,
} from "@/lib/acervo/pipeline";
import type { Act, ArchiveDoc, Improvement } from "@/lib/acervo/types";
import { UNKNOWN } from "@/lib/acervo/types";
import { archiveZip, type ZipParts } from "@/lib/acervo/zip";
import { saveBinaryFile, saveTextFile } from "@/lib/save-text-file";

type View =
  | "home"
  | "preparar"
  | "separar"
  | "classificar"
  | "extracao"
  | "lista"
  | "detalhe"
  | "exportar"
  | "melhorias"
  | "processamento"
  | "dados"
  | "caderno";

type Tab = "converter" | "acervo" | "revisao" | "ajustes";

type PendingFile = {
  name: string;
  kind: "pdf" | "md";
  text?: string;
  data?: Uint8Array;
  pages: number | null;
};

type Pair = { doc: ArchiveDoc; act: Act };

const BACK: Partial<Record<View, View>> = {
  preparar: "home",
  extracao: "preparar",
  separar: "extracao",
  classificar: "separar",
  detalhe: "lista",
  exportar: "lista",
  dados: "processamento",
  processamento: "home",
  melhorias: "lista",
};

const CLASSES = [
  "prestação de contas anual partidária",
  "prestação de contas eleitorais",
  "representação",
  "AIJE",
  "AIME",
  "registro de candidatura",
  "cumprimento de sentença",
  "matéria criminal eleitoral",
];

function tabOf(view: View): Tab {
  if (view === "lista" || view === "detalhe" || view === "exportar") return "acervo";
  if (view === "extracao" || view === "melhorias") return "revisao";
  if (view === "processamento" || view === "dados") return "ajustes";
  return "converter";
}

function choices(current: string, presets: string[]): string[] {
  return [...new Set([current, ...presets, UNKNOWN])];
}

function classeCurta(value: string): string {
  if (value.includes("anual")) return "Contas anuais";
  if (value.includes("eleitorais")) return "Contas eleitorais";
  if (value === "representação") return "Representações";
  if (value === UNKNOWN) return "A classificar";
  return value;
}

function pagesLabel(act: Act): string {
  if (!act.pdfPages.length) return "Página não marcada";
  if (act.pdfPages.length === 1) return `Página ${act.pdfPages[0]}`;
  return `Páginas ${act.pdfPages[0]}–${act.pdfPages[act.pdfPages.length - 1]}`;
}

function applyFills(text: string, fills: Record<string, string>): string {
  return text.replace(/\[[A-ZÁÉÍÓÚ_]+\]/g, (token) => (fills[token]?.trim() ? fills[token].trim() : token));
}

export function AcervoShell() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("home");
  const [docs, setDocs] = useState<ArchiveDoc[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  const [options, setOptions] = useState({ pageMarks: true, metadata: true, reflow: true, hyphens: true, chrome: false, range: "" });
  const [query, setQuery] = useState("");
  const [classeFilter, setClasseFilter] = useState("");
  const [ritoFilter, setRitoFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [detailTab, setDetailTab] = useState<"modelo" | "fonte">("modelo");
  const [showFill, setShowFill] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const [fills, setFills] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Improvement["kind"]>("editorial");
  const [improveAt, setImproveAt] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "aceita" | "original">>({});
  const [pageAt, setPageAt] = useState(0);
  const [extractTab, setExtractTab] = useState<"pdf" | "md">("pdf");
  const [marked, setMarked] = useState<number[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [zipParts, setZipParts] = useState<Required<ZipParts>>({ models: true, sources: true, index: true, improvements: true, gaps: true });
  const [prefNote, setPrefNote] = useState<string | null>(null);

  function commit(next: ArchiveDoc[]) {
    const linked = linkDuplicates(next);
    retainPdfs(linked.map((doc) => doc.id));
    setDocs(linked);
    return linked;
  }

  function replace(doc: ArchiveDoc) {
    commit(docs.map((item) => (item.id === doc.id ? doc : item)));
  }

  const pairs = useMemo(() => docs.flatMap((doc) => doc.acts.map((act) => ({ doc, act }))), [docs]);
  const current = pairs.find((item) => item.act.id === selected) ?? pairs[0] ?? null;
  const visible = pairs.filter(({ act }) => {
    const hay = `${act.title}\n${act.text}`.toLowerCase();
    if (query.trim() && !hay.includes(query.trim().toLowerCase())) return false;
    if (classeFilter && fieldValue(act.fields, "classe") !== classeFilter) return false;
    if (ritoFilter && fieldValue(act.fields, "rito") !== ritoFilter) return false;
    return true;
  });

  async function takeFiles(list: FileList | File[]) {
    setBusy(true);
    setNote(null);
    try {
      const next: PendingFile[] = [];
      for (const file of list) {
        const markdown = file.name.toLowerCase().endsWith(".md") || file.type.startsWith("text/");
        if (markdown) {
          const text = await file.text();
          const pages = [...text.matchAll(/<!--\s*página\s+(\d+)/g)].map((match) => Number(match[1]));
          next.push({ name: file.name, kind: "md", text, pages: pages.length ? Math.max(...pages) : null });
          continue;
        }
        const data = new Uint8Array(await file.arrayBuffer());
        let pages: number | null = null;
        try {
          const pdf = await import("@/lib/pdf-to-md");
          const doc = await pdf.openPdf(data);
          pages = doc.numPages;
          await doc.loadingTask.destroy();
        } catch {
          pages = null;
        }
        next.push({ name: file.name, kind: "pdf", data, pages });
      }
      setPending(next);
      setAskPassword(false);
      setView("preparar");
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    if (!pending.length) return;
    setBusy(true);
    setNote(null);
    try {
      const pdf = await import("@/lib/pdf-to-md");
      const created: ArchiveDoc[] = [];
      for (const file of pending) {
        if (file.kind === "md" && file.text) {
          created.push(ingestDocument({ filename: file.name, faithful: file.text, reading: file.text, hasPdf: false }));
          continue;
        }
        if (!file.data) continue;
        const base = {
          pageRange: options.range,
          includeOutline: false,
          frontMatter: options.metadata,
          pageMarker: options.pageMarks ? ("comment" as const) : ("none" as const),
        };
        const faithful = await pdf.pdfToMarkdown(file.data, { ...base, inferHeadings: false, reflow: options.reflow, stripChrome: false, dehyphenate: false }, undefined, password);
        const reading = await pdf.pdfToMarkdown(
          file.data,
          { ...base, inferHeadings: true, reflow: options.reflow, stripChrome: options.chrome, dehyphenate: options.hyphens },
          undefined,
          password,
        );
        const archive = ingestDocument({
          filename: file.name,
          faithful: faithful.markdown,
          reading: reading.markdown,
          hasPdf: true,
          chromeSamples: reading.chromeSamples,
          columnsDetected: reading.columnsDetected,
          likelyScan: reading.likelyScan,
        });
        rememberPdf(archive.id, file.data);
        created.push(archive);
      }
      const linked = commit([...created, ...docs]);
      setSelected(linked[0]?.acts[0]?.id ?? null);
      setPageAt(0);
      setExtractTab("pdf");
      setView("extracao");
      setNote("Leitura local concluída. Confira antes de separar os atos.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao ler o arquivo.";
      if (/senha/i.test(message)) setAskPassword(true);
      setNote(message);
    } finally {
      setBusy(false);
    }
  }

  function loadExamples() {
    const linked = commit(fictionalArchive());
    setSelected(linked[0]?.acts[0]?.id ?? null);
    setView("lista");
    setNote("Exemplos fictícios. Não são atos reais.");
  }

  async function downloadZip() {
    if (!docs.length) return;
    const bytes = archiveZip(docs, zipParts);
    const result = await saveBinaryFile("acervo-folio.zip", bytes, "application/zip");
    if (result === "failed") setNote("O ZIP não foi salvo. No iPhone, o compartilhamento do sistema precisa aceitar o arquivo.");
    else if (result === "shared") setNote("ZIP aberto na folha de compartilhamento. Nada foi enviado ao GitHub.");
    else if (result === "downloaded") setNote("ZIP gerado neste aparelho. Nada foi enviado ao GitHub.");
  }

  if (view === "caderno") return <CadernoReader onConvertOther={() => setView("home")} />;

  const pendingCount = pairs.filter(({ act }) => act.review !== "revisada").length;
  const suggestions = pairs.flatMap(({ act }) => act.improvements.filter((item) => item.kind === kind).map((item) => ({ act, item })));
  const suggestion = suggestions[Math.min(improveAt, Math.max(suggestions.length - 1, 0))] ?? null;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6 pb-28">
        <Top view={view} saved={current ? saved.includes(current.act.id) : false} onBack={() => BACK[view] && setView(BACK[view])} onGear={() => setView("processamento")} onPlus={() => setView("home")} onSave={() => current && setSaved((ids) => (ids.includes(current.act.id) ? ids.filter((id) => id !== current.act.id) : [...ids, current.act.id]))} />
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
        {busy ? <p className="mt-3 text-sm">Lendo o arquivo…</p> : null}

        {view === "home" ? (
          <Home busy={busy} onPick={() => inputRef.current?.click()} onExample={loadExamples} hasDocs={docs.length > 0} onOpen={() => setView("lista")} />
        ) : null}
        {view === "preparar" ? (
          <Preparar
            pending={pending}
            options={options}
            password={password}
            askPassword={askPassword}
            busy={busy}
            onPassword={setPassword}
            onOptions={setOptions}
            onConvert={() => void convert()}
          />
        ) : null}
        {view === "extracao" && current ? (
          <Extracao
            pair={current}
            pageAt={pageAt}
            tab={extractTab}
            marked={marked}
            onTab={setExtractTab}
            onPage={setPageAt}
            onMark={(page) => setMarked((pages) => (pages.includes(page) ? pages : [...pages, page]))}
            onNext={() => setView("separar")}
          />
        ) : null}
        {view === "separar" ? (
          <Separar
            pairs={pairs}
            selected={current?.act.id ?? null}
            checked={checked}
            onSelect={(id) => {
              setSelected(id);
              setChecked([id]);
            }}
            onCheck={(id) => setChecked((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))}
            onSplit={() => {
              if (!current) return;
              const parts = current.act.text.split(/\n{2,}/);
              if (parts.length < 2) {
                setNote("Este ato não tem outro parágrafo para dividir.");
                return;
              }
              const next = splitAct(current.doc, current.act.id, 1);
              replace(next);
              setNote("Ato dividido. A classe de cada trecho foi recalculada.");
            }}
            onMerge={() => {
              if (!current) return;
              const next = mergeWithNext(current.doc, current.act.id);
              if (next.acts.length === current.doc.acts.length) {
                setNote("Não há ato seguinte para unir.");
                return;
              }
              replace(next);
              setNote(next.acts.find((act) => act.id === current.act.id)?.warning ?? "Atos unidos.");
            }}
            onUndo={() => current && replace(undoBoundary(current.doc))}
            onConfirm={() => setView("classificar")}
          />
        ) : null}
        {view === "classificar" && current ? (
          <Classificar
            pair={current}
            onField={(key, value) => replace(updateField(current.doc, current.act.id, key, value))}
            onOrigin={() => {
              setPageAt(0);
              setView("extracao");
            }}
            onSave={() => {
              replace(updateField(current.doc, current.act.id, "revisao", "revisada"));
              setView("lista");
              setNote("Classificação marcada como revisada nesta sessão.");
            }}
          />
        ) : null}
        {view === "lista" ? (
          <Lista
            pairs={visible}
            all={pairs}
            query={query}
            classe={classeFilter}
            rito={ritoFilter}
            showAll={showAll}
            onQuery={setQuery}
            onClasse={setClasseFilter}
            onRito={setRitoFilter}
            onMore={() => setShowAll(true)}
            onOpen={(id) => {
              setSelected(id);
              setDetailTab("modelo");
              setShowFill(false);
              setView("detalhe");
            }}
            onExport={() => setView("exportar")}
            onExample={loadExamples}
          />
        ) : null}
        {view === "detalhe" && current ? (
          <Detalhe
            pair={current}
            tab={detailTab}
            showFill={showFill}
            showLimits={showLimits}
            fills={fills}
            onTab={setDetailTab}
            onFill={() => setShowFill((value) => !value)}
            onLimits={() => setShowLimits((value) => !value)}
            onChange={(token, value) => setFills((currentFills) => ({ ...currentFills, [token]: value }))}
            onDownload={() => void saveTextFile(current.act.template.title, applyFills(templateBody(current.act), fills))}
            onOrigin={() => setView("extracao")}
          />
        ) : null}
        {view === "melhorias" ? (
          <Melhorias
            kind={kind}
            index={improveAt}
            total={suggestions.length}
            row={suggestion}
            decision={suggestion ? decisions[`${suggestion.act.id}-${suggestion.item.id}`] : undefined}
            onKind={(next) => {
              setKind(next);
              setImproveAt(0);
            }}
            onMove={(delta) => setImproveAt((value) => Math.min(Math.max(value + delta, 0), Math.max(suggestions.length - 1, 0)))}
            onDecide={(decision) => {
              if (!suggestion) return;
              setDecisions((map) => ({ ...map, [`${suggestion.act.id}-${suggestion.item.id}`]: decision }));
              setNote(decision === "aceita" ? "Aceite registrado nesta sessão. O texto original não foi reescrito." : "Original mantido.");
            }}
            onOrigin={() => setView("extracao")}
            onExample={loadExamples}
          />
        ) : null}
        {view === "exportar" ? (
          <Exportar parts={zipParts} pending={pendingCount} onToggle={(key) => setZipParts((currentParts) => ({ ...currentParts, [key]: !currentParts[key] }))} onPending={() => setView("melhorias")} onZip={() => void downloadZip()} />
        ) : null}
        {view === "processamento" ? (
          <Processamento
            note={prefNote}
            onData={() => setView("dados")}
            onCaderno={() => setView("caderno")}
            onSave={() => {
              try {
                localStorage.setItem("folio-modo", "local");
              } catch {
                /* o aparelho pode bloquear armazenamento */
              }
              setPrefNote("Preferência salva neste aparelho: só leitura local. Nenhum documento é enviado.");
            }}
            onRemote={() => setNote("IA remota está desativada. Nenhum documento sai deste aparelho.")}
          />
        ) : null}
        {view === "dados" ? <Dados docs={docs} /> : null}
        {view !== "home" && view !== "preparar" && !pairs.length && view !== "processamento" && view !== "dados" ? null : null}
      </div>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf,text/markdown,.md,text/plain" multiple className="hidden" onChange={(event) => { const files = event.target.files; if (files?.length) void takeFiles(files); event.target.value = ""; }} />
      <Nav tab={tabOf(view)} onTab={(tab) => setView(tab === "converter" ? "home" : tab === "acervo" ? "lista" : tab === "revisao" ? "melhorias" : "processamento")} />
    </div>
  );
}

function Top({ view, saved, onBack, onGear, onPlus, onSave }: { view: View; saved: boolean; onBack: () => void; onGear: () => void; onPlus: () => void; onSave: () => void }) {
  const back = Boolean(BACK[view]);
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {back ? (
          <button type="button" aria-label="Voltar" onClick={onBack} className="grid h-11 w-11 place-items-center text-fg">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <Mark />
        )}
        {back ? <Mark /> : null}
        <p className="font-serif text-2xl leading-none">Fólio</p>
      </div>
      {view === "lista" ? (
        <button type="button" aria-label="Adicionar documento" onClick={onPlus} className="grid h-11 w-11 place-items-center rounded-full border border-line">
          <Plus className="h-5 w-5" />
        </button>
      ) : null}
      {view === "detalhe" ? (
        <button type="button" aria-label="Guardar nos favoritos desta sessão" aria-pressed={saved} onClick={onSave} className="grid h-11 w-11 place-items-center">
          <Bookmark className={"h-5 w-5 " + (saved ? "fill-accent text-accent" : "")} />
        </button>
      ) : null}
      {view === "home" || view === "exportar" ? (
        <button type="button" aria-label="Ajustes" onClick={onGear} className="grid h-11 w-11 place-items-center text-muted">
          <Settings className="h-6 w-6" />
        </button>
      ) : null}
    </header>
  );
}

function Mark() {
  return (
    <span className="grid h-9 w-8 shrink-0 place-items-center rounded-sm bg-accent text-accent-fg">
      <FileText className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}

function Home({ busy, hasDocs, onPick, onExample, onOpen }: { busy: boolean; hasDocs: boolean; onPick: () => void; onExample: () => void; onOpen: () => void }) {
  return (
    <div>
      <h1 className="mt-8 font-serif text-5xl leading-none font-medium text-balance">Do documento ao modelo.</h1>
      <p className="mt-4 max-w-xs text-lg text-muted">Converta, confira e organize seus documentos jurídicos.</p>
      <div className="mt-8 rounded-md border border-dashed border-line px-4 py-8 text-center">
        <FileUp className="mx-auto h-8 w-8 text-accent" />
        <p className="mt-4 font-serif text-2xl">Adicionar documentos</p>
        <p className="mt-1 text-sm tracking-wide text-muted uppercase">PDF ou Markdown</p>
        <button type="button" disabled={busy} onClick={onPick} className="mt-6 h-12 w-full rounded-md bg-accent text-base font-semibold text-accent-fg disabled:opacity-40">
          Escolher arquivos
        </button>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
        <Lock className="h-4 w-4" /> Conversão local no navegador
      </p>
      <p className="mt-8 text-xs tracking-widest text-muted uppercase">Recente</p>
      <div className="mt-3 rounded-md border border-line px-3 py-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{hasDocs ? "Acervo desta sessão" : "Modelos de exemplo.md"}</span>
            <span className="block text-sm text-muted">{hasDocs ? "Aberto agora" : "Dados de exemplo"}</span>
          </span>
          <button type="button" onClick={hasDocs ? onOpen : onExample} className="text-sm font-semibold text-accent">
            {hasDocs ? "Abrir" : "Abrir exemplo"} <ChevronRight className="inline h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="mt-8 flex items-start gap-2 border-t border-line pt-4 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> Sem OCR: PDFs digitalizados exigem revisão.
      </p>
    </div>
  );
}

function Preparar({
  pending,
  options,
  password,
  askPassword,
  busy,
  onPassword,
  onOptions,
  onConvert,
}: {
  pending: PendingFile[];
  options: { pageMarks: boolean; metadata: boolean; reflow: boolean; hyphens: boolean; chrome: boolean; range: string };
  password: string;
  askPassword: boolean;
  busy: boolean;
  onPassword: (value: string) => void;
  onOptions: (next: typeof options) => void;
  onConvert: () => void;
}) {
  const file = pending[0];
  const pages = file?.pages ? `${file.pages} páginas` : "páginas ainda não contadas";
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Preparar conversão</h1>
      <p className="mt-2 text-muted">Escolha como preservar o documento.</p>
      <Stepper step={2} />
      {file ? (
        <div className="mt-4 flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-3">
          <FileText className="h-5 w-5 text-muted" />
          <span>
            <span className="block font-medium">{file.name}</span>
            <span className="block text-sm text-muted">{pages}{pending.length > 1 ? ` · e mais ${pending.length - 1}` : ""} · {file.kind === "pdf" ? "PDF" : "Markdown"}</span>
          </span>
        </div>
      ) : null}
      <Section title="Preservação" />
      <Toggle on={options.pageMarks} label="Manter marcas de página" hint="A origem acompanha cada trecho." onChange={(pageMarks) => onOptions({ ...options, pageMarks })} />
      <Toggle on={options.metadata} label="Preservar metadados" hint="Órgão, edição e assinatura ficam registrados à parte." onChange={(metadata) => onOptions({ ...options, metadata })} />
      <Section title="Limpeza do texto" />
      <Toggle on={options.reflow} label="Juntar linhas em parágrafos" hint="A leitura deixa de seguir a quebra da coluna." onChange={(reflow) => onOptions({ ...options, reflow })} />
      <Toggle on={options.hyphens} label="Corrigir hifens de quebra" hint="Número de processo e palavra composta permanecem." onChange={(hyphens) => onOptions({ ...options, hyphens })} />
      <Toggle on={options.chrome} label="Remover cabeçalhos e rodapés" hint="Remove textos repetidos nas margens." onChange={(chrome) => onOptions({ ...options, chrome })} />
      <Section title="Páginas" />
      <label className="mt-3 block text-sm">
        <span className="sr-only">Intervalo de páginas</span>
        <input value={options.range} onChange={(event) => onOptions({ ...options, range: event.target.value })} placeholder="Todas" className="h-12 w-full rounded-md border border-line bg-bg px-3" />
      </label>
      <p className="mt-2 text-sm text-muted">Ou indique: 1–3, 5</p>
      {askPassword ? (
        <label className="mt-4 block text-sm">
          Senha do PDF
          <input type="password" value={password} onChange={(event) => onPassword(event.target.value)} className="mt-1 h-12 w-full rounded-md border border-line bg-bg px-3" />
        </label>
      ) : null}
      <p className="mt-4 flex items-start gap-2 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> O original será preservado na versão fiel.
      </p>
      <button type="button" disabled={busy || !pending.length} onClick={onConvert} className="mt-6 h-12 w-full rounded-md bg-accent text-base font-semibold text-accent-fg disabled:opacity-40">
        Converter documento
      </button>
    </div>
  );
}

function Extracao({
  pair,
  pageAt,
  tab,
  marked,
  onTab,
  onPage,
  onMark,
  onNext,
}: {
  pair: Pair;
  pageAt: number;
  tab: "pdf" | "md";
  marked: number[];
  onTab: (tab: "pdf" | "md") => void;
  onPage: (index: number) => void;
  onMark: (page: number) => void;
  onNext: () => void;
}) {
  const slices = pageSlices(pair.doc.cleanupUndone ? pair.doc.faithful : pair.doc.reading);
  const slice = slices[Math.min(pageAt, slices.length - 1)] ?? slices[0];
  const empty = pair.doc.quality.emptyPages;
  const page = slice?.page ?? pair.act.pdfPages[0] ?? 0;
  const paragraphs = (slice?.text ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const focus = paragraphs.find((part) => part.length > 40) ?? paragraphs[0] ?? "";
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Conferir extração</h1>
      <div className="mt-4 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-surface-2"><FileText className="h-4 w-4" /></span>
        <span>
          <span className="block font-medium">{pair.doc.filename}</span>
          <span className="block text-sm text-muted">{pair.doc.hasPdf ? "PDF incluído nesta sessão" : "Dados de exemplo"}</span>
        </span>
      </div>
      {empty.length ? (
        <div className="mt-4 rounded-md border border-line bg-surface px-3 py-3">
          <p className="font-semibold text-warn">{empty.length} {empty.length === 1 ? "página precisa" : "páginas precisam"} de revisão</p>
          <p className="text-sm text-muted">Páginas {empty.join(" e ")} sem texto extraído.</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{pair.doc.quality.integral ? "Todas as páginas marcadas têm texto." : "A leitura não está marcada como integral."}</p>
      )}
      <div className="mt-4 flex border-b border-line">
        {(["pdf", "md"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onTab(item)} className={"h-11 flex-1 text-sm " + (tab === item ? "border-b-2 border-accent text-fg" : "text-muted")}>
            {item === "pdf" ? "PDF original" : "Markdown"}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" aria-label="Página anterior" onClick={() => onPage(Math.max(pageAt - 1, 0))} className="grid h-11 w-11 place-items-center rounded-md border border-line"><ChevronLeft className="h-5 w-5" /></button>
        <p>Página {slice?.page ?? "—"}{slices.length ? ` de ${slices.length}` : ""}</p>
        <button type="button" aria-label="Próxima página" onClick={() => onPage(Math.min(pageAt + 1, Math.max(slices.length - 1, 0)))} className="grid h-11 w-11 place-items-center rounded-md border border-line"><ChevronRight className="h-5 w-5" /></button>
      </div>
      {tab === "pdf" && pdfBytes(pair.doc.id) && page ? <PdfOrigin docId={pair.doc.id} pages={[page]} /> : null}
      <article className="mt-3 rounded-md bg-paper p-5 text-ink">
        {tab === "md" ? (
          <pre className="font-mono text-xs whitespace-pre-wrap">{slice?.text || "Página sem texto extraído."}</pre>
        ) : paragraphs.length ? (
          paragraphs.map((part) => (
            <p key={part.slice(0, 48)} className={"mt-4 first:mt-0 " + (part === focus ? "rounded-sm px-2 py-2 ring-1 ring-accent" : "")}>{part}</p>
          ))
        ) : (
          <p>Página sem texto extraído.</p>
        )}
      </article>
      {!pdfBytes(pair.doc.id) ? <p className="mt-2 text-xs text-muted">Sem a imagem do PDF nesta sessão. O quadro mostra o texto extraído.</p> : null}
      <div className="mt-4 flex items-center justify-between text-sm">
        <button type="button" onClick={() => onTab("md")} className="font-semibold text-accent">Ver trecho no Markdown</button>
        <button type="button" onClick={() => page && onMark(page)} className="text-muted">{marked.includes(page) ? "Marcada" : "Marcar para revisão"}</button>
      </div>
      <button type="button" onClick={onNext} className="mt-4 h-12 w-full rounded-md bg-accent font-semibold text-accent-fg">Continuar para separar atos</button>
    </div>
  );
}

function Separar({
  pairs,
  selected,
  checked,
  onSelect,
  onCheck,
  onSplit,
  onMerge,
  onUndo,
  onConfirm,
}: {
  pairs: Pair[];
  selected: string | null;
  checked: string[];
  onSelect: (id: string) => void;
  onCheck: (id: string) => void;
  onSplit: () => void;
  onMerge: () => void;
  onUndo: () => void;
  onConfirm: () => void;
}) {
  const current = pairs.find((item) => item.act.id === selected) ?? pairs[0];
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Separar atos</h1>
      <p className="mt-2 text-muted">Confira onde cada documento começa e termina.</p>
      {!pairs.length ? <p className="mt-6 text-sm text-muted">Nenhum ato ainda. Converta um arquivo ou abra o exemplo.</p> : null}
      <ul className="mt-4 space-y-3">
        {pairs.map(({ act }) => {
          const active = act.id === current?.act.id;
          const on = checked.includes(act.id);
          return (
            <li key={act.id}>
              <div className={"flex items-center gap-3 rounded-md border bg-surface px-3 py-3 " + (active ? "border-accent" : "border-line")}>
                <button type="button" onClick={() => onSelect(act.id)} className="min-w-0 flex-1 text-left">
                  <span className="block font-medium">{act.title}</span>
                  <span className="block text-sm text-muted">{pagesLabel(act)}</span>
                  <span className={"mt-2 inline-flex rounded-full px-2 py-0.5 text-xs " + (act.nature === "extrato" || act.nature === "incompleto" ? "bg-surface-2 text-warn" : "bg-surface-2 text-ok")}>
                    {act.nature === "extrato" || act.nature === "incompleto" ? "Extrato incompleto" : "Limites sugeridos"}
                  </span>
                </button>
                <button type="button" aria-pressed={on} aria-label={`Selecionar ${act.title}`} onClick={() => onCheck(act.id)} className={"grid h-8 w-8 place-items-center rounded-md border " + (on ? "border-accent bg-accent text-accent-fg" : "border-line")}>
                  {on ? <Check className="h-4 w-4" /> : null}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onSplit} className="flex h-12 items-center justify-center gap-2 rounded-md border border-line text-sm"><Scissors className="h-4 w-4" /> Dividir trecho</button>
        <button type="button" onClick={onMerge} className="flex h-12 items-center justify-center gap-2 rounded-md border border-line text-sm"><Link2 className="h-4 w-4" /> Unir trechos</button>
      </div>
      <button type="button" onClick={onUndo} className="mt-2 text-sm text-muted underline underline-offset-2">Desfazer união ou divisão</button>
      {current ? (
        <div className="mt-4">
          <p className="text-xs tracking-widest text-muted uppercase">Trecho selecionado</p>
          <p className="mt-2 rounded-md border border-line bg-surface p-3 text-sm">{current.act.text.slice(0, 220)}{current.act.text.length > 220 ? "…" : ""}</p>
        </div>
      ) : null}
      <button type="button" disabled={!current} onClick={onConfirm} className="mt-6 h-12 w-full rounded-md bg-accent font-semibold text-accent-fg disabled:opacity-40">Confirmar separação</button>
    </div>
  );
}

function Classificar({ pair, onField, onOrigin, onSave }: { pair: Pair; onField: (key: string, value: string) => void; onOrigin: () => void; onSave: () => void }) {
  const fields = [
    ["classe", "Ação / classe", CLASSES],
    ["subtipo", "Subtipo", ["originado de outra ação", "anual partidária"]],
    ["rito", "Rito / procedimento", ["ordinário", "sumário", "especial"]],
    ["fase", "Fase processual", ["conhecimento", "instrução", "julgamento", "cumprimento", "execução"]],
    ["tipo", "Tipo de ato", ["despacho", "sentença", "decisão", "extrato", "certidão"]],
  ] as const;
  const evidence = pair.act.fields.find((item) => item.key === "classe");
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Classificar ato</h1>
      <h2 className="mt-3 font-serif text-2xl">{pair.act.title}</h2>
      <p className="text-sm text-muted">{pair.doc.hasPdf ? pair.doc.filename : "Dados de exemplo"} · {pagesLabel(pair.act)}</p>
      {pair.act.review !== "revisada" ? (
        <p className="mt-4 rounded-md border border-accent px-3 py-2 text-sm font-semibold text-accent">Sugestão pendente de revisão</p>
      ) : (
        <p className="mt-4 text-sm text-ok">Revisão humana registrada nesta sessão.</p>
      )}
      <div className="mt-4 space-y-3">
        {fields.map(([key, label, presets]) => {
          const value = fieldValue(pair.act.fields, key);
          return (
            <label key={key} className="block text-sm">
              {label}
              <select value={value} onChange={(event) => onField(key, event.target.value)} className="mt-1 h-12 w-full rounded-md border border-line bg-surface px-3">
                {choices(value, [...presets]).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      <p className="mt-6 text-xs tracking-widest text-muted uppercase">Evidência no documento</p>
      <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm">
        <p>“{evidence?.evidence || "Sem trecho de apoio."}”</p>
        <button type="button" onClick={onOrigin} className="mt-2 font-semibold text-accent">Ver origem{pair.act.pdfPages[0] ? ` · página ${pair.act.pdfPages[0]}` : ""}</button>
      </blockquote>
      <p className="mt-3 text-sm text-muted">{classificationDisclaimer()} Confirme antes de salvar.</p>
      <button type="button" onClick={onSave} className="mt-6 h-12 w-full rounded-md bg-accent font-semibold text-accent-fg">Salvar classificação</button>
    </div>
  );
}

function Lista({
  pairs,
  all,
  query,
  classe,
  rito,
  showAll,
  onQuery,
  onClasse,
  onRito,
  onMore,
  onOpen,
  onExport,
  onExample,
}: {
  pairs: Pair[];
  all: Pair[];
  query: string;
  classe: string;
  rito: string;
  showAll: boolean;
  onQuery: (value: string) => void;
  onClasse: (value: string) => void;
  onRito: (value: string) => void;
  onMore: () => void;
  onOpen: (id: string) => void;
  onExport: () => void;
  onExample: () => void;
}) {
  const classes = [...new Set(all.map(({ act }) => fieldValue(act.fields, "classe")))];
  const ritos = [...new Set(all.map(({ act }) => fieldValue(act.fields, "rito")))];
  const groups = new Map<string, Pair[]>();
  for (const pair of pairs) {
    const key = fieldValue(pair.act.fields, "classe");
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  const entries = [...groups.entries()];
  const shown = showAll ? entries : entries.slice(0, 1);
  return (
    <div>
      <h1 className="mt-8 font-serif text-5xl leading-none font-medium">Acervo de modelos</h1>
      <p className="mt-3 text-lg text-muted">Encontre o ato para cada etapa.</p>
      <label className="mt-6 flex h-12 items-center gap-2 rounded-md border border-line bg-surface px-3">
        <Search className="h-4 w-4 text-muted" />
        <span className="sr-only">Buscar</span>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar título ou conteúdo" className="h-full w-full bg-transparent" />
      </label>
      <div className="mt-3 flex gap-2">
        <select value={classe} onChange={(event) => onClasse(event.target.value)} aria-label="Ação ou classe" className="h-12 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm">
          <option value="">Ação / classe</option>
          {classes.map((item) => <option key={item} value={item}>{classeCurta(item)}</option>)}
        </select>
        <select value={rito} onChange={(event) => onRito(event.target.value)} aria-label="Rito" className="h-12 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm">
          <option value="">Rito</option>
          {ritos.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button type="button" aria-label="Exportar acervo" onClick={onExport} className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-line"><SlidersHorizontal className="h-4 w-4" /></button>
      </div>
      {!all.length ? (
        <button type="button" onClick={onExample} className="mt-8 text-sm font-semibold text-accent">Abrir exemplos fictícios</button>
      ) : null}
      {shown.map(([key, items]) => (
        <section key={key} className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">{classeCurta(key)} <span className="text-muted">› {classeCurta(fieldValue(items[0].act.fields, "rito"))}</span></h2>
            <span className="text-xs text-muted">{items[0].doc.hasPdf ? items[0].doc.filename : "Dados de exemplo"}</span>
          </div>
          <ul className="mt-2 divide-y divide-line border-t border-line">
            {items.map(({ act }, index) => (
              <li key={act.id}>
                <button type="button" onClick={() => onOpen(act.id)} className="flex w-full items-center gap-3 py-3 text-left">
                  {index === 0 ? <span className="w-1 self-stretch rounded-full bg-accent" /> : <span className="w-1" />}
                  <FileText className="h-5 w-5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{act.title}</span>
                    <span className="block text-sm text-muted">{classeCurta(fieldValue(act.fields, "classe"))} · {fieldValue(act.fields, "fase")}</span>
                    {act.review !== "revisada" ? <span className="mt-1 block text-xs text-warn">{act.improvements.some((item) => item.kind === "jurídica") ? "Revisão jurídica pendente" : "Revisão pendente"}</span> : null}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!showAll && entries.length > 1 ? (
        <button type="button" onClick={onMore} className="mt-4 font-semibold text-accent">Ver outras classes</button>
      ) : null}
      {all.length ? (
        <button type="button" onClick={onExport} className="mt-6 text-sm font-semibold text-accent">Exportar acervo</button>
      ) : null}
    </div>
  );
}

function Detalhe({
  pair,
  tab,
  showFill,
  showLimits,
  fills,
  onTab,
  onFill,
  onLimits,
  onChange,
  onDownload,
  onOrigin,
}: {
  pair: Pair;
  tab: "modelo" | "fonte";
  showFill: boolean;
  showLimits: boolean;
  fills: Record<string, string>;
  onTab: (tab: "modelo" | "fonte") => void;
  onFill: () => void;
  onLimits: () => void;
  onChange: (token: string, value: string) => void;
  onDownload: () => void;
  onOrigin: () => void;
}) {
  const source = tab === "modelo" ? applyFills(pair.act.template.text, fills) : pair.act.text;
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">{pair.act.title}</h1>
      <p className="mt-2 text-sm text-muted">{classeCurta(fieldValue(pair.act.fields, "classe"))} · {fieldValue(pair.act.fields, "fase")} · Modelo derivado</p>
      <p className="text-sm text-muted">{pair.doc.hasPdf ? pair.doc.filename : "Dados de exemplo"}</p>
      <p className="mt-3 text-sm font-semibold text-accent">Revisão jurídica pendente</p>
      <div className="mt-4 flex border-b border-line">
        {(["modelo", "fonte"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onTab(item)} className={"h-11 flex-1 text-sm " + (tab === item ? "border-b-2 border-accent" : "text-muted")}>{item === "modelo" ? "Modelo" : "Fonte"}</button>
        ))}
      </div>
      <button type="button" onClick={onOrigin} className="mt-3 flex w-full items-center gap-2 text-left text-sm text-muted">
        <FileText className="h-4 w-4" /> Origem: {pair.doc.filename} · {pagesLabel(pair.act)}
      </button>
      <article className="mt-3 rounded-md bg-paper p-5 text-ink">
        {source.split(/\n{2,}/).map((part) => (
          <p key={part.slice(0, 40)} className="mt-4 whitespace-pre-wrap first:mt-0" dangerouslySetInnerHTML={{ __html: highlightTokens(part) }} />
        ))}
      </article>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted">{pair.act.template.fields.length} campos para preencher</span>
        <button type="button" onClick={onLimits} className="text-muted">Ver condições de uso</button>
      </div>
      {showLimits ? <ul className="mt-2 list-disc pl-5 text-sm text-muted">{pair.act.template.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul> : null}
      {showFill ? (
        <div className="mt-3 space-y-2">
          {pair.act.template.fields.map((token) => (
            <label key={token} className="block text-sm">
              {token}
              <input value={fills[token] ?? ""} onChange={(event) => onChange(token, event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3" />
            </label>
          ))}
          <p className="text-xs text-muted">A cópia preenchida não altera a fonte nem o processo.</p>
        </div>
      ) : null}
      <button type="button" onClick={onFill} className="mt-4 h-12 w-full rounded-md bg-accent font-semibold text-accent-fg">Preencher campos</button>
      <button type="button" onClick={onDownload} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-md border border-line"><Download className="h-4 w-4" /> Baixar modelo</button>
    </div>
  );
}

function Melhorias({
  kind,
  index,
  total,
  row,
  decision,
  onKind,
  onMove,
  onDecide,
  onOrigin,
  onExample,
}: {
  kind: Improvement["kind"];
  index: number;
  total: number;
  row: { act: Act; item: Improvement } | null;
  decision?: "aceita" | "original";
  onKind: (kind: Improvement["kind"]) => void;
  onMove: (delta: number) => void;
  onDecide: (decision: "aceita" | "original") => void;
  onOrigin: () => void;
  onExample: () => void;
}) {
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Melhorias sugeridas</h1>
      <p className="mt-2 font-serif text-2xl">{row?.act.title ?? "Nenhum ato"}</p>
      <p className="text-sm text-muted">{row ? "Dados desta sessão" : "Abra um documento ou o exemplo."}</p>
      <div className="mt-4 grid grid-cols-2 rounded-md border border-line p-1">
        <button type="button" onClick={() => onKind("editorial")} className={"h-11 rounded-sm text-sm " + (kind === "editorial" ? "bg-surface-2" : "text-muted")}>Editorial</button>
        <button type="button" onClick={() => onKind("jurídica")} className={"flex h-11 items-center justify-center gap-2 rounded-sm text-sm " + (kind === "jurídica" ? "bg-surface-2" : "text-muted")}><Scale className="h-4 w-4" /> Jurídica</button>
      </div>
      {!row ? <button type="button" onClick={onExample} className="mt-6 font-semibold text-accent">Abrir exemplos fictícios</button> : null}
      {row ? (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs tracking-widest text-muted uppercase">Sugestão {index + 1} de {total}</p>
            <span className="flex gap-2">
              <button type="button" aria-label="Anterior" onClick={() => onMove(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-line"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Seguinte" onClick={() => onMove(1)} className="grid h-11 w-11 place-items-center rounded-full border border-line"><ChevronRight className="h-4 w-4" /></button>
            </span>
          </div>
          <h2 className="mt-2 font-serif text-2xl">{row.item.problem}</h2>
          <p className="mt-4 text-xs tracking-widest text-muted uppercase">Original</p>
          <p className="mt-2 rounded-md border border-line bg-surface px-3 py-3 text-sm">“{row.item.excerpt || "Sem trecho isolado."}”</p>
          <p className="mt-4 text-xs tracking-widest text-muted uppercase">Proposta</p>
          <p className="mt-2 rounded-md border border-line bg-surface px-3 py-3 text-sm">{row.item.proposal}</p>
          <p className="mt-4 text-xs tracking-widest text-muted uppercase">Por que alterar</p>
          <p className="mt-1 text-sm">{row.item.reason}</p>
          <button type="button" onClick={onOrigin} className="mt-3 text-sm font-semibold text-accent">Origem · {row.item.origin}</button>
          <p className="mt-4 flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" /> A alteração exige conferência. Norma não é atualizada automaticamente.</p>
          {decision ? <p className="mt-3 text-sm text-ok">{decision === "aceita" ? "Aceite registrado. O texto original permanece." : "Original mantido."}</p> : null}
          <button type="button" onClick={() => onDecide("aceita")} className="mt-4 h-12 w-full rounded-md bg-accent font-semibold text-accent-fg">Registrar aceite</button>
          <button type="button" onClick={() => onDecide("original")} className="mt-3 w-full text-center font-semibold text-accent">Manter original</button>
        </div>
      ) : null}
    </div>
  );
}

function Exportar({
  parts,
  pending,
  onToggle,
  onPending,
  onZip,
}: {
  parts: Required<ZipParts>;
  pending: number;
  onToggle: (key: keyof ZipParts) => void;
  onPending: () => void;
  onZip: () => void;
}) {
  const rows: { key: keyof ZipParts; title: string; hint: string }[] = [
    { key: "models", title: "Modelos em Markdown", hint: "Um arquivo por modelo" },
    { key: "sources", title: "Fontes convertidas", hint: "Texto fiel e versão de leitura" },
    { key: "index", title: "Índice CSV e JSON", hint: "Classificação e referências" },
    { key: "improvements", title: "Relatório de melhorias", hint: "Sugestões e decisões de revisão" },
    { key: "gaps", title: "Relatório de lacunas", hint: "O que ainda precisa ser conferido" },
  ];
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Exportar acervo</h1>
      <p className="mt-2 text-muted">Modelos organizados com suas fontes.</p>
      <ul className="mt-6 space-y-4">
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" onClick={() => onToggle(row.key)} className="flex w-full items-start gap-3 text-left">
              <span className={"mt-0.5 grid h-6 w-6 place-items-center rounded-sm " + (parts[row.key] ? "bg-accent text-accent-fg" : "border border-line")}>{parts[row.key] ? <Check className="h-4 w-4" /> : null}</span>
              <span>
                <span className="block font-medium">{row.title}</span>
                <span className="block text-sm text-muted">{row.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs tracking-widest text-muted uppercase">Organização das pastas</p>
      <p className="mt-2 flex items-center gap-2 rounded-md border border-line px-3 py-3 text-sm"><Folder className="h-4 w-4" /> Ação / classe › Rito › Fase</p>
      <p className="mt-2 text-sm text-muted">Itens sem classificação ficam em a-classificar.</p>
      {pending ? (
        <button type="button" onClick={onPending} className="mt-4 w-full rounded-md border border-line px-3 py-3 text-left">
          <span className="block text-sm text-warn">{pending} {pending === 1 ? "modelo" : "modelos"} com revisão pendente</span>
          <span className="text-sm font-semibold text-accent underline underline-offset-2">Conferir pendências</span>
        </button>
      ) : null}
      <button type="button" onClick={onZip} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent font-semibold text-accent-fg"><Download className="h-4 w-4" /> Baixar pacote ZIP</button>
      <p className="mt-3 text-center text-sm text-muted">Exportação local. Nenhum envio externo.</p>
    </div>
  );
}

function Processamento({ note, onSave, onData, onCaderno, onRemote }: { note: string | null; onSave: () => void; onData: () => void; onCaderno: () => void; onRemote: () => void }) {
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Processamento</h1>
      <p className="mt-2 text-muted">Escolha como analisar seus documentos.</p>
      <div className="mt-4 divide-y divide-line rounded-md border border-line">
        <div className="px-3 py-3">
          <p className="font-semibold text-accent">Local</p>
          <p className="text-sm text-muted">Conversão e classificação por regras no navegador.</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted"><Lock className="h-4 w-4" /> O conteúdo permanece neste dispositivo.</p>
        </div>
        <button type="button" onClick={onRemote} className="w-full px-3 py-3 text-left">
          <p className="font-semibold text-muted">IA remota</p>
          <p className="text-sm text-muted">Análise contextual por serviço externo.</p>
          <p className="mt-1 text-sm text-muted">Desativada</p>
        </button>
      </div>
      <p className="mt-6 text-xs tracking-widest text-muted uppercase">Antes de enviar</p>
      <ul className="mt-2 space-y-3 text-sm">
        <li><span className="block font-medium">Conferir os trechos selecionados</span><span className="text-muted">Veja se o conteúdo está correto.</span></li>
        <li><span className="block font-medium">Revisar o destino e o custo</span><span className="text-muted">Não há destino externo nesta versão.</span></li>
        <li><span className="block font-medium">Autorizar cada envio</span><span className="text-muted">Não existe envio para autorizar.</span></li>
      </ul>
      <p className="mt-4 flex items-start gap-2 rounded-md border border-line px-3 py-3 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Ativar esta tela não envia documentos automaticamente.</p>
      <button type="button" onClick={onSave} className="mt-4 h-12 w-full rounded-md bg-accent font-semibold text-accent-fg">Salvar preferência</button>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      <button type="button" onClick={onData} className="mt-4 w-full text-center font-semibold text-accent underline underline-offset-2">Ver dados armazenados</button>
      <button type="button" onClick={onCaderno} className="mt-4 w-full text-center text-sm text-muted">Abrir caderno do DJE nº 223</button>
    </div>
  );
}

function Dados({ docs }: { docs: ArchiveDoc[] }) {
  return (
    <div>
      <h1 className="mt-6 font-serif text-4xl leading-none font-medium">Dados nesta página</h1>
      <p className="mt-2 text-sm text-muted">Nada disto foi enviado. Fechar a página apaga o acervo, salvo o ZIP que você baixar.</p>
      {!docs.length ? <p className="mt-4 text-sm">Nenhum documento carregado.</p> : null}
      <ul className="mt-4 space-y-2">
        {docs.map((doc) => (
          <li key={doc.id} className="rounded-md border border-line px-3 py-3 text-sm">
            <span className="block font-medium">{doc.filename}</span>
            <span className="text-muted">{doc.acts.length} atos · {doc.hasPdf ? "PDF nesta sessão" : "sem PDF"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Importar", "Converter", "Conferir"];
  return (
    <ol className="mt-4 grid grid-cols-3 text-center text-xs">
      {items.map((item, index) => (
        <li key={item} className={index + 1 === step ? "font-semibold text-accent" : "text-muted"}>{index + 1}. {item}</li>
      ))}
    </ol>
  );
}

function Section({ title }: { title: string }) {
  return <p className="mt-6 text-xs tracking-widest text-muted uppercase">{title}</p>;
}

function Toggle({ on, label, hint, onChange }: { on: boolean; label: string; hint: string; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={"h-8 w-14 shrink-0 rounded-full p-1 " + (on ? "bg-accent" : "bg-surface-2")}>
        <span className={"block h-6 w-6 rounded-full bg-fg " + (on ? "translate-x-6" : "")} />
      </button>
    </div>
  );
}

function Nav({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const items: { id: Tab; label: string; icon: typeof FileUp }[] = [
    { id: "converter", label: "Converter", icon: FileUp },
    { id: "acervo", label: "Acervo", icon: Folder },
    { id: "revisao", label: "Revisão", icon: FileText },
    { id: "ajustes", label: "Ajustes", icon: SlidersHorizontal },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-bg" aria-label="Seções">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          const on = tab === item.id;
          return (
            <button key={item.id} type="button" onClick={() => onTab(item.id)} className={"flex h-16 flex-col items-center justify-center gap-1 text-xs " + (on ? "text-accent" : "text-muted")}>
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function highlightTokens(text: string): string {
  return escapeHtml(text).replace(/\[[A-ZÁÉÍÓÚ_]+\]/g, (token) => `<mark class="rounded-sm bg-accent/25 px-1">${token}</mark>`);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function templateBody(act: Act): string {
  return `${act.template.title}\n\n${act.template.text}\n`;
}
