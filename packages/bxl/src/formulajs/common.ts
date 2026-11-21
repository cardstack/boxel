import { EXCEL_ERROR, throwExcelError } from './errors.ts';

// Text that is a number throughout: an optional sign, digits with an optional
// decimal point (or a leading one) and an optional exponent, with whitespace
// around it allowed. `"12"` and `" 1.5e3 "` are numbers; `"12abc"`, `""` and
// `"0x10"` are not. The score profile's SQL and the spreadsheet interpreter
// (bxl/sql/formula-eval.ts) read numeric text by the same rule.
export const EXCEL_NUMERIC_TEXT =
  /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
// The same rule as a Postgres regular expression, for SQL that reads text as
// a number (the score profile's aggregates, a comparison set's statistics).
export const EXCEL_NUMERIC_TEXT_SQL =
  '^\\s*[-+]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][-+]?[0-9]+)?\\s*$';

// The numbers an aggregate reads from a range: every number in it, nested
// lists flattened, and every text that is a number throughout (`"12"`, not
// `"12abc"` or `""`), since JSON often holds a number as text. Booleans,
// blanks and other text are skipped, as Excel skips them in a range. The
// score profile's SQL and the spreadsheet interpreter read a field the same
// way.
export function excelRangeNumbers(value: unknown): number[] {
  const numbers: number[] = [];
  for (const entry of flattenExcelArgs(value)) {
    if (typeof entry === 'number') {
      if (Number.isFinite(entry)) numbers.push(entry);
    } else if (typeof entry === 'string' && EXCEL_NUMERIC_TEXT.test(entry)) {
      const number = Number(entry);
      if (Number.isFinite(number)) numbers.push(number);
    }
  }
  return numbers;
}

export function isDefined(value: unknown) {
  return value !== undefined && value !== null;
}

export function isExcelBlank(value: unknown) {
  return value === undefined || value === null || value === '';
}

export function flattenExcelArgs(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [value];
  }

  const output: unknown[] = [];
  for (const entry of value) {
    output.push(...flattenExcelArgs(entry));
  }
  return output;
}

export function parseExcelNumber(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }

  if (
    typeof value === 'string' &&
    value !== '' &&
    !Number.isNaN(Number(value))
  ) {
    return parseFloat(value);
  }

  throwExcelError(EXCEL_ERROR.value);
}

export function parseExcelString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

export function parseExcelBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (upper === 'TRUE') {
      return true;
    }
    if (upper === 'FALSE') {
      return false;
    }
  }

  throwExcelError(EXCEL_ERROR.value);
}

export function parseExcelArray(value: unknown): unknown[] {
  return flattenExcelArgs(value);
}

export function parseExcelNumberArray(value: unknown): number[] {
  const entries = flattenExcelArgs(value);
  if (entries.length === 0) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return entries.map((entry) => parseExcelNumber(entry));
}

export function sumExcelRange(value: unknown) {
  let result = 0;

  for (const entry of flattenExcelArgs(value)) {
    if (typeof entry === 'number') {
      result += entry;
      continue;
    }
    if (typeof entry === 'string') {
      // JSON often holds a number as text, so text that is a number counts;
      // any other text adds nothing, a partial number such as "12abc"
      // included (upstream formulajs 2f7af6c9 made the same correction to
      // SUMIFS)
      if (EXCEL_NUMERIC_TEXT.test(entry)) {
        result += Number(entry);
      }
      continue;
    }
    if (Array.isArray(entry)) {
      result += sumExcelRange(entry);
    }
  }

  return result;
}

export function countExcelNumbers(value: unknown) {
  return excelRangeNumbers(value).length;
}

export function countExcelValues(value: unknown) {
  return flattenExcelArgs(value).filter(
    (entry) => entry !== undefined && entry !== null && entry !== '',
  ).length;
}

// The average of a range's numbers (`excelRangeNumbers`); #DIV/0! when it
// holds none, as in Excel.
export function averageExcelRange(value: unknown) {
  const numbers = excelRangeNumbers(value);
  if (numbers.length === 0) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  return numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
}

// The least and greatest of a range's numbers (`excelRangeNumbers`); 0 when
// it holds none, as in Excel.
export function minExcelRange(value: unknown) {
  const numbers = excelRangeNumbers(value);
  return numbers.length ? Math.min(...numbers) : 0;
}

export function maxExcelRange(value: unknown) {
  const numbers = excelRangeNumbers(value);
  return numbers.length ? Math.max(...numbers) : 0;
}

export function sampleStdDev(value: unknown) {
  const numbers = parseExcelNumberArray(value);
  if (numbers.length < 2) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  const mean = numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
  const variance =
    numbers.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) /
    (numbers.length - 1);
  return Math.sqrt(variance);
}

export function populationStdDev(value: unknown) {
  const numbers = parseExcelNumberArray(value);
  if (numbers.length === 0) {
    throwExcelError(EXCEL_ERROR.div0);
  }
  const mean = numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
  const variance =
    numbers.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) /
    numbers.length;
  return Math.sqrt(variance);
}
