import { fieldValue } from "./classify.ts";
import type { EvidenceField, Improvement, Nature } from "./types.ts";

export function suggestImprovements(input: {
  text: string;
  templateText: string;
  nature: Nature;
  fields: EvidenceField[];
  origin: string;
}): Improvement[] {
  const items: Improvement[] = [];
  let local = 0;
  const row = (
    kind: Improvement["kind"],
    problem: string,
    excerpt: string,
    origin: string,
    proposal: string,
    reason: string,
    priority: Improvement["priority"],
  ): Improvement => {
    local += 1;
    return { id: `m${local}`, kind, problem, excerpt: excerpt.slice(0, 280), origin, proposal, reason, priority };
  };
  const paragraphs = input.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const long = paragraphs.find((part) => part.length > 900);
  if (long) {
    items.push(row("editorial", "Parágrafo longo", long.slice(0, 180), input.origin, "Quebrar em blocos: relatório, fundamento, dispositivo.", "Trecho acima de 900 caracteres dificulta a releitura.", "média"));
  }
  const counts = new Map<string, number>();
  for (const line of input.text.split("\n").map((line) => line.trim()).filter((line) => line.length > 40)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  for (const [line, count] of counts) {
    if (count >= 3) {
      items.push(row("editorial", "Repetição", line, input.origin, "Manter uma ocorrência.", `A mesma frase aparece ${count} vezes.`, "baixa"));
      break;
    }
  }
  if (/providencie-se o necess[áa]rio|tome-se as provid[êe]ncias cab[íi]veis/i.test(input.text)) {
    items.push(row("editorial", "Comando ambíguo", "providencie-se o necessário / providências cabíveis", input.origin, "Nomear o ato, o destinatário e o prazo.", "O comando não diz o que deve ser feito.", "alta"));
  }
  if (/julgo procedente/i.test(input.text) && /julgo improcedente/i.test(input.text)) {
    items.push(row("editorial", "Dispositivo contraditório", "julgo procedente / julgo improcedente", input.origin, "Deixar um único resultado, ou explicar os pedidos separados.", "Fundamentação e dispositivo apontam resultados opostos.", "alta"));
  }
  if (/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(input.templateText)) {
    items.push(row("editorial", "Processo concreto ainda no modelo", input.templateText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/)?.[0] ?? "", input.origin, "Trocar pelo campo [PROCESSO], salvo se for precedente citado.", "O modelo ainda carrega número de processo.", "alta"));
  }
  if (input.nature === "extrato") {
    items.push(row("jurídica", "Extrato tratado como decisão", input.text.slice(0, 160), input.origin, "Não promover este texto a modelo integral.", "Publicação resumida não contém a decisão completa.", "alta"));
  }
  const classe = fieldValue(input.fields, "classe");
  if (classe === "[NÃO IDENTIFICADO]") {
    items.push(row("jurídica", "Classe sem apoio no texto", "", input.origin, "Classificar na revisão humana ou manter [NÃO IDENTIFICADO].", "Não há campo expresso nem regra local suficiente.", "alta"));
  }
  items.push(
    row(
      "jurídica",
      "Adequação normativa",
      fieldValue(input.fields, "regime"),
      input.origin,
      "Não atualizar o texto automaticamente. Conferir a norma em fonte oficial e, se for o caso, gravar uma proposta separada.",
      "Verificação jurídica pendente. Sem link oficial, data de consulta e período de vigência, o modelo histórico permanece como foi extraído.",
      "alta",
    ),
  );
  return items;
}
