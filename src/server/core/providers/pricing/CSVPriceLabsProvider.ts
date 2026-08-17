import { ValidationError } from '@/server/core/shared/errors';
import type {
  PricingDataset,
  PricingDayRow,
  PricingSourceName,
  Warning,
} from '@/server/core/types';
import {
  isEmptyValue,
  toBoolean,
  toInteger,
  toList,
  toNumber,
  toPercent,
  toRatio,
  toText,
} from './csv/coerce';
import {
  buildColumnMapping,
  type CanonicalField,
  type ColumnMapping,
} from './csv/columnMap';
import { detectDateOrder, isWeekendDay, parseDate, weekdayOf } from './csv/dates';
import { parseCsvText } from './csv/tokenizer';
import type { PricingDataProvider, PricingLoadInput } from './PricingDataProvider';

/**
 * Lê um CSV exportado do PriceLabs e o normaliza para `PricingDataset`.
 *
 * Princípios do parser:
 * - **tolerante na entrada**: delimitador, idioma, ordem das colunas e formato
 *   numérico variam entre exports e nenhum deles deve quebrar o import;
 * - **rígido na saída**: só entra no dataset o que foi entendido com certeza.
 *   Valor ambíguo vira `null` + um aviso, nunca um palpite;
 * - **auditável**: o mapeamento de colunas e todos os avisos acompanham o
 *   dataset, para o usuário conferir como o arquivo dele foi interpretado.
 */
export class CSVPriceLabsProvider implements PricingDataProvider {
  readonly source: PricingSourceName = 'CSV_PRICELABS';
  readonly name = 'CSVPriceLabsProvider';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async load(input: PricingLoadInput): Promise<PricingDataset> {
    if (input.kind !== 'csv') {
      throw new ValidationError(
        `${this.name} só aceita entrada do tipo "csv", recebeu "${input.kind}"`,
      );
    }

    return this.parse(input.content, input.fileName);
  }

  parse(content: string, fileName?: string): PricingDataset {
    const warnings: Warning[] = [];

    if (content.trim() === '') {
      throw new ValidationError('O arquivo CSV está vazio.');
    }

    const { rows: rawRows } = parseCsvText(content);

    if (rawRows.length === 0) {
      throw new ValidationError('O arquivo CSV não contém nenhuma linha.');
    }

    const [headerRow, ...dataRows] = rawRows as [string[], ...string[][]];

    if (dataRows.length === 0) {
      throw new ValidationError(
        'O arquivo CSV contém apenas o cabeçalho, sem linhas de dados.',
      );
    }

    const mapping = buildColumnMapping(headerRow);

    if (mapping.indexByField.date === undefined) {
      throw new ValidationError(
        'Não foi possível identificar a coluna de data no CSV. ' +
          `Colunas encontradas: ${headerRow.join(', ')}. ` +
          'Esperado um cabeçalho como "date", "data" ou "stay_date".',
      );
    }

    if (mapping.unmappedHeaders.length > 0) {
      warnings.push({
        code: 'UNMAPPED_COLUMNS',
        message:
          `${mapping.unmappedHeaders.length} coluna(s) não reconhecida(s) e ` +
          'ignorada(s) na análise.',
        context: { headers: mapping.unmappedHeaders },
      });
    }

    this.warnAboutMissingUsefulColumns(mapping, warnings);

    const dateIndex = mapping.indexByField.date;
    const dateOrder = detectDateOrder(
      dataRows.map((row) => row[dateIndex] ?? ''),
    );

    const currency = this.detectCurrency(mapping, dataRows);

    const { rows, skippedCount } = this.buildRows({
      dataRows,
      headerRow,
      mapping,
      dateOrder,
      warnings,
    });

    if (rows.length === 0) {
      throw new ValidationError(
        'Nenhuma linha do CSV pôde ser interpretada: todas foram descartadas ' +
          'por data inválida ou ausente.',
      );
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));

    this.warnAboutCalendarGaps(rows, warnings);

    return {
      source: this.source,
      ...(fileName !== undefined ? { fileName } : {}),
      currency,
      rows,
      dateFrom: rows[0]!.date,
      dateTo: rows[rows.length - 1]!.date,
      rowCount: rows.length,
      skippedCount,
      columnMapping: mapping.headerToField,
      warnings,
    };
  }

  private buildRows({
    dataRows,
    headerRow,
    mapping,
    dateOrder,
    warnings,
  }: {
    dataRows: string[][];
    headerRow: string[];
    mapping: ColumnMapping;
    dateOrder: ReturnType<typeof detectDateOrder>;
    warnings: Warning[];
  }): { rows: PricingDayRow[]; skippedCount: number } {
    const byDate = new Map<string, PricingDayRow>();
    const duplicateDates: string[] = [];
    const invalidDateLines: number[] = [];

    const get = (row: string[], field: CanonicalField): string | undefined => {
      const index = mapping.indexByField[field];
      return index === undefined ? undefined : row[index];
    };

    dataRows.forEach((row, i) => {
      // +2: uma linha para o cabeçalho, e numeração humana começa em 1.
      const lineNumber = i + 2;

      const date = parseDate(get(row, 'date'), dateOrder);

      if (date === null) {
        invalidDateLines.push(lineNumber);
        return;
      }

      if (byDate.has(date)) duplicateDates.push(date);

      const weekday = weekdayOf(date);

      const parsed: PricingDayRow = {
        date,
        price: toNumber(get(row, 'price')),
        recommendedPrice: toNumber(get(row, 'recommendedPrice')),
        minPrice: toNumber(get(row, 'minPrice')),
        maxPrice: toNumber(get(row, 'maxPrice')),
        occupancy: toRatio(get(row, 'occupancy')),
        booked: toBoolean(get(row, 'booked')),
        bookings: toInteger(get(row, 'bookings')),
        adr: toNumber(get(row, 'adr')),
        revpar: toNumber(get(row, 'revpar')),
        leadTimeDays: toInteger(get(row, 'leadTimeDays')),
        minStay: toInteger(get(row, 'minStay')),
        season: toText(get(row, 'season')),
        events: toList(get(row, 'events')),
        adjustmentPct: toPercent(get(row, 'adjustmentPct')),
        weekendMarkupPct: toPercent(get(row, 'weekendMarkupPct')),
        discountPct: toPercent(get(row, 'discountPct')),
        weekday,
        isWeekend: isWeekendDay(weekday),
        raw: this.buildRawRecord(headerRow, row),
      };

      this.validateRow(parsed, lineNumber, warnings);

      // Data repetida: a última ocorrência vence (exports costumam anexar
      // correções no fim do arquivo).
      byDate.set(date, parsed);
    });

    if (invalidDateLines.length > 0) {
      warnings.push({
        code: 'INVALID_DATE_ROWS',
        message:
          `${invalidDateLines.length} linha(s) descartada(s) por data ` +
          'ausente ou inválida.',
        context: { lines: invalidDateLines.slice(0, 20) },
      });
    }

    if (duplicateDates.length > 0) {
      warnings.push({
        code: 'DUPLICATE_DATES',
        message:
          `${duplicateDates.length} data(s) duplicada(s); a última ocorrência ` +
          'de cada uma foi mantida.',
        context: { dates: [...new Set(duplicateDates)].slice(0, 20) },
      });
    }

    return {
      rows: [...byDate.values()],
      skippedCount: invalidDateLines.length,
    };
  }

  /** Checagens de sanidade que não invalidam a linha, apenas alertam. */
  private validateRow(
    row: PricingDayRow,
    lineNumber: number,
    warnings: Warning[],
  ): void {
    if (row.price !== null && row.price < 0) {
      warnings.push({
        code: 'NEGATIVE_PRICE',
        message: `Preço negativo na linha ${lineNumber} (${row.date}).`,
        context: { line: lineNumber, date: row.date, price: row.price },
      });
      row.price = null;
    }

    if (
      row.minPrice !== null &&
      row.maxPrice !== null &&
      row.minPrice > row.maxPrice
    ) {
      warnings.push({
        code: 'MIN_ABOVE_MAX',
        message:
          `Preço mínimo maior que o máximo na linha ${lineNumber} ` +
          `(${row.date}); ambos foram descartados.`,
        context: {
          line: lineNumber,
          date: row.date,
          minPrice: row.minPrice,
          maxPrice: row.maxPrice,
        },
      });
      row.minPrice = null;
      row.maxPrice = null;
    }

    if (row.occupancy !== null && (row.occupancy < 0 || row.occupancy > 1)) {
      warnings.push({
        code: 'OCCUPANCY_OUT_OF_RANGE',
        message:
          `Ocupação fora da faixa 0-100% na linha ${lineNumber} (${row.date}).`,
        context: { line: lineNumber, date: row.date, occupancy: row.occupancy },
      });
      row.occupancy = null;
    }

    if (row.minStay !== null && row.minStay < 0) {
      row.minStay = null;
    }
  }

  private buildRawRecord(
    headerRow: string[],
    row: string[],
  ): Record<string, string> {
    const raw: Record<string, string> = {};

    headerRow.forEach((header, i) => {
      const value = row[i];
      if (value !== undefined && value.trim() !== '') {
        raw[header] = value.trim();
      }
    });

    return raw;
  }

  private detectCurrency(
    mapping: ColumnMapping,
    dataRows: string[][],
  ): string | null {
    const index = mapping.indexByField.currency;

    if (index !== undefined) {
      for (const row of dataRows) {
        const value = toText(row[index]);
        if (value !== null) return value.toUpperCase();
      }
    }

    // Sem coluna de moeda, tenta inferir pelo símbolo no campo de preço.
    const priceIndex = mapping.indexByField.price;
    if (priceIndex !== undefined) {
      for (const row of dataRows) {
        const value = row[priceIndex];
        if (isEmptyValue(value)) continue;

        if (value!.includes('R$')) return 'BRL';
        if (value!.includes('€')) return 'EUR';
        if (value!.includes('£')) return 'GBP';
        if (value!.includes('$')) return 'USD';
      }
    }

    return null;
  }

  /**
   * Avisa sobre colunas ausentes que reduzem o alcance do diagnóstico.
   * Não são erros: o produto funciona com dados parciais, mas o usuário
   * precisa saber o que deixou de ser avaliado.
   */
  private warnAboutMissingUsefulColumns(
    mapping: ColumnMapping,
    warnings: Warning[],
  ): void {
    const useful: Array<[CanonicalField, string]> = [
      ['price', 'preço praticado'],
      ['recommendedPrice', 'preço recomendado'],
      ['booked', 'status de reserva'],
      ['occupancy', 'ocupação'],
      ['minStay', 'estadia mínima'],
    ];

    const missing = useful
      .filter(([field]) => mapping.indexByField[field] === undefined)
      .map(([, label]) => label);

    if (missing.length > 0) {
      warnings.push({
        code: 'MISSING_USEFUL_COLUMNS',
        message:
          'O CSV não traz: ' +
          `${missing.join(', ')}. As métricas que dependem desses dados não ` +
          'serão calculadas.',
        context: { missing },
      });
    }
  }

  /** Alerta quando faltam dias no meio do período — o calendário tem buracos. */
  private warnAboutCalendarGaps(
    rows: PricingDayRow[],
    warnings: Warning[],
  ): void {
    if (rows.length < 2) return;

    const first = rows[0]!.date;
    const last = rows[rows.length - 1]!.date;

    const expectedDays =
      Math.round(
        (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
          86_400_000,
      ) + 1;

    const missingDays = expectedDays - rows.length;

    if (missingDays > 0) {
      warnings.push({
        code: 'MISSING_CALENDAR_DAYS',
        message:
          `${missingDays} dia(s) ausente(s) entre ${first} e ${last}. ` +
          'As métricas consideram apenas os dias presentes no arquivo.',
        context: { first, last, expectedDays, presentDays: rows.length },
      });
    }
  }
}
