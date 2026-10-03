export type SaveResult = "shared" | "downloaded" | "copied" | "cancelled" | "failed";

function fileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "").trim() || "documento.md";
  return cleaned.toLowerCase().endsWith(".md") ? cleaned : `${cleaned}.md`;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** iOS ignores `<a download>` on a blob and dies if the URL is revoked immediately. */
export async function saveTextFile(filename: string, text: string): Promise<SaveResult> {
  const name = fileName(filename);
  const file = new File([text], name, { type: "text/markdown" });

  if (typeof navigator.share === "function") {
    const data: ShareData = { files: [file], title: name };
    let allowed = false;
    try {
      allowed = typeof navigator.canShare !== "function" || navigator.canShare(data);
    } catch {
      allowed = false;
    }
    if (allowed) {
      try {
        await navigator.share(data);
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      }
    }
  }

  if (isIos()) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      return "failed";
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 15000);
  return "downloaded";
}

export async function saveBinaryFile(filename: string, bytes: Uint8Array, mime: string): Promise<SaveResult> {
  const file = new File([Uint8Array.from(bytes)], filename, { type: mime });
  if (typeof navigator.share === "function") {
    const data: ShareData = { files: [file], title: filename };
    let allowed = false;
    try {
      allowed = typeof navigator.canShare !== "function" || navigator.canShare(data);
    } catch {
      allowed = false;
    }
    if (allowed) {
      try {
        await navigator.share(data);
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      }
    }
  }
  if (isIos()) return "failed";
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 15000);
  return "downloaded";
}
