import { useMemo, useState } from "react";
import { FolioApp } from "@/components/folio-app";
import { CadernoReader } from "@/components/caderno-reader";
import { PdfOrigin } from "@/components/pdf-origin";
import { classificationDisclaimer, fieldValue } from "@/lib/acervo/classify";
import { fictionalArchive } from "@/lib/acervo/fixtures";
import { rememberPdf, retainPdfs } from "@/lib/acervo/pdf-store";
import {
  ingestDocument,
  linkDuplicates,
  mergeWithNext,
  redoCleanup,
  splitAct,
  undoBoundary,
  undoCleanup,
  updateField,
} from "@/lib/acervo/pipeline";
import type { Act, ArchiveDoc } from "@/lib/acervo/types";
import { UNKNOWN } from "@/lib/acervo/types";
import { archiveZip } from "@/lib/acervo/zip";
import { saveBinaryFile } from "@/lib/save-text-file";

type Area = "converter" | "conferir" | "classificar" | "modelos" | "melhorias";

const AREAS: { id: Area; label: string }[] = [
  { id: "converter", label: "Converter" },
  { id: "conferir", label: "Conferir extração" },
  { id: "classificar", label: "Classificar" },
  { id: "modelos", label: "Modelos" },
  { id: "melhorias", label: "Melhorias" },
];

const FILTERS = [
  { key: "classe", label: "classe" },
  { key: "rito", label: "rito" },
  { key: "fase", label: "fase" },
  { key: "tipo", label: "tipo" },
  { key: "exercicio", label: "exercício" },
  { key: "eleicao", label: "eleição" },
  { key: "revisao", label: "revisão" },
] as const;

export function AcervoShell() {
  const [area, setArea] = useState<Area>("converter");
  const [diary, setDiary] = useState(false);
  const [docs, setDocs] = useState<ArchiveDoc[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function commit(next: ArchiveDoc[]) {
    const linked = linkDuplicates(next);
    retainPdfs(linked.map((doc) => doc.id));
    setDocs(linked);
    return linked;
  }

  function replace(doc: ArchiveDoc) {
    commit(docs.map((item) => (item.id === doc.id ? doc : item)));
  }

  async function ingestFiles(files: File[]) {
    setBusy(true);
    setNote(null);
    try {
      const pdf = await import("@/lib/pdf-to-md");
      const created: ArchiveDoc[] = [];
      for (const file of files) {
        const markdown = file.name.toLowerCase().endsWith(".md") || file.type.startsWith("text/");
        if (markdown) {
          const text = await file.text();
          created.push(ingestDocument({ filename: file.name, faithful: text, reading: text, hasPdf: false }));
          continue;
        }
        const data = new Uint8Array(await file.arrayBuffer());
        const base = { pageRange: "", includeOutline: false, frontMatter: false, pageMarker: "comment" as const };
        const faithful = await pdf.pdfToMarkdown(data, { ...base, inferHeadings: false, reflow: true, stripChrome: false, dehyphenate: false });
        const reading = await pdf.pdfToMarkdown(data, { ...base, inferHeadings: true, reflow: true, stripChrome: true, dehyphenate: true });
        const archive = ingestDocument({
          filename: file.name,
          faithful: faithful.markdown,
          reading: reading.markdown,
          hasPdf: true,
          chromeSamples: reading.chromeSamples,
          columnsDetected: reading.columnsDetected,
          likelyScan: reading.likelyScan,
        });
        rememberPdf(archive.id, data);
        created.push(archive);
      }
      const linked = commit([...created, ...docs]);
      setSelected(linked[0]?.acts[0]?.id ?? null);
      setArea("conferir");
      setNote(`${created.length} arquivo(s) no acervo. A classificação é regra local, não análise jurídica.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Falha ao incluir o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function exportZip() {
    if (!docs.length) return;
    const bytes = archiveZip(docs);
    const result = await saveBinaryFile("acervo-folio.zip", bytes, "application/zip");
    if (result === "failed") setNote("O ZIP não foi salvo. No iPhone, o compartilhamento do sistema precisa aceitar o arquivo.");
    else if (result === "shared") setNote("ZIP aberto na folha de compartilhamento.");
    else if (result === "downloaded") setNote("ZIP gerado neste aparelho.");
  }

  const acts = useMemo(() => docs.flatMap((doc) => doc.acts.map((act) => ({ doc, act }))), [docs]);
  const visible = acts.filter(({ act }) => {
    const hay = `${act.title}\n${act.text}\n${act.cnj.join(" ")}`.toLowerCase();
    if (query.trim() && !hay.includes(query.trim().toLowerCase())) return false;
    for (const item of FILTERS) {
      const wanted = filters[item.key];
      if (!wanted) continue;
      const value = item.key === "revisao" ? act.review : fieldValue(act.fields, item.key);
      if (value !== wanted) return false;
    }
    return true;
  });
  const current = acts.find((item) => item.act.id === selected) ?? visible[0] ?? null;

  if (diary) return <CadernoReader onConvertOther={() => setDiary(false)} />;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-line px-4 py-5 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-widest text-muted uppercase">Acervo eleitoral</p>
            <h1 className="font-sans text-4xl leading-none font-medium">Folio</h1>
            <p className="mt-2 max-w-xl text-sm text-pretty text-muted">
              Leitura, classificação por regras e modelos rodam neste navegador. Não há envio automático. A regra local não é análise jurídica.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDiary(true)} className="h-11 rounded-md border border-line px-3 text-sm">
              DJE nº 223
            </button>
            <button type="button" onClick={() => void exportZip()} disabled={!docs.length} className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40">
              Exportar ZIP
            </button>
          </div>
        </div>
        <nav className="mx-auto mt-4 flex max-w-6xl gap-2 overflow-x-auto" aria-label="Áreas do acervo">
          {AREAS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={area === item.id}
              onClick={() => setArea(item.id)}
              className={"h-11 shrink-0 rounded-md px-3 text-sm " + (area === item.id ? "bg-surface-2 text-fg" : "border border-line text-muted")}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      {note ? <p className="mx-auto max-w-6xl px-4 pt-4 text-sm text-muted lg:px-8">{note}</p> : null}
      {busy ? <p className="mx-auto max-w-6xl px-4 pt-4 text-sm lg:px-8">Lendo os arquivos…</p> : null}

      {area === "converter" ? (
        <div>
          <div className="mx-auto flex max-w-6xl gap-2 px-4 pt-4 lg:px-8">
            <button
              type="button"
              onClick={() => {
                const linked = commit(fictionalArchive());
                setSelected(linked[0]?.acts[0]?.id ?? null);
                setArea("classificar");
                setNote("Exemplos fictícios carregados. Não são atos reais.");
              }}
              className="h-11 rounded-md border border-line px-3 text-sm"
            >
              Carregar exemplos fictícios
            </button>
          </div>
          <FolioApp
            embedded
            onBatch={(files) => void ingestFiles(files)}
            onInclude={(payload) => {
              const file = new File([Uint8Array.from(payload.data)], payload.name, { type: "application/pdf" });
              void ingestFiles([file]);
            }}
          />
        </div>
      ) : null}

      {area === "conferir" ? <Conferir docs={docs} onChange={replace} /> : null}
      {area === "classificar" ? (
        <Classificar
          items={visible}
          current={current}
          filters={filters}
          query={query}
          docs={docs}
          onQuery={setQuery}
          onFilter={(key, value) => setFilters((currentFilters) => ({ ...currentFilters, [key]: value }))}
          onSelect={setSelected}
          onChange={replace}
        />
      ) : null}
      {area === "modelos" ? <Modelos items={visible} current={current} onSelect={setSelected} /> : null}
      {area === "melhorias" ? <Melhorias items={visible} /> : null}
    </div>
  );
}

function Conferir({ docs, onChange }: { docs: ArchiveDoc[]; onChange: (doc: ArchiveDoc) => void }) {
  if (!docs.length) return <Empty />;
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 lg:px-8">
      {docs.map((doc) => (
        <article key={doc.id} className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-xl font-medium">{doc.filename}</h2>
          <p className="mt-2 text-sm text-muted">
            {doc.quality.integral
              ? "Leitura com texto em todas as páginas marcadas."
              : "Leitura não integral. Há página sem texto, trecho ilegível ou ausência de marcador."}
            {doc.quality.pagesProcessed === null ? " Páginas físicas não reconstituídas." : ` ${doc.quality.pagesProcessed} páginas marcadas.`}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>Sem texto: {doc.quality.emptyPages.join(", ") || "nenhuma"}</li>
            <li>Pedem OCR: {doc.quality.needsOcr.join(", ") || "nenhuma"}</li>
            <li>Ordem de leitura: {doc.quality.readingOrderRisks.join(" · ") || "sem alerta"}</li>
            <li>Tabelas: {doc.quality.damagedTables.join(" · ") || "sem alerta"}</li>
            <li>Ilegíveis: {doc.quality.illegible.join(" · ") || "sem alerta"}</li>
          </ul>
          <h3 className="mt-4 text-sm tracking-widest text-muted uppercase">Preservado à parte</h3>
          <p className="mt-1 text-sm">Órgão: {doc.preserved.orgao.join(" · ") || UNKNOWN}</p>
          <p className="text-sm">Datas: {doc.preserved.datas.slice(0, 4).join(" · ") || UNKNOWN}</p>
          <p className="text-sm">Edição: {doc.preserved.edicao.slice(0, 2).join(" · ") || UNKNOWN}</p>
          <p className="text-sm">Processos: {doc.preserved.processos.slice(0, 4).join(" · ") || UNKNOWN}</p>
          <p className="text-sm">Assinatura: {doc.preserved.assinaturas[0] || UNKNOWN}</p>
          {doc.quality.chromeSamples.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Prévia do cabeçalho e rodapé removidos</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
                {doc.quality.chromeSamples.map((sample) => (
                  <li key={sample}>{sample}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="mt-3 text-sm text-muted">Nada foi removido como cabeçalho ou rodapé, ou o arquivo não passou pela limpeza.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onChange(doc.cleanupUndone ? redoCleanup(doc) : undoCleanup(doc))} className="h-11 rounded-md border border-line px-3 text-sm">
              {doc.cleanupUndone ? "Refazer limpeza" : "Desfazer limpeza"}
            </button>
            <button type="button" onClick={() => onChange(undoBoundary(doc))} disabled={!doc.history.length} className="h-11 rounded-md border border-line px-3 text-sm disabled:opacity-40">
              Desfazer união ou divisão
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Classificar({
  items,
  current,
  filters,
  query,
  docs,
  onQuery,
  onFilter,
  onSelect,
  onChange,
}: {
  items: { doc: ArchiveDoc; act: Act }[];
  current: { doc: ArchiveDoc; act: Act } | null;
  filters: Record<string, string>;
  query: string;
  docs: ArchiveDoc[];
  onQuery: (value: string) => void;
  onFilter: (key: string, value: string) => void;
  onSelect: (id: string) => void;
  onChange: (doc: ArchiveDoc) => void;
}) {
  if (!docs.length) return <Empty />;
  const options = (key: string) => [...new Set(docs.flatMap((doc) => doc.acts.map((act) => (key === "revisao" ? act.review : fieldValue(act.fields, key)))))];
  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 lg:grid-cols-12 lg:px-8">
      <div className="lg:col-span-4">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar texto ou processo" className="h-12 w-full rounded-md border border-line bg-surface px-3" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {FILTERS.map((item) => (
            <select key={item.key} value={filters[item.key] ?? ""} onChange={(event) => onFilter(item.key, event.target.value)} className="h-11 rounded-md border border-line bg-surface px-2 text-sm" aria-label={item.label}>
              <option value="">{item.label}</option>
              {options(item.key).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          ))}
        </div>
        <ul className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto">
          {items.map(({ act }) => (
            <li key={act.id}>
              <button type="button" onClick={() => onSelect(act.id)} className={"w-full rounded-md border px-3 py-2 text-left text-sm " + (current?.act.id === act.id ? "border-accent" : "border-line")}>
                <span className="block font-medium">{act.title}</span>
                <span className="text-muted">{act.nature} · {fieldValue(act.fields, "classe")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {current ? (
        <article className="lg:col-span-8">
          <p className="text-sm text-muted">{classificationDisclaimer()}</p>
          <h2 className="mt-2 text-2xl font-medium">{current.act.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {current.act.nature} · voz do {current.act.voice} · revisão {current.act.review}
            {current.act.duplicateOf ? ` · duplicata de ${current.act.duplicateOf}` : ""}
            {current.act.variantOf.length ? ` · variante de ${current.act.variantOf.join(", ")}` : ""}
          </p>
          {current.act.warning ? <p className="mt-2 text-sm text-accent">{current.act.warning}</p> : null}
          <p className="mt-2 text-sm">Páginas do PDF: {current.act.pdfPages.join(", ") || "não marcadas"}. Impressas: {current.act.printedPages.join(", ") || UNKNOWN}. ID: {current.act.documentId}.</p>
          <div className="mt-4 space-y-3">
            {current.act.fields.map((item) => (
              <label key={item.key} className="block text-sm">
                <span className="text-muted">{item.label} · {item.status} · {item.method}</span>
                <input
                  value={item.value}
                  onChange={(event) => onChange(updateField(current.doc, current.act.id, item.key, event.target.value))}
                  className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3"
                />
                <span className="mt-1 block text-xs text-muted">{item.evidence} · {item.origin}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => onChange(mergeWithNext(current.doc, current.act.id))} className="h-11 rounded-md border border-line px-3 text-sm">Unir com o seguinte</button>
            <button type="button" onClick={() => onChange(undoBoundary(current.doc))} className="h-11 rounded-md border border-line px-3 text-sm">Desfazer</button>
          </div>
          <div className="mt-4 space-y-3">
            {current.act.text.split(/\n{2,}/).map((part, index) => (
              <div key={`${current.act.id}-${index}`} className="rounded-md border border-line p-3">
                {index > 0 ? (
                  <button type="button" onClick={() => onChange(splitAct(current.doc, current.act.id, index))} className="mb-2 text-sm text-accent underline underline-offset-2">
                    Dividir antes deste parágrafo
                  </button>
                ) : null}
                <p className="text-sm whitespace-pre-wrap">{part}</p>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  );
}

function Modelos({
  items,
  current,
  onSelect,
}: {
  items: { doc: ArchiveDoc; act: Act }[];
  current: { doc: ArchiveDoc; act: Act } | null;
  onSelect: (id: string) => void;
}) {
  if (!items.length) return <Empty />;
  const act = current && items.some((item) => item.act.id === current.act.id) ? current : items[0];
  return (
    <div className="mx-auto max-w-6xl px-4 py-5 lg:px-8">
      <div className="flex gap-2 overflow-x-auto">
        {items.map(({ act: item }) => (
          <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={"h-11 shrink-0 rounded-md border px-3 text-sm " + (item.id === act.act.id ? "border-accent" : "border-line")}>
            {item.template.title}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        Origem {act.act.template.origin} · versão {act.act.template.version} · voz do {act.act.voice}. Página física: {act.act.pdfPages.join(", ") || "não marcada"}. Impressa: {act.act.printedPages.join(", ") || UNKNOWN}. ID: {act.act.documentId}.
      </p>
      <PdfOrigin key={act.act.id} docId={act.doc.id} pages={act.act.pdfPages} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-sm tracking-widest text-muted uppercase">Fonte</h2>
          <pre className="mt-3 text-sm whitespace-pre-wrap">{act.act.text}</pre>
        </section>
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-sm tracking-widest text-muted uppercase">Modelo</h2>
          <p className="mt-3 text-sm">{act.act.template.purpose}</p>
          <p className="mt-2 text-sm">{act.act.template.when}</p>
          <h3 className="mt-3 text-sm font-medium">Requisitos</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {act.act.template.requirements.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <h3 className="mt-3 text-sm font-medium">Limites</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {act.act.template.limits.map((limit) => <li key={limit}>{limit}</li>)}
          </ul>
          <h3 className="mt-3 text-sm font-medium">Campos</h3>
          <p className="mt-1 text-sm">{act.act.template.fields.join(" · ") || "Nenhum campo marcado."}</p>
          <h3 className="mt-3 text-sm font-medium">Pendências</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {act.act.template.pending.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <pre className="mt-3 text-sm whitespace-pre-wrap">{act.act.template.text}</pre>
        </section>
      </div>
    </div>
  );
}

function Melhorias({ items }: { items: { doc: ArchiveDoc; act: Act }[] }) {
  const rows = items.flatMap(({ act }) => act.improvements.map((item) => ({ act, item })));
  if (!rows.length) return <Empty />;
  return (
    <div className="mx-auto max-w-6xl overflow-x-auto px-4 py-5 lg:px-8">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {["Problema", "Trecho e origem", "Alteração proposta", "Justificativa", "Prioridade"].map((head) => (
              <th key={head} className="border border-line px-2 py-2 font-medium">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ act, item }) => (
            <tr key={`${act.id}-${item.id}`}>
              <td className="border border-line px-2 py-2 align-top">{item.kind === "jurídica" ? "Jurídica" : "Editorial"}: {item.problem}</td>
              <td className="border border-line px-2 py-2 align-top">{item.excerpt || "—"} · {item.origin}</td>
              <td className="border border-line px-2 py-2 align-top">{item.proposal}</td>
              <td className="border border-line px-2 py-2 align-top">{item.reason}</td>
              <td className="border border-line px-2 py-2 align-top">{item.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty() {
  return <p className="mx-auto max-w-6xl px-4 py-8 text-muted lg:px-8">Nenhum ato no acervo. Converta um arquivo ou carregue os exemplos fictícios.</p>;
}
