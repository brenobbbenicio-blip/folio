import { fieldValue } from "./classify.ts";
import { UNKNOWN, type Act, type EvidenceField, type Nature, type TemplateDoc, type Voice } from "./types.ts";

const CNJ = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;

function isCitation(paragraph: string): boolean {
  return /jurisprud[êe]ncia|precedente|citad[oa]s?\b|Rel\.\s/i.test(paragraph);
}

function maskParagraph(paragraph: string): string {
  if (isCitation(paragraph)) return paragraph;
  let text = paragraph;
  text = text.replace(CNJ, "[PROCESSO]");
  text = text.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "[DATA]");
  text = text.replace(/R\$\s*[\d.]+,\d{2}/g, "[VALOR]");
  text = text.replace(/(elei[çc][õo]es\s+)\d{4}/gi, "$1[ELEIÇÃO]");
  text = text.replace(/(exerc[íi]cio(?:\s+financeiro)?(?:\s+de)?\s*)\d{4}/gi, "$1[EXERCÍCIO]");
  text = text.replace(/(munic[íi]pio(?:\s+de)?\s*:?\s*)([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\s]{2,40})/giu, "$1[MUNICÍPIO]");
  text = text.replace(/(?:Ju[íi]zo da\s+)?\d+ª\s+Zona Eleitoral(?:\s+de\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\s]{2,40})?/giu, "[ÓRGÃO]");
  text = text.replace(/Tribunal Regional Eleitoral(?:\s+d[oe]\s+[\p{L}]+){0,3}/giu, "[ÓRGÃO]");
  text = text.replace(/\bID(?:\s+do documento)?\s*[:nº°]*\s*[A-Z0-9-]{5,}/gi, "[ID_DOCUMENTO]");
  text = text.replace(
    /((?:requerente|requerido|interessado(?:\(a\))?|candidato|partido|coliga[çc][ãa]o)\s*:\s*).+/gi,
    "$1[PARTE]",
  );
  return text;
}

export function maskText(source: string): string {
  return source
    .split(/\n{2,}/)
    .map((paragraph) => maskParagraph(paragraph))
    .join("\n\n");
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\[[A-ZÁÉÍÓÚ_]+\]/g)].map((match) => match[0]))];
}

export function buildTemplate(input: {
  filename: string;
  title: string;
  nature: Nature;
  text: string;
  pages: number[];
  fields: EvidenceField[];
  voice: Voice;
}): TemplateDoc {
  const classe = fieldValue(input.fields, "classe");
  const fase = fieldValue(input.fields, "fase");
  const tipo = fieldValue(input.fields, "tipo");
  const masked = maskText(input.text);
  const limits = [
    "Não transpor órgão, município, exercício, eleição ou competência deste texto para outro caso.",
  ];
  if (input.nature === "extrato") {
    limits.push("Extrato de publicação. Não é a decisão integral e não deve ser usado como modelo completo.");
  }
  if (input.nature === "incompleto") limits.push("Documento incompleto. Não fechar modelo enquanto houver lacuna de texto.");
  if (classe === "prestação de contas anual partidária") {
    limits.push("Não usar para prestação de contas eleitorais ou de campanha.");
  }
  if (classe === "prestação de contas eleitorais") {
    limits.push("Não usar para prestação de contas anual de órgão partidário.");
  }
  if (classe === "cumprimento de sentença") {
    limits.push("Não usar como peça da ação que originou a execução.");
  }
  const pending = input.fields.filter((item) => item.value === UNKNOWN).map((item) => `${item.label}: ${UNKNOWN}`);
  pending.push("Verificação jurídica pendente: vigência normativa e jurisprudência não foram conferidas em fonte oficial.");
  if (input.nature === "extrato") pending.push("Não reconstruir a decisão a partir do extrato.");
  const pageLabel = input.pages.length ? input.pages.join(", ") : "página não marcada no Markdown";
  return {
    title: `${tipo === UNKNOWN ? input.title : tipo} — ${classe === UNKNOWN ? "a classificar" : classe}`,
    purpose: input.nature === "extrato" ? "Referência de publicação, não modelo de decisão." : `Referência de ${tipo === UNKNOWN ? "ato" : tipo.toLowerCase()} para caso da mesma classe e fase, depois de revisão.`,
    when: `Somente se a classe for “${classe}”, a fase for “${fase}” e o tipo de ato for “${tipo}”. Conferir fatos e competência antes de reutilizar.`,
    requirements: ["Conferir a classe e a fase no processo de destino.", "Preencher os campos entre colchetes.", "Não aproveitar fato de outro processo como afirmação geral."],
    fields: placeholders(masked),
    text: masked,
    limits,
    origin: input.filename,
    pages: pageLabel,
    version: 1,
    pending,
    voice: input.voice,
  };
}

export function templateMarkdown(act: Pick<Act, "template" | "nature" | "cnj" | "documentId">): string {
  const template = act.template;
  const lines = [
    "---",
    `titulo: ${JSON.stringify(template.title)}`,
    `natureza: ${act.nature}`,
    `voz: ${template.voice}`,
    `origem: ${JSON.stringify(template.origin)}`,
    `paginas: ${JSON.stringify(template.pages)}`,
    `versao: ${template.version}`,
    `id_documento: ${JSON.stringify(act.documentId)}`,
    "---",
    "",
    `# ${template.title}`,
    "",
    template.purpose,
    "",
    "## Quando pode ser usado",
    "",
    template.when,
    "",
    "## Requisitos",
    "",
    ...template.requirements.map((item) => `- ${item}`),
    "",
    "## Limites",
    "",
    ...template.limits.map((item) => `- ${item}`),
    "",
    "## Campos",
    "",
    ...(template.fields.length ? template.fields.map((item) => `- ${item}`) : ["- Nenhum campo marcado."]),
    "",
    "## Pendências",
    "",
    ...template.pending.map((item) => `- ${item}`),
    "",
    "## Texto reutilizável",
    "",
    template.text.trim(),
    "",
  ];
  return lines.join("\n");
}
