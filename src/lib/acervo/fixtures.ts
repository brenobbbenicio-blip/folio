import { ingestDocument, linkDuplicates } from "./pipeline.ts";
import type { ArchiveDoc } from "./types.ts";

const P1 = "0600001-23.2026.6.14.0002";
const P2 = "0600005-94.2025.6.14.0002";
const P3 = "0600010-11.2024.6.14.0001";
const P4 = "0600020-22.2024.6.14.0003";
const P5 = "0600021-07.2024.6.14.0003";
const P6 = "0600100-85.2026.6.14.0004";
const P7 = "0600099-10.2022.6.14.0004";

/** Peças fictícias para conferir o acervo. Não são atos reais. */
export function fictionalArchive(): ArchiveDoc[] {
  const common = "O juízo determina a manifestação da parte interessada no prazo de cinco dias, com vista dos autos.";
  const docs = [
    ingestDocument({
      filename: "ficticio-atos.md",
      hasPdf: false,
      faithful: `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte.\n\nDECISÃO\n\nProcesso ${P2}\n\nJulgo procedente o pedido.\n`,
      reading: `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte.\n\nDECISÃO\n\nProcesso ${P2}\n\nJulgo procedente o pedido.\n`,
    }),
    ingestDocument({
      filename: "ficticio-sentenca.md",
      hasPdf: false,
      faithful: `<!-- página 1 -->\n\nSENTENÇA\n\nProcesso ${P3}\n\n1ª Zona Eleitoral. O juízo examina a prova.\n\n<!-- página 2 -->\n\nPelo exposto, julgo improcedente o pedido.\n`,
      reading: `<!-- página 1 -->\n\nSENTENÇA\n\nProcesso ${P3}\n\n1ª Zona Eleitoral. O juízo examina a prova.\n\n<!-- página 2 -->\n\nPelo exposto, julgo improcedente o pedido.\n`,
    }),
    ingestDocument({
      filename: "ficticio-contas.md",
      hasPdf: false,
      faithful: `<!-- página 3 -->\n\nPRESTAÇÃO DE CONTAS ANUAL\n\nProcesso ${P1}\n\nExercício 2025. Contas do órgão partidário.\n\nPRESTAÇÃO DE CONTAS ELEITORAIS\n\nProcesso ${P2}\n\nContas de campanha das Eleições 2024.\n`,
      reading: `<!-- página 3 -->\n\nPRESTAÇÃO DE CONTAS ANUAL\n\nProcesso ${P1}\n\nExercício 2025. Contas do órgão partidário.\n\nPRESTAÇÃO DE CONTAS ELEITORAIS\n\nProcesso ${P2}\n\nContas de campanha das Eleições 2024.\n`,
    }),
    ingestDocument({
      filename: "ficticio-representacoes.md",
      hasPdf: false,
      faithful: `<!-- página 4 -->\n\nREPRESENTAÇÃO\n\nProcesso ${P4}\n\nRepresentação por propaganda irregular antecipada.\n\nREPRESENTAÇÃO\n\nProcesso ${P5}\n\nRepresentação por captação ilícita de sufrágio.\n`,
      reading: `<!-- página 4 -->\n\nREPRESENTAÇÃO\n\nProcesso ${P4}\n\nRepresentação por propaganda irregular antecipada.\n\nREPRESENTAÇÃO\n\nProcesso ${P5}\n\nRepresentação por captação ilícita de sufrágio.\n`,
    }),
    ingestDocument({
      filename: "ficticio-cumprimento.md",
      hasPdf: false,
      faithful: `<!-- página 5 -->\n\nDESPACHO\n\nCumprimento de sentença originado da AIJE ${P7}.\n\nProcesso ${P6}\n\nIntime-se para pagamento.\n`,
      reading: `<!-- página 5 -->\n\nDESPACHO\n\nCumprimento de sentença originado da AIJE ${P7}.\n\nProcesso ${P6}\n\nIntime-se para pagamento.\n`,
    }),
    ingestDocument({
      filename: "ficticio-extrato.md",
      hasPdf: false,
      faithful: `<!-- página 8 -->\n\nEXTRATO DE DESPACHO\n\nProcesso ${P1}\n\nInteressado: Maria Souza\n\nAdvogado: João Lima\n`,
      reading: `<!-- página 8 -->\n\nEXTRATO DE DESPACHO\n\nProcesso ${P1}\n\nInteressado: Maria Souza\n\nAdvogado: João Lima\n`,
    }),
    ingestDocument({
      filename: "ficticio-digitalizado.md",
      hasPdf: false,
      faithful: `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se.\n\n<!-- página 2 -->\n\n`,
      reading: `<!-- página 1 -->\n\nDESPACHO\n\nProcesso ${P1}\n\nIntime-se.\n\n<!-- página 2 -->\n\n`,
    }),
    ingestDocument({
      filename: "ficticio-sem-pagina.md",
      hasPdf: false,
      faithful: `DESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte.\n`,
      reading: `DESPACHO\n\nProcesso ${P1}\n\nIntime-se a parte.\n`,
    }),
    ingestDocument({
      filename: "ficticio-variantes.md",
      hasPdf: false,
      faithful: `<!-- página 1 -->\n\nDESPACHO\n\nProcesso 0600030-51.2024.6.14.0008\n\n${common}\n\nIntime-se.\n\nDESPACHO\n\nProcesso 0600031-36.2024.6.14.0008\n\n${common}\n\nCite-se.\n\nDESPACHO\n\nProcesso 0600030-51.2024.6.14.0008\n\n${common}\n\nIntime-se.\n`,
      reading: `<!-- página 1 -->\n\nDESPACHO\n\nProcesso 0600030-51.2024.6.14.0008\n\n${common}\n\nIntime-se.\n\nDESPACHO\n\nProcesso 0600031-36.2024.6.14.0008\n\n${common}\n\nCite-se.\n\nDESPACHO\n\nProcesso 0600030-51.2024.6.14.0008\n\n${common}\n\nIntime-se.\n`,
    }),
  ];
  return linkDuplicates(docs);
}
