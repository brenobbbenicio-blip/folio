export const UNKNOWN = "[NÃO IDENTIFICADO]";

export type Nature = "modelo" | "ato" | "extrato" | "incompleto" | "apoio";
export type FieldStatus = "identificada" | "sugerida" | "indeterminada";
export type FieldMethod = "campo expresso" | "regra local" | "revisão humana";
export type Voice = "juízo" | "parte" | "parecer" | "não identificada";

export type EvidenceField = {
  key: string;
  label: string;
  value: string;
  status: FieldStatus;
  method: FieldMethod;
  evidence: string;
  origin: string;
};

export type QualityReport = {
  pagesProcessed: number | null;
  emptyPages: number[];
  markersPresent: boolean;
  readingOrderRisks: string[];
  damagedTables: string[];
  illegible: string[];
  needsOcr: number[];
  integral: boolean;
  chromeSamples: string[];
  changes: string[];
};

export type Preserved = {
  orgao: string[];
  datas: string[];
  edicao: string[];
  processos: string[];
  assinaturas: string[];
};

export type Improvement = {
  id: string;
  kind: "editorial" | "jurídica";
  problem: string;
  excerpt: string;
  origin: string;
  proposal: string;
  reason: string;
  priority: "alta" | "média" | "baixa";
};

export type TemplateDoc = {
  title: string;
  purpose: string;
  when: string;
  requirements: string[];
  fields: string[];
  text: string;
  limits: string[];
  origin: string;
  pages: string;
  version: number;
  pending: string[];
  voice: Voice;
};

export type Act = {
  id: string;
  title: string;
  nature: Nature;
  text: string;
  pdfPages: number[];
  printedPages: string[];
  documentId: string;
  cnj: string[];
  fields: EvidenceField[];
  template: TemplateDoc;
  improvements: Improvement[];
  voice: Voice;
  review: "pendente" | "revisada";
  warning: string | null;
  duplicateOf: string | null;
  variantOf: string[];
};

export type ArchiveDoc = {
  id: string;
  filename: string;
  addedAt: string;
  hasPdf: boolean;
  faithful: string;
  reading: string;
  cleanupUndone: boolean;
  quality: QualityReport;
  preserved: Preserved;
  acts: Act[];
  history: { label: string; acts: Act[] }[];
  /** Peça de demonstração. Não entra no acervo guardado neste aparelho. */
  example?: boolean;
  legacyId?: string;
  /** Legacy ID collisions can make the surviving PDF association ambiguous. */
  storageWarning?: string;
};

export type IngestInput = {
  filename: string;
  faithful: string;
  reading: string;
  hasPdf: boolean;
  chromeSamples?: string[];
  columnsDetected?: boolean;
  likelyScan?: boolean;
};
