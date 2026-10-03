/** Minimal valid PDF used as the in-app example. ASCII source, WinAnsi escapes. */

const WIN: Record<string, number> = {
  á: 0xe1,
  à: 0xe0,
  â: 0xe2,
  ã: 0xe3,
  é: 0xe9,
  ê: 0xea,
  í: 0xed,
  ó: 0xf3,
  ô: 0xf4,
  õ: 0xf5,
  ú: 0xfa,
  ç: 0xe7,
  Á: 0xc1,
  À: 0xc0,
  Â: 0xc2,
  Ã: 0xc3,
  É: 0xc9,
  Ê: 0xca,
  Í: 0xcd,
  Ó: 0xd3,
  Ô: 0xd4,
  Õ: 0xd5,
  Ú: 0xda,
  Ç: 0xc7,
};

function pdfLiteral(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += `\\${ch}`;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code <= 126) {
      out += ch;
      continue;
    }
    const mapped = WIN[ch];
    if (mapped != null) {
      out += `\\${mapped.toString(8).padStart(3, "0")}`;
      continue;
    }
    out += "?";
  }
  return `(${out})`;
}

function buildPdf(objects: string[]): Uint8Array {
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 2 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(body + xref + trailer);
}

export const SAMPLE_PDF_NAME = "folio-exemplo.pdf";

/** Two pages: title, wrapped paragraph, list, repeated header/footer, one link. */
export function samplePdfBytes(): Uint8Array {
  const title = "Relatório de exemplo";
  const header = "Folio exemplo";
  const body1 = "Esta frase foi quebrada no meio da pala-";
  const body2 = "vra para testar a junção.";
  const item1 = "1. Primeiro item da lista.";
  const item2 = "2. Segundo item da lista.";
  const section = "Próxima seção";
  const body3 = "Parágrafo da segunda página, contínuo e sem hífen de quebra.";

  const stream1 = [
    "BT",
    "/F1 9 Tf",
    "72 760 Td",
    `${pdfLiteral(header)} Tj`,
    "/F2 22 Tf",
    "0 -60 Td",
    `${pdfLiteral(title)} Tj`,
    "/F1 12 Tf",
    "0 -40 Td",
    `${pdfLiteral(body1)} Tj`,
    "0 -16 Td",
    `${pdfLiteral(body2)} Tj`,
    "0 -34 Td",
    `${pdfLiteral(item1)} Tj`,
    "0 -18 Td",
    `${pdfLiteral(item2)} Tj`,
    "ET",
    "BT",
    "/F1 9 Tf",
    "1 0 0 1 72 40 Tm",
    `${pdfLiteral("Página 1")} Tj`,
    "ET",
  ].join("\n");

  const stream2 = [
    "BT",
    "/F1 9 Tf",
    "72 760 Td",
    `${pdfLiteral(header)} Tj`,
    "/F2 16 Tf",
    "0 -60 Td",
    `${pdfLiteral(section)} Tj`,
    "/F1 12 Tf",
    "0 -36 Td",
    `${pdfLiteral(body3)} Tj`,
    "ET",
    "BT",
    "/F1 9 Tf",
    "1 0 0 1 72 40 Tm",
    `${pdfLiteral("Página 2")} Tj`,
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 3 0 R /Outlines 11 0 R >>",
    `<< /Title ${pdfLiteral(title)} /Author (Folio) /Subject (PDF para Markdown) >>`,
    "<< /Type /Pages /Count 2 /Kids [4 0 R 5 0 R] >>",
    "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 8 0 R /F2 9 0 R >> >> /Annots [10 0 R] >>",
    "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 8 0 R /F2 9 0 R >> >> >>",
    `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`,
    `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Type /Annot /Subtype /Link /Rect [72 688 360 724] /Border [0 0 0] /A << /Type /Action /S /URI /URI (https://exemplo.test/folio) >> >>`,
    "<< /Type /Outlines /Count 1 /First 12 0 R /Last 12 0 R >>",
    `<< /Title ${pdfLiteral(section)} /Parent 11 0 R /Dest [5 0 R /XYZ 0 760 0] >>`,
  ];

  return buildPdf(objects);
}
