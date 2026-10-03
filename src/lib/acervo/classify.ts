import { UNKNOWN, type EvidenceField, type FieldMethod, type FieldStatus, type Nature, type Voice } from "./types.ts";

const DISCLAIMER =
  "Categoria inicial de organização. Não é código nem nomenclatura oficial do PJe enquanto não houver conferência.";

export function classificationDisclaimer(): string {
  return DISCLAIMER;
}

function quote(text: string, re: RegExp): string {
  const match = re.exec(text);
  if (!match) return "";
  const start = Math.max(0, match.index - 40);
  return text.slice(start, Math.min(text.length, match.index + match[0].length + 80)).replace(/\s+/g, " ").trim();
}

function field(
  key: string,
  label: string,
  value: string,
  status: FieldStatus,
  method: FieldMethod,
  evidence: string,
  origin: string,
): EvidenceField {
  return { key, label, value: value || UNKNOWN, status: value ? status : "indeterminada", method, evidence: evidence || "Sem trecho de apoio.", origin };
}

function expressLine(text: string, label: string): string | null {
  const match = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, "i").exec(text);
  return match ? match[1].trim().slice(0, 180) : null;
}

function originOf(filename: string, pages: number[]): string {
  if (!pages.length) return `${filename} · página não marcada`;
  return `${filename} · página ${pages.join(", ")}`;
}

export function inferNature(title: string, text: string): Nature {
  const head = `${title}\n${text.slice(0, 500)}`;
  if (/^modelo\b/im.test(title) || /^modelo\b/im.test(text.slice(0, 200))) return "modelo";
  if (/material de apoio|nota de estudo|roteiro interno/i.test(head)) return "apoio";
  if (/^extrato\b/im.test(title) || /\bextrato de\b/i.test(head)) return "extrato";
  const compact = text.replace(/\s/g, "");
  if (compact.length < 40 || /\.\.\.\s*$|\[\s*trecho|continua na página|documento incompleto/i.test(text)) return "incompleto";
  return "ato";
}

export function inferVoice(title: string, text: string): Voice {
  const head = `${title}\n${text.slice(0, 240)}`;
  if (/parecer/i.test(head)) return "parecer";
  if (/peti[çc][ãa]o|requerente pede|vem .* requerer/i.test(head)) return "parte";
  if (/despacho|senten[çc]a|decis[ãa]o|ac[óo]rd[ãa]o|certid[ãa]o|intime-se|julgo\b/i.test(head)) return "juízo";
  return "não identificada";
}

export function classifyAct(input: {
  title: string;
  text: string;
  filename: string;
  pages: number[];
}): EvidenceField[] {
  const { text, title } = input;
  const origin = originOf(input.filename, input.pages);
  const blob = `${title}\n${text}`;
  const fields: EvidenceField[] = [];

  const areaHit = /eleitoral|zona eleitoral|cand[ií]dat|presta[çc][ãa]o de contas|AIJE|AIME|sufr[áa]gio/i.exec(blob);
  fields.push(
    field("area", "Área", areaHit ? "eleitoral" : "", areaHit ? "identificada" : "indeterminada", areaHit ? "regra local" : "regra local", areaHit ? quote(blob, /eleitoral|zona eleitoral|AIJE|AIME|presta[çc][ãa]o de contas/i) : "", origin),
  );

  const expressClass = expressLine(blob, "Classe");
  let classe = "";
  let classeStatus: FieldStatus = "indeterminada";
  let classeMethod: FieldMethod = "regra local";
  let classeEvidence = "";
  if (expressClass) {
    classe = expressClass;
    classeStatus = "identificada";
    classeMethod = "campo expresso";
    classeEvidence = quote(blob, /Classe\s*:[^\n]+/i);
  } else if (/cumprimento de senten[çc]a/i.test(blob)) {
    classe = "cumprimento de sentença";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /cumprimento de senten[çc]a[^\n]{0,80}/i);
  } else if (/presta[çc][ãa]o de contas anual|contas do [óo]rg[ãa]o partid[áa]rio|\bPCA\b/i.test(blob) && !/contas eleitorais|contas de campanha/i.test(blob)) {
    classe = "prestação de contas anual partidária";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /presta[çc][ãa]o de contas anual|PCA|órgão partidário/i);
  } else if (/presta[çc][ãa]o de contas eleitorais|contas de campanha/i.test(blob)) {
    classe = "prestação de contas eleitorais";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /presta[çc][ãa]o de contas eleitorais|contas de campanha/i);
  } else if (/\bAIJE\b/.test(blob) && !/originad/i.test(blob)) {
    classe = "AIJE";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /\bAIJE\b/);
  } else if (/\bAIME\b/.test(blob)) {
    classe = "AIME";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /\bAIME\b/);
  } else if (/registro de candidatura|\bRRC\b|\bDRAP\b/i.test(blob)) {
    classe = "registro de candidatura";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /registro de candidatura|\bRRC\b|\bDRAP\b/i);
  } else if (/representa[çc][ãa]o/i.test(blob)) {
    classe = "representação";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /representa[çc][ãa]o[^\n]{0,80}/i);
  } else if (/a[çc][ãa]o penal|crime eleitoral|art\.\s*299/i.test(blob)) {
    classe = "matéria criminal eleitoral";
    classeStatus = "sugerida";
    classeEvidence = quote(blob, /a[çc][ãa]o penal|crime eleitoral|art\.\s*299/i);
  }
  fields.push(field("classe", "Ação ou classe", classe, classeStatus, classeMethod, classeEvidence, origin));

  const originAction = /originad[oa]\s+d[aeo]\s+([^\n.]{3,80})/i.exec(blob);
  const objectHit =
    /capta[çc][ãa]o il[íi]cita(?:\s+de sufr[áa]gio)?/i.exec(blob) ||
    /propaganda(?:\s+(?:irregular|antecipada|eleitoral)){1,3}/i.exec(blob) ||
    /pesquisa eleitoral/i.exec(blob) ||
    /doa[çc][ãa]o(?:\s+eleitoral)?/i.exec(blob);
  const subtipo = originAction ? `originado de ${originAction[1].trim()}` : "";
  fields.push(
    field(
      "subtipo",
      "Subtipo",
      subtipo,
      subtipo ? "sugerida" : "indeterminada",
      "regra local",
      originAction ? quote(blob, /originad[oa]\s+d[aeo]\s+[^\n.]{3,80}/i) : "",
      origin,
    ),
  );
  fields.push(
    field(
      "assunto",
      "Assunto",
      objectHit ? objectHit[0] : "",
      objectHit ? "sugerida" : "indeterminada",
      "regra local",
      objectHit ? quote(blob, new RegExp(objectHit[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) : "",
      origin,
    ),
  );

  const ritoHit = /rito\s+(ordin[áa]rio|sumar[íi]ssimo|especial|sum[áa]rio)/i.exec(blob) || expressLine(blob, "Rito");
  const ritoValue = typeof ritoHit === "string" ? ritoHit : ritoHit?.[1] ?? ritoHit?.[0] ?? "";
  fields.push(
    field("rito", "Rito", ritoValue, ritoValue ? "sugerida" : "indeterminada", typeof ritoHit === "string" ? "campo expresso" : "regra local", ritoValue ? quote(blob, /rito\s+[^\n]{0,40}/i) : "", origin),
  );

  let fase = "";
  let faseRe: RegExp | null = null;
  if (/cumprimento de senten[çc]a/i.test(blob)) {
    fase = "cumprimento";
    faseRe = /cumprimento de senten[çc]a/i;
  } else if (/fase de execu[çc][ãa]o|\bem execu[çc][ãa]o\b/i.test(blob)) {
    fase = "execução";
    faseRe = /execu[çc][ãa]o/i;
  } else if (/\bconhecimento\b/i.test(blob)) {
    fase = "conhecimento";
    faseRe = /\bconhecimento\b/i;
  } else if (/\binstru[çc][ãa]o\b/i.test(blob)) {
    fase = "instrução";
    faseRe = /\binstru[çc][ãa]o\b/i;
  } else if (/\bjulgamento\b/i.test(blob)) {
    fase = "julgamento";
    faseRe = /\bjulgamento\b/i;
  }
  fields.push(field("fase", "Fase", fase, fase ? "sugerida" : "indeterminada", "regra local", faseRe ? quote(blob, faseRe) : "", origin));

  const tipoExpress = /^(extrato(?:\s+de\s+\p{L}+)?|despacho|senten[çc]a|decis[ãa]o|certid[ãa]o|parecer|peti[çc][ãa]o|edital|modelo|representa[çc][ãa]o|presta[çc][ãa]o de contas[^\n]{0,40}|cumprimento de senten[çc]a)/iu.exec(title.trim())
    || /^(extrato(?:\s+de\s+\p{L}+)?|despacho|senten[çc]a|decis[ãa]o|certid[ãa]o|parecer|peti[çc][ãa]o)/imu.exec(blob);
  fields.push(
    field(
      "tipo",
      "Tipo de ato",
      tipoExpress ? tipoExpress[0].trim() : "",
      tipoExpress ? "identificada" : "indeterminada",
      "campo expresso",
      tipoExpress ? tipoExpress[0].trim() : "",
      origin,
    ),
  );

  const finalidade = /intime-se/i.test(blob)
    ? "intimar"
    : /julgo\b/i.test(blob)
      ? "julgar"
      : /publica-se|extrato/i.test(title)
        ? "publicar extrato"
        : "";
  fields.push(field("finalidade", "Finalidade", finalidade, finalidade ? "sugerida" : "indeterminada", "regra local", finalidade ? quote(blob, /intime-se|julgo|publica-se/i) : "", origin));

  let resultado = "";
  let resultadoRe: RegExp | null = null;
  if (/julgo improcedente/i.test(blob)) {
    resultado = "improcedente";
    resultadoRe = /julgo improcedente/i;
  } else if (/julgo procedente/i.test(blob)) {
    resultado = "procedente";
    resultadoRe = /julgo procedente/i;
  } else if (/extin[çc][ãa]o do processo|extingo o processo/i.test(blob)) {
    resultado = "extinção";
    resultadoRe = /extin[çc][ãa]o do processo|extingo o processo/i;
  }
  fields.push(
    field("resultado", "Resultado", resultado, resultado ? "identificada" : "indeterminada", resultado ? "campo expresso" : "regra local", resultadoRe ? quote(blob, resultadoRe) : "", origin),
  );

  const orgao = /((?:\d+ª\s+Zona Eleitoral|Ju[íi]zo da)[^\n]{0,50}|Tribunal Regional Eleitoral[^\n]{0,40})/i.exec(blob);
  fields.push(field("orgao", "Órgão", orgao ? orgao[0].trim() : "", orgao ? "identificada" : "indeterminada", "campo expresso", orgao ? orgao[0].trim() : "", origin));

  let grau = "";
  if (/1[ºo°]\s*grau|zona eleitoral|ju[íi]z eleitoral/i.test(blob)) grau = "primeiro grau";
  else if (/\bTRE\b|tribunal regional eleitoral/i.test(blob)) grau = "segundo grau";
  fields.push(field("grau", "Grau", grau, grau ? "sugerida" : "indeterminada", "regra local", grau ? quote(blob, /1[ºo°]\s*grau|zona eleitoral|ju[íi]z eleitoral|Tribunal Regional Eleitoral/i) : "", origin));

  const exercicio = /exerc[íi]cio(?:\s+financeiro)?(?:\s+de)?\s*(\d{4})/i.exec(blob);
  const eleicao = /elei[çc][õo]es\s+(\d{4})/i.exec(blob);
  fields.push(field("exercicio", "Exercício", exercicio ? exercicio[1] : "", exercicio ? "identificada" : "indeterminada", "campo expresso", exercicio ? exercicio[0] : "", origin));
  fields.push(field("eleicao", "Eleição", eleicao ? eleicao[1] : "", eleicao ? "identificada" : "indeterminada", "campo expresso", eleicao ? eleicao[0] : "", origin));

  const norms = [...blob.matchAll(/\b(?:Lei|LC|Resolu[çc][ãa]o(?:\s+TSE)?)\s+n[ºo°.]?\s*[\d.]+(?:\/\d{2,4})?/gi)].map((match) => match[0].replace(/\s+/g, " ").trim());
  const uniqueNorms = [...new Set(norms)].slice(0, 8);
  fields.push(
    field(
      "regime",
      "Regime citado no texto",
      uniqueNorms.length ? uniqueNorms.join("; ") : "",
      uniqueNorms.length ? "identificada" : "indeterminada",
      "campo expresso",
      uniqueNorms[0] ?? "",
      origin,
    ),
  );

  const missing = fields.some((item) => item.key !== "regime" && item.value === UNKNOWN && ["classe", "tipo", "fase"].includes(item.key));
  fields.push(
    field(
      "revisao",
      "Situação da revisão",
      missing ? "pendente" : "aguardando confirmação humana",
      missing ? "indeterminada" : "sugerida",
      "regra local",
      "Revisão humana ainda não registrada.",
      origin,
    ),
  );
  return fields;
}

export function fieldValue(fields: EvidenceField[], key: string): string {
  return fields.find((item) => item.key === key)?.value ?? UNKNOWN;
}
