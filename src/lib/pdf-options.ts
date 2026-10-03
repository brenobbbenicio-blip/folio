export type PageMarker = "none" | "comment" | "rule" | "heading";

export type ConvertOptions = {
  inferHeadings: boolean;
  reflow: boolean;
  stripChrome: boolean;
  dehyphenate: boolean;
  includeOutline: boolean;
  frontMatter: boolean;
  pageMarker: PageMarker;
  pageRange: string;
};

export const defaultOptions: ConvertOptions = {
  inferHeadings: true,
  reflow: true,
  stripChrome: true,
  dehyphenate: true,
  includeOutline: true,
  frontMatter: true,
  pageMarker: "comment",
  pageRange: "",
};

export type ConvertResult = {
  markdown: string;
  pageCount: number;
  pagesConverted: number;
  emptyPages: number;
  headingCount: number;
  charCount: number;
  title: string | null;
  likelyScan: boolean;
  columnsDetected: boolean;
  /** Running headers and footers removed, not counting a lone page number. */
  chromeRemoved: number;
  chromeSamples: string[];
  /** First page where each CNJ number appears. */
  processes: { cnj: string; page: number }[];
};

const OPTIONS_KEY = "folio.options.v1";

export function loadOptions(): ConvertOptions {
  if (typeof localStorage === "undefined") return { ...defaultOptions };
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (!raw) return { ...defaultOptions };
    const parsed = JSON.parse(raw) as Partial<ConvertOptions>;
    return { ...defaultOptions, ...parsed };
  } catch {
    return { ...defaultOptions };
  }
}

export function saveOptions(options: ConvertOptions) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* private mode */
  }
}
