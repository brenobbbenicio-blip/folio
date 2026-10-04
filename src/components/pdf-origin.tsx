import { useEffect, useState } from "react";
import { pdfBytes } from "@/lib/acervo/pdf-store";

export function PdfOrigin({ docId, pages, warning }: { docId: string; pages: number[]; warning?: string }) {
  const bytes = pdfBytes(docId);
  const [page, setPage] = useState(pages[0] ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const stored = pdfBytes(docId);
    if (!stored || !canvas || !page) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let destroyDoc: (() => Promise<void>) | null = null;
    setError(null);
    void (async () => {
      const { openPdf } = await import("@/lib/pdf-to-md");
      const pdf = await openPdf(stored);
      destroyDoc = () => pdf.loadingTask.destroy();
      if (cancelled) {
        await destroyDoc();
        return;
      }
      const pdfPage = await pdf.getPage(page);
      const parentWidth = canvas.parentElement?.clientWidth || 360;
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(2, (parentWidth * Math.min(window.devicePixelRatio || 1, 2)) / unscaled.width);
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      if (cancelled) return;
      const task = pdfPage.render({ canvas, viewport });
      renderTask = task;
      await task.promise;
    })().catch((reason: unknown) => {
      if (cancelled) return;
      const name = reason instanceof Error ? reason.name : "";
      if (name === "RenderingCancelledException") return;
      setError(reason instanceof Error ? reason.message : "Não foi possível abrir esta página do PDF.");
    });
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* a página já pode ter sido destruída */
      }
      void destroyDoc?.();
    };
  }, [canvas, docId, page]);

  if (!pages.length) {
    return <p className="text-sm text-muted">Página física não marcada. Nada foi reconstituído.</p>;
  }
  if (!bytes) {
    return <p className="text-sm text-muted">O PDF original não está nesta sessão. A página não foi reconstituída a partir do Markdown.</p>;
  }
  return (
    <div className="mt-3">
      {warning ? <p role="alert" className="mb-3 text-sm text-warn">{warning}</p> : null}
      <div className="flex flex-wrap gap-2">
        {pages.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={item === page}
            onClick={() => setPage(item)}
            className={"h-11 rounded-md border px-3 text-sm " + (item === page ? "border-accent" : "border-line")}
          >
            Página {item}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">Página física do PDF incluído nesta sessão. Não é a numeração impressa.</p>
      <canvas ref={setCanvas} className="mt-2 h-auto w-full rounded-md border border-line bg-white" />
      {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
    </div>
  );
}
