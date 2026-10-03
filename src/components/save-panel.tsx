import { useEffect, useRef } from "react";

export function SavePanel({ text }: { text: string | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = ref.current;
    if (!field || text == null) return;
    field.focus();
    field.setSelectionRange(0, field.value.length);
  }, [text]);
  if (!text) return null;
  return (
    <textarea
      ref={ref}
      readOnly
      value={text}
      aria-label="Markdown para salvar"
      className="mt-3 h-48 w-full resize-y rounded-md border border-line bg-bg p-3 font-mono text-sm text-fg"
    />
  );
}
