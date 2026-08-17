/**
 * Tokenizador CSV compatível com RFC 4180.
 *
 * Escrito à mão em vez de usar dependência porque precisamos de controle sobre
 * detecção de delimitador e sobre CSVs levemente malformados — exports reais
 * do PriceLabs variam em delimitador (`,` ou `;`) conforme a localidade da
 * conta, e um parser rígido rejeitaria arquivos válidos do ponto de vista do
 * usuário.
 *
 * Suporta: aspas duplas, aspas escapadas (`""`), quebras de linha dentro de
 * campos, CRLF, BOM UTF-8.
 */

export type Delimiter = ',' | ';' | '\t' | '|';

const CANDIDATE_DELIMITERS: Delimiter[] = [',', ';', '\t', '|'];

/** Remove o BOM UTF-8, que senão vira parte do nome da primeira coluna. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Detecta o delimitador contando ocorrências fora de aspas na primeira linha
 * não vazia. O que aparecer mais vezes vence; empate resolve por `,`.
 */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = firstNonEmptyLine(text);
  if (firstLine === null) return ',';

  let best: Delimiter = ',';
  let bestCount = 0;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = countOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function firstNonEmptyLine(text: string): string | null {
  let inQuotes = false;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      const line = text.slice(start, i);
      if (line.trim() !== '') return line;

      // Pula o \n de um CRLF.
      if (char === '\r' && text[i + 1] === '\n') i++;
      start = i + 1;
    }
  }

  const tail = text.slice(start);
  return tail.trim() === '' ? null : tail;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) count++;
  }

  return count;
}

/**
 * Divide o texto CSV em linhas de campos.
 * Linhas totalmente vazias são descartadas.
 */
export function tokenizeCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];

  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    pushField();
    // Descarta linhas em que todos os campos estão vazios.
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // Aspas escapadas: "" -> "
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      pushField();
      continue;
    }

    if (char === '\r') {
      // Trata CRLF e CR isolado como fim de linha.
      if (text[i + 1] === '\n') i++;
      pushRow();
      continue;
    }

    if (char === '\n') {
      pushRow();
      continue;
    }

    field += char;
  }

  // Último campo/linha, quando o arquivo não termina com quebra de linha.
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}

/** Conveniência: strip BOM + detecção de delimitador + tokenização. */
export function parseCsvText(text: string): {
  rows: string[][];
  delimiter: Delimiter;
} {
  const clean = stripBom(text);
  const delimiter = detectDelimiter(clean);
  return { rows: tokenizeCsv(clean, delimiter), delimiter };
}
