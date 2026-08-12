import {
  averageExcelRange,
  countExcelNumbers,
  countExcelValues,
  flattenExcelArgs,
  isExcelBlank,
  maxExcelRange,
  minExcelRange,
  parseExcelBool,
  parseExcelNumber,
  parseExcelNumberArray,
  parseExcelString,
  populationStdDev,
  sampleStdDev,
  sumExcelRange,
} from '../../formulajs/common.js';
import { createCriteriaMatcher, matchesCriteria } from '../../formulajs/criteria.js';
import { EXCEL_ERROR, throwExcelError } from '../../formulajs/errors.js';
import { compare } from '../../jqtools/evaluate/compare.js';
import { BareNativeFilter, wrapBareNativeFilters } from '../../jqtools/evaluate/filters/lib/nativeFilter.js';

function asRowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function expectRows(rowsLike: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rowsLike)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return rowsLike.map((row) => asRowObject(row));
}

function expectCriteriaObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return value as Record<string, unknown>;
}

function colValues(rowsLike: unknown, keyLike: unknown) {
  const rows = expectRows(rowsLike);
  const key = parseExcelString(keyLike);
  return rows.map((row) =>
    Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null,
  );
}

function filterRowsByCriteria(
  rowsLike: unknown,
  criteriaLike: unknown,
): Record<string, unknown>[] {
  const rows = expectRows(rowsLike);
  const criteria = expectCriteriaObject(criteriaLike);

  return rows.filter((row) =>
    Object.entries(criteria).every(([key, expected]) =>
      matchesCriteria(row[key] ?? null, expected),
    ),
  );
}

function roundBase(numberLike: unknown, digitsLike: unknown, roundFn: Math['round']) {
  const number = parseExcelNumber(numberLike);
  const digits = parseExcelNumber(digitsLike);
  const sign = number >= 0 ? 1 : -1;
  const absolute = Math.abs(number);

  let pair = `${absolute}e${digits}`.split('e');
  const shifted = roundFn(Number(`${pair[0]}e${pair[1]}`));
  pair = `${shifted}e${-digits}`.split('e');
  return Number(`${pair[0]}e${pair[1]}`) * sign;
}

function ceilingValue(numberLike: unknown, significanceLike = 1) {
  const number = parseExcelNumber(numberLike);
  const significance = Math.abs(parseExcelNumber(significanceLike));
  if (significance === 0) {
    return 0;
  }
  return Math.ceil(number / significance) * significance;
}

function floorValue(numberLike: unknown, significanceLike = 1) {
  const number = parseExcelNumber(numberLike);
  const significance = Math.abs(parseExcelNumber(significanceLike));
  if (significance === 0) {
    return 0;
  }
  return Math.floor(number / significance) * significance;
}

function checkedMathResult(result: number) {
  if (!Number.isFinite(result) || Number.isNaN(result)) {
    throwExcelError(EXCEL_ERROR.num);
  }
  return result;
}

function factorialValue(valueLike: unknown) {
  const number = Math.floor(parseExcelNumber(valueLike));
  if (number < 0) {
    throwExcelError(EXCEL_ERROR.num);
  }

  let result = 1;
  for (let factor = 2; factor <= number; factor++) {
    result *= factor;
    checkedMathResult(result);
  }
  return result;
}

function logValue(numberLike: unknown, baseLike: unknown = 10) {
  const number = parseExcelNumber(numberLike);
  const base = parseExcelNumber(baseLike);
  if (number <= 0 || base <= 0 || base === 1) {
    throwExcelError(EXCEL_ERROR.num);
  }
  if (base === 10) {
    return checkedMathResult(Math.log10(number));
  }
  return checkedMathResult(Math.log(number) / Math.log(base));
}

function truncValue(numberLike: unknown, digitsLike = 0) {
  const number = parseExcelNumber(numberLike);
  const digits = Math.trunc(parseExcelNumber(digitsLike));
  const factor = 10 ** digits;
  return (number < 0 ? -1 : 1) * Math.floor(Math.abs(number) * factor) / factor;
}

function multinomialValue(valuesLike: unknown) {
  const values = parseExcelNumberArray(valuesLike);
  const sum = values.reduce((total, entry) => total + Math.floor(entry), 0);
  const divisor = values.reduce(
    (product, entry) => product * factorialValue(entry),
    1,
  );
  return checkedMathResult(factorialValue(sum) / divisor);
}

function seriesSumValue(
  xLike: unknown,
  nLike: unknown,
  mLike: unknown,
  coefficientsLike: unknown,
) {
  const x = parseExcelNumber(xLike);
  const n = parseExcelNumber(nLike);
  const m = parseExcelNumber(mLike);
  const coefficients = parseExcelNumberArray(coefficientsLike);
  return checkedMathResult(
    coefficients.reduce(
      (total, coefficient, index) => total + coefficient * x ** (n + index * m),
      0,
    ),
  );
}

function sumPairValue(
  leftLike: unknown,
  rightLike: unknown,
  mapper: (left: number, right: number) => number,
) {
  const left = parseExcelNumberArray(leftLike);
  const right = parseExcelNumberArray(rightLike);
  if (left.length !== right.length) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return checkedMathResult(
    left.reduce((sum, entry, index) => sum + mapper(entry, right[index]!), 0),
  );
}

// Excel serial-date conversion is inlined here so this module doesn't pull
// in formulajs/dateSerial.ts (now lazy-loaded). The constants mirror that
// module: 1900-01-01 epoch with the +2 fudge for the documented Excel
// 1900-leap-year bug. If you change one, change both.
const NOW_SERIAL_MS_PER_DAY = 86_400_000;
const NOW_SERIAL_EPOCH_MS = Date.UTC(1900, 0, 1);
const NOW_SERIAL_LEAP_BUG_BOUNDARY_MS = Date.UTC(1900, 1, 28);

function nowSerial() {
  const now = new Date();
  const day = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const seconds =
    now.getUTCHours() * 3600 +
    now.getUTCMinutes() * 60 +
    now.getUTCSeconds() +
    now.getUTCMilliseconds() / 1000;
  const addOn = day.getTime() > NOW_SERIAL_LEAP_BUG_BOUNDARY_MS ? 2 : 1;
  const daySerial =
    Math.ceil((day.getTime() - NOW_SERIAL_EPOCH_MS) / NOW_SERIAL_MS_PER_DAY) +
    addOn;
  return daySerial + seconds / 86400;
}

function replaceNth(text: string, oldText: string, newText: string, instance: number) {
  let index = 0;
  let found = 0;

  while (index > -1 && text.indexOf(oldText, index) > -1) {
    index = text.indexOf(oldText, index + 1);
    found++;
    if (index > -1 && found === instance) {
      return text.slice(0, index) + newText + text.slice(index + oldText.length);
    }
  }

  return text;
}

function toTextForConcat(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

function excelValue(textLike: unknown) {
  if (typeof textLike === 'number') {
    return textLike;
  }

  let text = textLike;
  if (text === undefined || text === null) {
    text = '';
  }

  if (typeof text !== 'string') {
    throwExcelError(EXCEL_ERROR.value);
  }

  const isPercent = /(%)$/.test(text) || /^(%)/.test(text);
  let normalized = text.replace(/^[^0-9-]{0,3}/, '');
  normalized = normalized.replace(/[^0-9]{0,3}$/, '');
  normalized = normalized.replace(/[ ,]/g, '');

  if (normalized === '') {
    if (text.trim() === '') {
      return 0;
    }
    throwExcelError(EXCEL_ERROR.value);
  }

  const output = Number(normalized);
  if (Number.isNaN(output)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return isPercent ? output * 0.01 : output;
}

function excelText(valueLike: unknown, formatTextLike: unknown) {
  if (valueLike instanceof Date) {
    return valueLike.toISOString().slice(0, 10);
  }

  if (formatTextLike === undefined || formatTextLike === null) {
    return '';
  }

  if (typeof formatTextLike === 'number') {
    return String(formatTextLike);
  }

  if (typeof formatTextLike !== 'string') {
    throwExcelError(EXCEL_ERROR.value);
  }

  const currencySymbol = formatTextLike.startsWith('$') ? '$' : '';
  const isPercent = formatTextLike.endsWith('%');
  const formatText = formatTextLike.replace(/%/g, '').replace(/\$/g, '');
  const decimalPlaces = formatText.includes('.')
    ? (formatText.split('.')[1].match(/0/g) ?? []).length
    : 0;
  const noCommas = !formatText.includes(',');
  let value = parseExcelNumber(valueLike);

  if (isPercent) {
    value *= 100;
  }

  let rendered = fixedValue(value, decimalPlaces, noCommas);
  if (rendered.startsWith('-')) {
    rendered = `-${currencySymbol}${rendered.slice(1)}`;
  } else {
    rendered = `${currencySymbol}${rendered}`;
  }

  if (isPercent) {
    rendered += '%';
  }

  return rendered;
}

function fixedValue(numberLike: unknown, decimalsLike = 2, noCommasLike = false) {
  let number = parseExcelNumber(numberLike);
  const decimals = parseExcelNumber(decimalsLike);
  const noCommas = parseExcelBool(noCommasLike);

  if (decimals < 0) {
    const factor = Math.pow(10, -decimals);
    number = Math.round(number / factor) * factor;
  } else {
    number = Number(number.toFixed(decimals));
  }

  let rendered = decimals < 0 ? String(number) : number.toFixed(decimals);
  if (noCommas) {
    return rendered.replace(/,/g, '');
  }

  const parts = rendered.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  rendered = parts.join('.');
  if (number < 0) {
    return rendered;
  }
  return rendered;
}

function dollarValue(numberLike: unknown, decimalsLike = 2) {
  let number = parseExcelNumber(numberLike);
  const decimals = parseExcelNumber(decimalsLike);
  number = roundBase(number, decimals, Math.round);

  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals >= 0 ? decimals : 0,
    maximumFractionDigits: decimals >= 0 ? decimals : 0,
  };

  const formatted = number.toLocaleString('en-US', options);
  if (number < 0) {
    return `(${formatted.slice(1)})`;
  }
  return formatted;
}

function numberValue(
  textLike: unknown,
  decimalSeparatorLike?: unknown,
  groupSeparatorLike?: unknown,
) {
  const text = textLike === undefined || textLike === null ? '' : textLike;
  if (typeof text === 'number') {
    return text;
  }
  if (typeof text !== 'string') {
    throwExcelError(EXCEL_ERROR.na);
  }

  const decimalSeparator =
    decimalSeparatorLike === undefined ? '.' : parseExcelString(decimalSeparatorLike);
  const groupSeparator =
    groupSeparatorLike === undefined ? ',' : parseExcelString(groupSeparatorLike);
  if (decimalSeparator === groupSeparator) {
    throwExcelError(EXCEL_ERROR.value);
  }

  const parsed = Number(
    text.split(groupSeparator).join('').replace(decimalSeparator, '.'),
  );
  if (Number.isNaN(parsed)) {
    throwExcelError(EXCEL_ERROR.value);
  }
  return parsed;
}

const ROMAN_TOKEN_VALUES: Record<string, number> = {
  M: 1000,
  CM: 900,
  D: 500,
  CD: 400,
  C: 100,
  XC: 90,
  L: 50,
  XL: 40,
  X: 10,
  IX: 9,
  V: 5,
  IV: 4,
  I: 1,
};

function arabicValue(textLike: unknown) {
  const text = parseExcelString(textLike);
  if (!/^M*(?:D?C{0,3}|C[MD])(?:L?X{0,3}|X[CL])(?:V?I{0,3}|I[XV])$/.test(text)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  let total = 0;
  text.replace(/[MDLV]|C[MD]?|X[CL]?|I[XV]?/g, (token) => {
    total += ROMAN_TOKEN_VALUES[token] ?? 0;
    return token;
  });
  return total;
}

function romanValue(numberLike: unknown) {
  const number = Math.floor(parseExcelNumber(numberLike));
  if (number < 0) {
    throwExcelError(EXCEL_ERROR.value);
  }

  const digits = String(number).split('');
  const key = [
    '',
    'C',
    'CC',
    'CCC',
    'CD',
    'D',
    'DC',
    'DCC',
    'DCCC',
    'CM',
    '',
    'X',
    'XX',
    'XXX',
    'XL',
    'L',
    'LX',
    'LXX',
    'LXXX',
    'XC',
    '',
    'I',
    'II',
    'III',
    'IV',
    'V',
    'VI',
    'VII',
    'VIII',
    'IX',
  ];
  let roman = '';
  let index = 3;

  while (index--) {
    roman = (key[Number(digits.pop()) + index * 10] ?? '') + roman;
  }

  return `${'M'.repeat(Number(digits.join('')))}${roman}`;
}

function properValue(textLike: unknown) {
  return parseExcelString(textLike).replace(
    /\w\S*/g,
    (entry) =>
      entry.charAt(0).toUpperCase() + entry.slice(1).toLowerCase(),
  );
}

function textJoin(delimiterLike: unknown, ignoreEmptyLike: unknown, valuesLike: unknown) {
  const delimiter = delimiterLike === null || delimiterLike === undefined
    ? ''
    : Array.isArray(delimiterLike)
      ? flattenExcelArgs(delimiterLike).map((entry) => toTextForConcat(entry)).join('')
      : String(delimiterLike);
  const ignoreEmpty = parseExcelBool(ignoreEmptyLike);
  const values = flattenExcelArgs(valuesLike)
    .filter((entry) => !ignoreEmpty || !isExcelBlank(entry))
    .map((entry) => toTextForConcat(entry));
  return values.join(delimiter);
}

function logicalRangeValue(valueLike: unknown) {
  let result: boolean | null = null;
  for (const entry of flattenExcelArgs(valueLike)) {
    if (entry === undefined || entry === null || typeof entry === 'string') {
      continue;
    }
    if (result === null) {
      result = false;
    }
    if (!entry) {
      return false;
    }
    result = true;
  }

  if (result === null) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return result;
}

function logicalAnyValue(valueLike: unknown) {
  let sawValue = false;
  for (const entry of flattenExcelArgs(valueLike)) {
    if (entry === undefined || entry === null || typeof entry === 'string') {
      continue;
    }
    sawValue = true;
    if (entry) {
      return true;
    }
  }

  if (!sawValue) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return false;
}

function logicalXorValue(valueLike: unknown) {
  let count = 0;
  let sawValue = false;

  for (const entry of flattenExcelArgs(valueLike)) {
    if (entry === undefined || entry === null || typeof entry === 'string') {
      continue;
    }
    sawValue = true;
    if (entry) {
      count++;
    }
  }

  if (!sawValue) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return Boolean(Math.floor(Math.abs(count)) & 1);
}

function countIf(rangeLike: unknown, criteriaLike: unknown) {
  const range = flattenExcelArgs(rangeLike);
  const matcher = createCriteriaMatcher(criteriaLike);
  return range.reduce<number>(
    (count, entry) => count + (matcher(entry) ? 1 : 0),
    0,
  );
}

function sumIf(rangeLike: unknown, criteriaLike: unknown, sumRangeLike?: unknown) {
  const range = flattenExcelArgs(rangeLike);
  const sumRange = flattenExcelArgs(sumRangeLike ?? rangeLike);
  const matcher = createCriteriaMatcher(criteriaLike);
  let total = 0;

  for (let i = 0; i < range.length; i++) {
    if (matcher(range[i])) {
      total += parseExcelNumber(sumRange[i] ?? 0);
    }
  }

  return total;
}

function averageIf(
  rangeLike: unknown,
  criteriaLike: unknown,
  averageRangeLike?: unknown,
) {
  const range = flattenExcelArgs(rangeLike);
  const averageRange = flattenExcelArgs(averageRangeLike ?? rangeLike);
  const matcher = createCriteriaMatcher(criteriaLike);
  let total = 0;
  let count = 0;

  for (let i = 0; i < range.length; i++) {
    if (matcher(range[i])) {
      total += parseExcelNumber(averageRange[i] ?? 0);
      count++;
    }
  }

  if (count === 0) {
    throwExcelError(EXCEL_ERROR.div0);
  }

  return total / count;
}

function chooseValue(indexLike: unknown, optionsLike: unknown) {
  const index = Math.trunc(parseExcelNumber(indexLike));
  const options = Array.isArray(optionsLike) ? optionsLike : [optionsLike];

  if (index < 1 || index > options.length) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return options[index - 1];
}

function matchValue(
  lookupValue: unknown,
  lookupArrayLike: unknown,
  matchTypeLike = 1,
) {
  const lookupArray = flattenExcelArgs(lookupArrayLike);
  const matchType = parseExcelNumber(matchTypeLike);

  if (![1, 0, -1].includes(matchType)) {
    throwExcelError(EXCEL_ERROR.na);
  }

  let index: number | undefined;
  let indexValue: unknown;

  for (let idx = 0; idx < lookupArray.length; idx++) {
    const entry = lookupArray[idx];

    if (matchType === 1) {
      if (entry === lookupValue) {
        return idx + 1;
      }
      if ((entry as never) < (lookupValue as never)) {
        if (indexValue === undefined || (entry as never) > (indexValue as never)) {
          index = idx + 1;
          indexValue = entry;
        }
      }
    } else if (matchType === 0) {
      if (typeof lookupValue === 'string' && typeof entry === 'string') {
        const escaped = lookupValue
          .toLowerCase()
          .replace(/\?/g, '.')
          .replace(/\*/g, '.*')
          .replace(/~/g, '\\')
          .replace(/\+/g, '\\+')
          .replace(/\(/g, '\\(')
          .replace(/\)/g, '\\)')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]');
        if (new RegExp(`^${escaped}$`).test(entry.toLowerCase())) {
          return idx + 1;
        }
      } else if (entry === lookupValue) {
        return idx + 1;
      }
    } else if (matchType === -1) {
      if (entry === lookupValue) {
        return idx + 1;
      }
      if ((entry as never) > (lookupValue as never)) {
        if (indexValue === undefined || (entry as never) < (indexValue as never)) {
          index = idx + 1;
          indexValue = entry;
        }
      }
    }
  }

  if (index === undefined) {
    throwExcelError(EXCEL_ERROR.na);
  }

  return index;
}

function toLookupTable(tableLike: unknown): unknown[][] {
  if (!Array.isArray(tableLike)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  return tableLike.map((row) => (Array.isArray(row) ? row : [row]));
}

function transposeLookupTable(tableLike: unknown) {
  const table = toLookupTable(tableLike);
  const width = table.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, columnIndex) =>
    table.map((row) => row[columnIndex]),
  );
}

function indexValue(
  arrayLike: unknown,
  rowNumLike: unknown,
  columnNumLike?: unknown,
) {
  if (!Array.isArray(arrayLike)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  let rowNum = parseExcelNumber(rowNumLike);
  let columnNum = columnNumLike === undefined ? undefined : parseExcelNumber(columnNumLike);
  const isOneDimensionRange = arrayLike.length > 0 && !Array.isArray(arrayLike[0]);

  if (isOneDimensionRange && columnNum === undefined) {
    columnNum = rowNum;
    rowNum = 1;
  } else {
    rowNum = rowNum || 1;
    columnNum = columnNum || 1;
  }

  if (rowNum < 0 || (columnNum ?? 0) < 0) {
    throwExcelError(EXCEL_ERROR.value);
  }

  if (isOneDimensionRange) {
    const vector = arrayLike as unknown[];
    if (rowNum === 1 && (columnNum ?? 0) <= vector.length) {
      return vector[(columnNum ?? 1) - 1];
    }
    throwExcelError(EXCEL_ERROR.ref);
  }

  const table = arrayLike as unknown[][];
  if (rowNum <= table.length && (columnNum ?? 0) <= table[rowNum - 1]!.length) {
    return table[rowNum - 1]![((columnNum ?? 1) - 1)];
  }

  throwExcelError(EXCEL_ERROR.ref);
}

function lookupValue(
  lookupLike: unknown,
  arrayLike: unknown,
  resultArrayLike?: unknown,
) {
  const lookupArray = flattenExcelArgs(arrayLike);
  const resultArray = resultArrayLike === undefined
    ? lookupArray
    : flattenExcelArgs(resultArrayLike);
  const isNumberLookup = typeof lookupLike === 'number';

  let result: unknown = undefined;
  let found = false;

  for (let index = 0; index < lookupArray.length; index++) {
    const entry = lookupArray[index];

    if (entry === lookupLike) {
      return resultArray[index];
    }

    if (
      (isNumberLookup && typeof entry === 'number' && entry <= (lookupLike as number)) ||
      (typeof entry === 'string' &&
        typeof lookupLike === 'string' &&
        entry.localeCompare(lookupLike) < 0)
    ) {
      result = resultArray[index];
      found = true;
      continue;
    }

    if (isNumberLookup && typeof entry === 'number' && entry > (lookupLike as number)) {
      if (found) {
        return result;
      }
      break;
    }
  }

  if (!found) {
    throwExcelError(EXCEL_ERROR.na);
  }

  return result;
}

function xlookupValue(
  lookupLike: unknown,
  lookupArrayLike: unknown,
  returnArrayLike: unknown,
  ifNotFound: unknown = undefined,
  matchModeLike: unknown = 0,
  searchModeLike: unknown = 1,
) {
  const lookupArray = flattenExcelArgs(lookupArrayLike);
  const returnArray = flattenExcelArgs(returnArrayLike);
  const matchMode = parseExcelNumber(matchModeLike);
  const searchMode = parseExcelNumber(searchModeLike);

  if (![0, -1, 1].includes(matchMode) || ![1, -1].includes(searchMode)) {
    throwExcelError(EXCEL_ERROR.value);
  }

  const indices = lookupArray.map((_, index) => index);
  if (searchMode === -1) {
    indices.reverse();
  }

  for (const index of indices) {
    const entry = lookupArray[index];
    if (entry === lookupLike) {
      return returnArray[index] ?? null;
    }
  }

  if (matchMode !== 0) {
    let bestIndex: number | undefined;
    for (const index of indices) {
      const entry = lookupArray[index];
      if (typeof entry === 'number' && typeof lookupLike === 'number') {
        if (
          (matchMode === -1 && entry < lookupLike) ||
          (matchMode === 1 && entry > lookupLike)
        ) {
          if (
            bestIndex === undefined ||
            (matchMode === -1 && entry > (lookupArray[bestIndex] as number)) ||
            (matchMode === 1 && entry < (lookupArray[bestIndex] as number))
          ) {
            bestIndex = index;
          }
        }
      }

      if (typeof entry === 'string' && typeof lookupLike === 'string') {
        const order = entry.localeCompare(lookupLike);
        if (
          (matchMode === -1 && order < 0) ||
          (matchMode === 1 && order > 0)
        ) {
          if (
            bestIndex === undefined ||
            (matchMode === -1 &&
              entry.localeCompare(String(lookupArray[bestIndex])) > 0) ||
            (matchMode === 1 &&
              entry.localeCompare(String(lookupArray[bestIndex])) < 0)
          ) {
            bestIndex = index;
          }
        }
      }
    }

    if (bestIndex !== undefined) {
      return returnArray[bestIndex] ?? null;
    }
  }

  if (ifNotFound !== undefined) {
    return ifNotFound;
  }

  throwExcelError(EXCEL_ERROR.na);
}

function vlookupValue(
  lookupLike: unknown,
  tableLike: unknown,
  colIndexLike: unknown,
  rangeLookupLike?: unknown,
) {
  if (!tableLike) {
    throwExcelError(EXCEL_ERROR.na);
  }

  const colIndex = parseExcelNumber(colIndexLike);
  if (!colIndex) {
    throwExcelError(EXCEL_ERROR.na);
  }

  if (colIndex < 1) {
    throwExcelError(EXCEL_ERROR.value);
  }

  const table = toLookupTable(tableLike);
  const rangeLookup = rangeLookupLike === undefined
    ? true
    : parseExcelBool(rangeLookupLike);
  const lookupValueNormalized =
    typeof lookupLike === 'string' ? lookupLike.toLowerCase() : lookupLike;
  const isNumberLookup = typeof lookupLike === 'number';

  let result: unknown = undefined;
  let found = false;
  let exactMatchOnly = false;

  for (const row of table) {
    const rowValue = typeof row[0] === 'string' ? row[0].toLowerCase() : row[0];

    if (rowValue === lookupValueNormalized) {
      if (colIndex > row.length) {
        throwExcelError(EXCEL_ERROR.ref);
      }
      return row[colIndex - 1];
    }

    if (
      !exactMatchOnly &&
      rangeLookup &&
      (
        (isNumberLookup && typeof rowValue === 'number' && rowValue <= (lookupLike as number)) ||
        (typeof rowValue === 'string' &&
          typeof lookupValueNormalized === 'string' &&
          rowValue.localeCompare(lookupValueNormalized) < 0)
      )
    ) {
      if (colIndex > row.length) {
        throwExcelError(EXCEL_ERROR.ref);
      }
      result = row[colIndex - 1];
      found = true;
    }

    if (isNumberLookup && typeof rowValue === 'number' && rowValue > (lookupLike as number)) {
      exactMatchOnly = true;
    }
  }

  if (!found) {
    throwExcelError(EXCEL_ERROR.na);
  }

  return result;
}

function lookupByRows(
  rowsLike: unknown,
  lookupKeyLike: unknown,
  lookupValueLike: unknown,
  resultKeyLike: unknown,
) {
  return lookupValue(
    lookupValueLike,
    colValues(rowsLike, lookupKeyLike),
    colValues(rowsLike, resultKeyLike),
  );
}

function vlookupByRows(
  rowsLike: unknown,
  lookupKeyLike: unknown,
  lookupValueLike: unknown,
  resultKeyLike: unknown,
  rangeLookupLike = false,
) {
  const lookupKey = parseExcelString(lookupKeyLike);
  const resultKey = parseExcelString(resultKeyLike);
  const rows = expectRows(rowsLike);
  const table = rows.map((row) => [row[lookupKey] ?? null, row[resultKey] ?? null]);
  return vlookupValue(lookupValueLike, table, 2, rangeLookupLike);
}

function sqlLikeValue(valueLike: unknown, patternLike: unknown): boolean {
  const value = parseExcelString(valueLike);
  const pattern = parseExcelString(patternLike);
  let regex = '^';
  for (const char of pattern) {
    if (char === '%') {
      regex += '.*';
    } else if (char === '_') {
      regex += '.';
    } else {
      regex += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
  }
  regex += '$';
  return new RegExp(regex, 's').test(value);
}

function betweenValue(value: unknown, lower: unknown, upper: unknown): boolean {
  return compare(value, lower) >= 0 && compare(value, upper) <= 0;
}

const bareNativeFilters: Record<string, BareNativeFilter> = {
  *'between/3'(_input, value, lower, upper) {
    yield betweenValue(value, lower, upper);
  },
  *'like/2'(_input, value, pattern) {
    yield sqlLikeValue(value, pattern);
  },
  *'ABS/1'(_input, value) {
    yield Math.abs(parseExcelNumber(value));
  },
  *'ACOS/1'(_input, value) {
    yield checkedMathResult(Math.acos(parseExcelNumber(value)));
  },
  *'ACOSH/1'(_input, value) {
    yield checkedMathResult(Math.acosh(parseExcelNumber(value)));
  },
  *'ACOT/1'(_input, value) {
    const number = parseExcelNumber(value);
    const result = Math.atan(1 / number);
    yield checkedMathResult(number < 0 ? result + Math.PI : result);
  },
  *'ACOTH/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (Math.abs(number) <= 1) {
      throwExcelError(EXCEL_ERROR.num);
    }
    yield checkedMathResult(0.5 * Math.log((number + 1) / (number - 1)));
  },
  *'AND/1'(_input, value) {
    yield logicalRangeValue(value);
  },
  *'ARABIC/1'(_input, text) {
    yield arabicValue(text);
  },
  *'ASIN/1'(_input, value) {
    yield checkedMathResult(Math.asin(parseExcelNumber(value)));
  },
  *'ASINH/1'(_input, value) {
    yield checkedMathResult(Math.asinh(parseExcelNumber(value)));
  },
  *'ATAN/1'(_input, value) {
    yield Math.atan(parseExcelNumber(value));
  },
  *'ATAN2/2'(_input, xNum, yNum) {
    const x = parseExcelNumber(xNum);
    const y = parseExcelNumber(yNum);
    if (x === 0 && y === 0) {
      throwExcelError(EXCEL_ERROR.div0);
    }
    yield checkedMathResult(Math.atan2(y, x));
  },
  *'ATANH/1'(_input, value) {
    yield checkedMathResult(Math.atanh(parseExcelNumber(value)));
  },
  *'AVERAGE/1'(_input, value) {
    yield averageExcelRange(value);
  },
  *'AVERAGEIF/2'(_input, range, criteria) {
    yield averageIf(range, criteria);
  },
  *'AVERAGEIF/3'(_input, range, criteria, averageRange) {
    yield averageIf(range, criteria, averageRange);
  },
  *'AVERAGEIF_BY/4'(_input, rows, valueKey, criteriaKey, criteria) {
    yield averageIf(colValues(rows, criteriaKey), criteria, colValues(rows, valueKey));
  },
  *'AVERAGEIFS_BY/3'(_input, rows, valueKey, criteriaObject) {
    const filteredRows = filterRowsByCriteria(rows, criteriaObject);
    yield averageExcelRange(colValues(filteredRows, valueKey));
  },
  *'CHAR/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number === 0) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield String.fromCharCode(number);
  },
  *'CHOOSE/2'(_input, index, options) {
    yield chooseValue(index, options);
  },
  *'CLEAN/1'(_input, value) {
    yield parseExcelString(value).replace(/[\0-\x1F]/g, '');
  },
  *'CODE/1'(_input, value) {
    const text = parseExcelString(value);
    const code = text.charCodeAt(0);
    if (Number.isNaN(code)) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield code;
  },
  *'COL/2'(_input, rows, key) {
    yield colValues(rows, key);
  },
  *'COLUMNS/1'(_input, value) {
    if (!Array.isArray(value)) {
      throwExcelError(EXCEL_ERROR.value);
    }
    if (value.length === 0) {
      yield 0;
      return;
    }
    yield Array.isArray(value[0]) ? value[0].length : value.length;
  },
  *'CONCAT/1'(_input, value) {
    yield flattenExcelArgs(value).map((entry) => toTextForConcat(entry)).join('');
  },
  *'CONCATENATE/1'(_input, value) {
    yield flattenExcelArgs(value).map((entry) => toTextForConcat(entry)).join('');
  },
  *'COUNT/1'(_input, value) {
    yield countExcelNumbers(value);
  },
  *'COUNTA/1'(_input, value) {
    yield countExcelValues(value);
  },
  *'COUNTIF/2'(_input, range, criteria) {
    yield countIf(range, criteria);
  },
  *'COUNTIF_BY/3'(_input, rows, criteriaKey, criteria) {
    yield countIf(colValues(rows, criteriaKey), criteria);
  },
  *'COUNTIFS_BY/2'(_input, rows, criteriaObject) {
    yield filterRowsByCriteria(rows, criteriaObject).length;
  },
  *'COS/1'(_input, value) {
    yield checkedMathResult(Math.cos(parseExcelNumber(value)));
  },
  *'COSH/1'(_input, value) {
    yield checkedMathResult(Math.cosh(parseExcelNumber(value)));
  },
  *'COT/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number === 0) {
      throwExcelError(EXCEL_ERROR.div0);
    }
    yield checkedMathResult(1 / Math.tan(number));
  },
  *'COTH/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number === 0) {
      throwExcelError(EXCEL_ERROR.div0);
    }
    yield checkedMathResult(1 / Math.tanh(number));
  },
  *'CSC/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number === 0) {
      throwExcelError(EXCEL_ERROR.div0);
    }
    yield checkedMathResult(1 / Math.sin(number));
  },
  *'CSCH/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number === 0) {
      throwExcelError(EXCEL_ERROR.div0);
    }
    yield checkedMathResult(1 / Math.sinh(number));
  },
  *'DOLLAR/1'(_input, number) {
    yield dollarValue(number);
  },
  *'DOLLAR/2'(_input, number, decimals) {
    yield dollarValue(number, decimals);
  },
  *'EXACT/2'(_input, left, right) {
    yield parseExcelString(left) === parseExcelString(right);
  },
  *'EXP/1'(_input, value) {
    yield checkedMathResult(Math.exp(parseExcelNumber(value)));
  },
  *'FALSE/0'() {
    yield false;
  },
  *'FIND/2'(_input, findText, withinText) {
    const found = parseExcelString(withinText).indexOf(parseExcelString(findText));
    if (found === -1) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield found + 1;
  },
  *'FIND/3'(_input, findText, withinText, startNum) {
    const found = parseExcelString(withinText).indexOf(
      parseExcelString(findText),
      parseExcelNumber(startNum) - 1,
    );
    if (found === -1) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield found + 1;
  },
  *'FIXED/1'(_input, number) {
    yield fixedValue(number);
  },
  *'FIXED/2'(_input, number, decimals) {
    yield fixedValue(number, decimals);
  },
  *'FIXED/3'(_input, number, decimals, noCommas) {
    yield fixedValue(number, decimals, noCommas);
  },
  *'FLOOR/1'(_input, number) {
    yield floorValue(number);
  },
  *'FLOOR/2'(_input, number, significance) {
    yield floorValue(number, significance);
  },
  *'FLOOR_MATH/1'(_input, number) {
    yield floorValue(number);
  },
  *'FLOOR_MATH/2'(_input, number, significance) {
    yield floorValue(number, significance);
  },
  *'HLOOKUP/3'(_input, lookupValueLike, table, rowIndex) {
    yield vlookupValue(lookupValueLike, transposeLookupTable(table), rowIndex);
  },
  *'HLOOKUP/4'(_input, lookupValueLike, table, rowIndex, rangeLookup) {
    yield vlookupValue(lookupValueLike, transposeLookupTable(table), rowIndex, rangeLookup);
  },
  *'INDEX/2'(_input, array, rowNum) {
    yield indexValue(array, rowNum);
  },
  *'INDEX/3'(_input, array, rowNum, columnNum) {
    yield indexValue(array, rowNum, columnNum);
  },
  *'_EXCEL_INDEX/2'(_input, array, rowNum) {
    yield indexValue(array, rowNum);
  },
  *'_EXCEL_INDEX/3'(_input, array, rowNum, columnNum) {
    yield indexValue(array, rowNum, columnNum);
  },
  *'INT/1'(_input, value) {
    yield Math.floor(parseExcelNumber(value));
  },
  *'ISBLANK/1'(_input, value) {
    yield value === null || value === undefined;
  },
  *'ISNUMBER/1'(_input, value) {
    yield typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);
  },
  *'ISTEXT/1'(_input, value) {
    yield typeof value === 'string';
  },
  *'LEFT/1'(_input, value) {
    yield parseExcelString(value).slice(0, 1);
  },
  *'LEFT/2'(_input, value, count) {
    yield parseExcelString(value).slice(0, parseExcelNumber(count));
  },
  *'LEN/1'(_input, value) {
    yield parseExcelString(value).length;
  },
  *'LN/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number <= 0) {
      throwExcelError(EXCEL_ERROR.num);
    }
    yield checkedMathResult(Math.log(number));
  },
  *'LOG/1'(_input, number) {
    yield logValue(number);
  },
  *'LOG/2'(_input, number, base) {
    yield logValue(number, base);
  },
  *'LOG10/1'(_input, number) {
    yield logValue(number, 10);
  },
  *'LOWER/1'(_input, value) {
    yield parseExcelString(value).toLowerCase();
  },
  *'LOOKUP/2'(_input, lookupValueLike, lookupArray) {
    yield lookupValue(lookupValueLike, lookupArray);
  },
  *'LOOKUP/3'(_input, lookupValueLike, lookupArray, resultArray) {
    yield lookupValue(lookupValueLike, lookupArray, resultArray);
  },
  *'LOOKUP_BY/4'(_input, rows, lookupKey, lookupValueLike, resultKey) {
    yield lookupByRows(rows, lookupKey, lookupValueLike, resultKey);
  },
  *'MATCH/2'(_input, lookupValue, lookupArray) {
    yield matchValue(lookupValue, lookupArray);
  },
  *'MATCH/3'(_input, lookupValue, lookupArray, matchType) {
    yield matchValue(lookupValue, lookupArray, matchType);
  },
  *'MAX/1'(_input, value) {
    yield maxExcelRange(value);
  },
  *'MID/3'(_input, value, start, count) {
    yield parseExcelString(value).substr(
      parseExcelNumber(start) - 1,
      parseExcelNumber(count),
    );
  },
  *'MIN/1'(_input, value) {
    yield minExcelRange(value);
  },
  *'MOD/2'(_input, left, right) {
    const divisor = parseExcelNumber(right);
    if (divisor === 0) {
      throwExcelError(EXCEL_ERROR.div0);
    }
    const dividend = parseExcelNumber(left);
    yield ((dividend % divisor) + divisor) % divisor;
  },
  *'MULTINOMIAL/1'(_input, values) {
    yield multinomialValue(values);
  },
  *'N/1'(_input, value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      yield value;
      return;
    }
    if (value === true) {
      yield 1;
      return;
    }
    if (value === false) {
      yield 0;
      return;
    }
    yield 0;
  },
  *'NOT/1'(_input, value) {
    if (typeof value === 'string') {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield !value;
  },
  *'NUMBERVALUE/1'(_input, text) {
    yield numberValue(text);
  },
  *'NUMBERVALUE/2'(_input, text, decimalSeparator) {
    yield numberValue(text, decimalSeparator);
  },
  *'NUMBERVALUE/3'(_input, text, decimalSeparator, groupSeparator) {
    yield numberValue(text, decimalSeparator, groupSeparator);
  },
  *'OR/1'(_input, value) {
    yield logicalAnyValue(value);
  },
  *'POWER/2'(_input, number, power) {
    yield Math.pow(parseExcelNumber(number), parseExcelNumber(power));
  },
  *'PRODUCT/1'(_input, value) {
    yield flattenExcelArgs(value)
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => parseExcelNumber(entry))
      .reduce((product, entry) => product * entry, 1);
  },
  *'PROPER/1'(_input, value) {
    yield properValue(value);
  },
  *'REPLACE/4'(_input, oldText, startNum, length, newText) {
    const text = parseExcelString(oldText);
    yield (
      text.slice(0, parseExcelNumber(startNum) - 1) +
      parseExcelString(newText) +
      text.slice(parseExcelNumber(startNum) - 1 + parseExcelNumber(length))
    );
  },
  *'REPT/2'(_input, text, count) {
    yield new Array(parseExcelNumber(count) + 1).join(parseExcelString(text));
  },
  *'RIGHT/1'(_input, value) {
    const text = parseExcelString(value);
    yield text.slice(text.length - 1);
  },
  *'RIGHT/2'(_input, value, count) {
    const text = parseExcelString(value);
    yield text.slice(text.length - parseExcelNumber(count));
  },
  *'ROMAN/1'(_input, number) {
    yield romanValue(number);
  },
  *'ROWS/1'(_input, value) {
    if (!Array.isArray(value)) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield value.length;
  },
  *'ROUND/1'(_input, value) {
    yield roundBase(value, 0, Math.round);
  },
  *'ROUND/2'(_input, value, digits) {
    yield roundBase(value, digits, Math.round);
  },
  *'ROUNDDOWN/1'(_input, value) {
    yield roundBase(value, 0, Math.floor);
  },
  *'ROUNDDOWN/2'(_input, value, digits) {
    yield roundBase(value, digits, Math.floor);
  },
  *'ROUNDUP/1'(_input, value) {
    yield roundBase(value, 0, Math.ceil);
  },
  *'ROUNDUP/2'(_input, value, digits) {
    yield roundBase(value, digits, Math.ceil);
  },
  *'SEARCH/2'(_input, findText, withinText) {
    const found = parseExcelString(withinText)
      .toLowerCase()
      .indexOf(parseExcelString(findText).toLowerCase());
    if (found === -1) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield found + 1;
  },
  *'SEARCH/3'(_input, findText, withinText, startNum) {
    const found = parseExcelString(withinText)
      .toLowerCase()
      .indexOf(
        parseExcelString(findText).toLowerCase(),
        parseExcelNumber(startNum) - 1,
      );
    if (found === -1) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield found + 1;
  },
  *'SEC/1'(_input, value) {
    yield checkedMathResult(1 / Math.cos(parseExcelNumber(value)));
  },
  *'SECH/1'(_input, value) {
    yield checkedMathResult(1 / Math.cosh(parseExcelNumber(value)));
  },
  *'SERIESSUM/4'(_input, x, n, m, coefficients) {
    yield seriesSumValue(x, n, m, coefficients);
  },
  *'SIN/1'(_input, value) {
    yield checkedMathResult(Math.sin(parseExcelNumber(value)));
  },
  *'SINH/1'(_input, value) {
    yield checkedMathResult(Math.sinh(parseExcelNumber(value)));
  },
  *'SQRT/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number < 0) {
      throwExcelError(EXCEL_ERROR.num);
    }
    yield Math.sqrt(number);
  },
  *'SQRTPI/1'(_input, value) {
    const number = parseExcelNumber(value);
    if (number < 0) {
      throwExcelError(EXCEL_ERROR.num);
    }
    yield checkedMathResult(Math.sqrt(number * Math.PI));
  },
  *'STDEV/1'(_input, value) {
    yield sampleStdDev(value);
  },
  *'STDEV_P/1'(_input, value) {
    yield populationStdDev(value);
  },
  *'STDEV_S/1'(_input, value) {
    yield sampleStdDev(value);
  },
  *'SUM/1'(_input, value) {
    yield sumExcelRange(value);
  },
  *'SUMIF/2'(_input, range, criteria) {
    yield sumIf(range, criteria);
  },
  *'SUMIF/3'(_input, range, criteria, sumRange) {
    yield sumIf(range, criteria, sumRange);
  },
  *'SUMIF_BY/4'(_input, rows, valueKey, criteriaKey, criteria) {
    yield sumIf(colValues(rows, criteriaKey), criteria, colValues(rows, valueKey));
  },
  *'SUMIFS_BY/3'(_input, rows, valueKey, criteriaObject) {
    const filteredRows = filterRowsByCriteria(rows, criteriaObject);
    yield sumExcelRange(colValues(filteredRows, valueKey));
  },
  *'SUBSTITUTE/3'(_input, text, oldText, newText) {
    yield parseExcelString(text)
      .split(parseExcelString(oldText))
      .join(parseExcelString(newText));
  },
  *'SUBSTITUTE/4'(_input, text, oldText, newText, instanceNum) {
    const instance = Math.floor(parseExcelNumber(instanceNum));
    if (instance <= 0) {
      throwExcelError(EXCEL_ERROR.value);
    }
    yield replaceNth(
      parseExcelString(text),
      parseExcelString(oldText),
      parseExcelString(newText),
      instance,
    );
  },
  *'T/1'(_input, value) {
    yield typeof value === 'string' ? value : '';
  },
  *'TAN/1'(_input, value) {
    yield checkedMathResult(Math.tan(parseExcelNumber(value)));
  },
  *'TANH/1'(_input, value) {
    yield Math.tanh(parseExcelNumber(value));
  },
  *'TEXT/2'(_input, value, formatText) {
    yield excelText(value, formatText);
  },
  *'TEXTJOIN/3'(_input, delimiter, ignoreEmpty, values) {
    yield textJoin(delimiter, ignoreEmpty, values);
  },
  *'TRIM/1'(_input, value) {
    yield parseExcelString(value).replace(/\s+/g, ' ').trim();
  },
  *'TRUNC/1'(_input, value) {
    yield truncValue(value);
  },
  *'TRUNC/2'(_input, value, digits) {
    yield truncValue(value, digits);
  },
  *'TRUE/0'() {
    yield true;
  },
  *'TYPE/1'(_input, value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      yield 1;
      return;
    }
    if (typeof value === 'string') {
      yield 2;
      return;
    }
    if (typeof value === 'boolean') {
      yield 4;
      return;
    }
    if (Array.isArray(value)) {
      yield 64;
      return;
    }
    yield 16;
  },
  *'UPPER/1'(_input, value) {
    yield parseExcelString(value).toUpperCase();
  },
  *'VALUE/1'(_input, value) {
    yield excelValue(value);
  },
  *'VLOOKUP/3'(_input, lookupValueLike, table, colIndex) {
    yield vlookupValue(lookupValueLike, table, colIndex);
  },
  *'VLOOKUP/4'(_input, lookupValueLike, table, colIndex, rangeLookup) {
    yield vlookupValue(lookupValueLike, table, colIndex, rangeLookup);
  },
  *'VLOOKUP_BY/4'(_input, rows, lookupKey, lookupValueLike, resultKey) {
    yield vlookupByRows(rows, lookupKey, lookupValueLike, resultKey, false);
  },
  *'VLOOKUP_BY/5'(_input, rows, lookupKey, lookupValueLike, resultKey, rangeLookup) {
    yield vlookupByRows(rows, lookupKey, lookupValueLike, resultKey, rangeLookup);
  },
  *'XLOOKUP/3'(_input, lookupValueLike, lookupArray, returnArray) {
    yield xlookupValue(lookupValueLike, lookupArray, returnArray);
  },
  *'XLOOKUP/4'(_input, lookupValueLike, lookupArray, returnArray, ifNotFound) {
    yield xlookupValue(lookupValueLike, lookupArray, returnArray, ifNotFound);
  },
  *'XLOOKUP/5'(_input, lookupValueLike, lookupArray, returnArray, ifNotFound, matchMode) {
    yield xlookupValue(lookupValueLike, lookupArray, returnArray, ifNotFound, matchMode);
  },
  *'XLOOKUP/6'(_input, lookupValueLike, lookupArray, returnArray, ifNotFound, matchMode, searchMode) {
    yield xlookupValue(
      lookupValueLike,
      lookupArray,
      returnArray,
      ifNotFound,
      matchMode,
      searchMode,
    );
  },
  *'XOR/1'(_input, value) {
    yield logicalXorValue(value);
  },
  *'CEILING/1'(_input, number) {
    yield ceilingValue(number);
  },
  *'CEILING/2'(_input, number, significance) {
    yield ceilingValue(number, significance);
  },
  *'CEILING_MATH/1'(_input, number) {
    yield ceilingValue(number);
  },
  *'CEILING_MATH/2'(_input, number, significance) {
    yield ceilingValue(number, significance);
  },

  // ═══════════════════════════════════════════════════════════════
  // Math and trig functions
  // ═══════════════════════════════════════════════════════════════

  *'PI/0'() {
    yield Math.PI;
  },
  *'SIGN/1'(_input, value) {
    const n = parseExcelNumber(value);
    yield n > 0 ? 1 : n < 0 ? -1 : 0;
  },
  *'EVEN/1'(_input, value) {
    const n = parseExcelNumber(value);
    const ceil = Math.ceil(Math.abs(n));
    const result = ceil % 2 === 0 ? ceil : ceil + 1;
    yield n >= 0 ? result : -result;
  },
  *'ODD/1'(_input, value) {
    const n = parseExcelNumber(value);
    const ceil = Math.ceil(Math.abs(n));
    const result = ceil % 2 === 1 ? ceil : ceil + 1;
    yield n >= 0 ? result : -result;
  },
  *'GCD/1'(_input, values) {
    const nums = flattenExcelArgs(values).map(parseExcelNumber).map(Math.abs).map(Math.floor);
    if (nums.length === 0) yield 0;
    else {
      const gcd2 = (a: number, b: number): number => (b === 0 ? a : gcd2(b, a % b));
      yield nums.reduce(gcd2);
    }
  },
  *'LCM/1'(_input, values) {
    const nums = flattenExcelArgs(values).map(parseExcelNumber).map(Math.abs).map(Math.floor);
    if (nums.length === 0) yield 0;
    else {
      const gcd2 = (a: number, b: number): number => (b === 0 ? a : gcd2(b, a % b));
      const lcm2 = (a: number, b: number) => (a * b) / gcd2(a, b);
      yield nums.reduce(lcm2);
    }
  },
  *'FACT/1'(_input, value) {
    const n = Math.floor(parseExcelNumber(value));
    if (n < 0) throwExcelError(EXCEL_ERROR.num);
    if (n === 0) { yield 1; return; }
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    yield result;
  },
  *'FACTDOUBLE/1'(_input, value) {
    const n = Math.floor(parseExcelNumber(value));
    if (n < -1) throwExcelError(EXCEL_ERROR.num);
    if (n <= 0) { yield 1; return; }
    let result = 1;
    for (let i = n; i > 1; i -= 2) result *= i;
    yield result;
  },
  *'COMBIN/2'(_input, n, k) {
    const nn = Math.floor(parseExcelNumber(n));
    const kk = Math.floor(parseExcelNumber(k));
    if (nn < 0 || kk < 0 || kk > nn) throwExcelError(EXCEL_ERROR.num);
    let result = 1;
    for (let i = 0; i < kk; i++) result = (result * (nn - i)) / (i + 1);
    yield Math.round(result);
  },
  *'COMBINA/2'(_input, n, k) {
    const nn = Math.floor(parseExcelNumber(n));
    const kk = Math.floor(parseExcelNumber(k));
    if (nn < 0 || kk < 0) throwExcelError(EXCEL_ERROR.num);
    // COMBINA(n, k) = COMBIN(n + k - 1, k)
    const total = nn + kk - 1;
    let result = 1;
    for (let i = 0; i < kk; i++) result = (result * (total - i)) / (i + 1);
    yield Math.round(result);
  },
  *'PERMUT/2'(_input, n, k) {
    const nn = Math.floor(parseExcelNumber(n));
    const kk = Math.floor(parseExcelNumber(k));
    if (nn < 0 || kk < 0 || kk > nn) throwExcelError(EXCEL_ERROR.num);
    let result = 1;
    for (let i = 0; i < kk; i++) result *= (nn - i);
    yield result;
  },
  *'RAND/0'() {
    yield Math.random();
  },
  *'RANDBETWEEN/2'(_input, bottom, top) {
    const lo = Math.ceil(parseExcelNumber(bottom));
    const hi = Math.floor(parseExcelNumber(top));
    if (lo > hi) throwExcelError(EXCEL_ERROR.num);
    yield Math.floor(Math.random() * (hi - lo + 1)) + lo;
  },
  *'MROUND/2'(_input, number, multiple) {
    const n = parseExcelNumber(number);
    const m = parseExcelNumber(multiple);
    if (m === 0) { yield 0; return; }
    if (n * m < 0) throwExcelError(EXCEL_ERROR.num);
    yield Math.round(n / m) * m;
  },
  *'QUOTIENT/2'(_input, numerator, denominator) {
    const n = parseExcelNumber(numerator);
    const d = parseExcelNumber(denominator);
    if (d === 0) throwExcelError(EXCEL_ERROR.div0);
    yield Math.trunc(n / d);
  },
  *'DEGREES/1'(_input, value) {
    yield parseExcelNumber(value) * (180 / Math.PI);
  },
  *'RADIANS/1'(_input, value) {
    yield parseExcelNumber(value) * (Math.PI / 180);
  },
  *'SUMPRODUCT/1'(_input, arrays) {
    // arrays should be array of arrays. Product element-wise then sum.
    if (!Array.isArray(arrays) || arrays.length === 0) { yield 0; return; }
    // If it's an array of arrays, multiply pairwise and sum
    if (Array.isArray(arrays[0])) {
      const len = (arrays[0] as unknown[]).length;
      let total = 0;
      for (let i = 0; i < len; i++) {
        let product = 1;
        for (const arr of arrays) {
          const val = Array.isArray(arr) ? arr[i] : 0;
          const num = typeof val === 'number' ? val : 0;
          product *= num;
        }
        total += product;
      }
      yield total;
    } else {
      // Single array: just sum
      yield sumExcelRange(arrays);
    }
  },
  *'SUMSQ/1'(_input, values) {
    const nums = flattenExcelArgs(values);
    let total = 0;
    for (const v of nums) {
      if (typeof v === 'number' && Number.isFinite(v)) total += v * v;
    }
    yield total;
  },
  *'SUMX2MY2/2'(_input, left, right) {
    yield sumPairValue(left, right, (leftValue, rightValue) =>
      leftValue ** 2 - rightValue ** 2,
    );
  },
  *'SUMX2PY2/2'(_input, left, right) {
    yield sumPairValue(left, right, (leftValue, rightValue) =>
      leftValue ** 2 + rightValue ** 2,
    );
  },
  *'SUMXMY2/2'(_input, left, right) {
    yield sumPairValue(left, right, (leftValue, rightValue) =>
      (leftValue - rightValue) ** 2,
    );
  },

  // ═══════════════════════════════════════════════════════════════
  // Logical functions
  // ═══════════════════════════════════════════════════════════════

  *'SWITCH/1'(_input, args) {
    // SWITCH(expr; val1; result1; val2; result2; ...; default)
    // In jqxl, called as SWITCH([expr, val1, result1, val2, result2, ...])
    if (!Array.isArray(args) || args.length < 3) throwExcelError(EXCEL_ERROR.value);
    const expr = args[0];
    for (let i = 1; i < args.length - 1; i += 2) {
      if (args[i] === expr) {
        yield args[i + 1];
        return;
      }
    }
    // Default: last element if odd number of args after expr
    if (args.length % 2 === 0) {
      yield args[args.length - 1];
    } else {
      throwExcelError(EXCEL_ERROR.na);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Information functions
  // ═══════════════════════════════════════════════════════════════

  *'ISEVEN/1'(_input, value) {
    const n = parseExcelNumber(value);
    yield Math.floor(n) % 2 === 0;
  },
  *'ISODD/1'(_input, value) {
    const n = parseExcelNumber(value);
    yield Math.floor(n) % 2 !== 0;
  },
  *'ISLOGICAL/1'(_input, value) {
    yield typeof value === 'boolean';
  },
  *'ISNONTEXT/1'(_input, value) {
    yield typeof value !== 'string';
  },

  // ═══════════════════════════════════════════════════════════════
  // Statistical functions
  // ═══════════════════════════════════════════════════════════════

  *'MEDIAN/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const mid = Math.floor(nums.length / 2);
    yield nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  },
  *'LARGE/2'(_input, values, k) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => b - a);
    const kk = Math.floor(parseExcelNumber(k));
    if (kk < 1 || kk > nums.length) throwExcelError(EXCEL_ERROR.num);
    yield nums[kk - 1];
  },
  *'SMALL/2'(_input, values, k) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const kk = Math.floor(parseExcelNumber(k));
    if (kk < 1 || kk > nums.length) throwExcelError(EXCEL_ERROR.num);
    yield nums[kk - 1];
  },
  *'COUNTBLANK/1'(_input, values) {
    const arr = Array.isArray(values) ? values : [values];
    yield arr.filter((v) => v === null || v === undefined || v === '').length;
  },
  *'VAR/1'(_input, values) {
    // VAR = sample variance (VAR.S)
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length < 2) throwExcelError(EXCEL_ERROR.div0);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sumSqDev = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    yield sumSqDev / (nums.length - 1);
  },
  *'VAR_P/1'(_input, values) {
    // VAR.P = population variance
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length === 0) throwExcelError(EXCEL_ERROR.div0);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sumSqDev = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    yield sumSqDev / nums.length;
  },
  *'VAR_S/1'(_input, values) {
    // alias for VAR (sample variance)
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length < 2) throwExcelError(EXCEL_ERROR.div0);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sumSqDev = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    yield sumSqDev / (nums.length - 1);
  },
  *'MAXIFS/1'(_input, args) {
    // MAXIFS([values, criteria_range, criteria, ...])
    // Simplified: MAXIFS_BY pattern preferred. This is array-based.
    if (!Array.isArray(args) || args.length < 3) throwExcelError(EXCEL_ERROR.value);
    const vals = Array.isArray(args[0]) ? args[0] : [args[0]];
    const criteriaRange = Array.isArray(args[1]) ? args[1] : [args[1]];
    const criteria = args[2];
    const matcher = createCriteriaMatcher(criteria);
    let max = -Infinity;
    let found = false;
    for (let i = 0; i < vals.length; i++) {
      if (matcher(criteriaRange[i] ?? null)) {
        const v = parseExcelNumber(vals[i]);
        if (v > max) { max = v; found = true; }
      }
    }
    yield found ? max : 0;
  },
  *'MINIFS/1'(_input, args) {
    if (!Array.isArray(args) || args.length < 3) throwExcelError(EXCEL_ERROR.value);
    const vals = Array.isArray(args[0]) ? args[0] : [args[0]];
    const criteriaRange = Array.isArray(args[1]) ? args[1] : [args[1]];
    const criteria = args[2];
    const matcher = createCriteriaMatcher(criteria);
    let min = Infinity;
    let found = false;
    for (let i = 0; i < vals.length; i++) {
      if (matcher(criteriaRange[i] ?? null)) {
        const v = parseExcelNumber(vals[i]);
        if (v < min) { min = v; found = true; }
      }
    }
    yield found ? min : 0;
  },
  *'CORREL/2'(_input, array1, array2) {
    const x = flattenExcelArgs(array1).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const y = flattenExcelArgs(array2).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = Math.min(x.length, y.length);
    if (n < 2) throwExcelError(EXCEL_ERROR.div0);
    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      sumXY += dx * dy;
      sumX2 += dx * dx;
      sumY2 += dy * dy;
    }
    const denom = Math.sqrt(sumX2 * sumY2);
    if (denom === 0) throwExcelError(EXCEL_ERROR.div0);
    yield sumXY / denom;
  },
  *'SLOPE/2'(_input, knownY, knownX) {
    const y = flattenExcelArgs(knownY).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const x = flattenExcelArgs(knownX).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = Math.min(x.length, y.length);
    if (n < 2) throwExcelError(EXCEL_ERROR.div0);
    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumXY += (x[i] - meanX) * (y[i] - meanY);
      sumX2 += (x[i] - meanX) ** 2;
    }
    if (sumX2 === 0) throwExcelError(EXCEL_ERROR.div0);
    yield sumXY / sumX2;
  },
  *'INTERCEPT/2'(_input, knownY, knownX) {
    const y = flattenExcelArgs(knownY).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const x = flattenExcelArgs(knownX).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = Math.min(x.length, y.length);
    if (n < 2) throwExcelError(EXCEL_ERROR.div0);
    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumXY += (x[i] - meanX) * (y[i] - meanY);
      sumX2 += (x[i] - meanX) ** 2;
    }
    if (sumX2 === 0) throwExcelError(EXCEL_ERROR.div0);
    yield meanY - (sumXY / sumX2) * meanX;
  },
  *'FORECAST/3'(_input, x, knownY, knownX) {
    const xVal = parseExcelNumber(x);
    const yArr = flattenExcelArgs(knownY).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const xArr = flattenExcelArgs(knownX).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = Math.min(xArr.length, yArr.length);
    if (n < 2) throwExcelError(EXCEL_ERROR.div0);
    const meanX = xArr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = yArr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumXY += (xArr[i] - meanX) * (yArr[i] - meanY);
      sumX2 += (xArr[i] - meanX) ** 2;
    }
    if (sumX2 === 0) throwExcelError(EXCEL_ERROR.div0);
    const slope = sumXY / sumX2;
    const intercept = meanY - slope * meanX;
    yield intercept + slope * xVal;
  },
  *'RANK_EQ/2'(_input, number, ref) {
    const n = parseExcelNumber(number);
    const nums = flattenExcelArgs(ref).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const sorted = [...nums].sort((a, b) => b - a); // descending by default
    const idx = sorted.indexOf(n);
    if (idx === -1) throwExcelError(EXCEL_ERROR.na);
    yield idx + 1;
  },
  *'RANK_EQ/3'(_input, number, ref, order) {
    const n = parseExcelNumber(number);
    const nums = flattenExcelArgs(ref).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const asc = parseExcelNumber(order) !== 0;
    const sorted = asc ? [...nums].sort((a, b) => a - b) : [...nums].sort((a, b) => b - a);
    const idx = sorted.indexOf(n);
    if (idx === -1) throwExcelError(EXCEL_ERROR.na);
    yield idx + 1;
  },
  *'RANK_AVG/2'(_input, number, ref) {
    const n = parseExcelNumber(number);
    const nums = flattenExcelArgs(ref).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const sorted = [...nums].sort((a, b) => b - a);
    const indices = sorted.reduce<number[]>((acc, v, i) => { if (v === n) acc.push(i + 1); return acc; }, []);
    if (indices.length === 0) throwExcelError(EXCEL_ERROR.na);
    yield indices.reduce((a, b) => a + b, 0) / indices.length;
  },
  *'PERCENTILE_INC/2'(_input, values, k) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const kk = parseExcelNumber(k);
    if (kk < 0 || kk > 1 || nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const n = nums.length;
    const rank = kk * (n - 1);
    const intPart = Math.floor(rank);
    const frac = rank - intPart;
    if (intPart + 1 < n) {
      yield nums[intPart] + frac * (nums[intPart + 1] - nums[intPart]);
    } else {
      yield nums[intPart];
    }
  },
  *'QUARTILE_INC/2'(_input, values, quart) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const q = Math.floor(parseExcelNumber(quart));
    if (q < 0 || q > 4 || nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const kk = q * 0.25;
    const n = nums.length;
    const rank = kk * (n - 1);
    const intPart = Math.floor(rank);
    const frac = rank - intPart;
    if (intPart + 1 < n) {
      yield nums[intPart] + frac * (nums[intPart + 1] - nums[intPart]);
    } else {
      yield nums[intPart];
    }
  },
  *'AVEDEV/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    yield nums.reduce((acc, v) => acc + Math.abs(v - mean), 0) / nums.length;
  },
  *'DEVSQ/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    yield nums.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  },
  *'GEOMEAN/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const logSum = nums.reduce((acc, v) => acc + Math.log(v), 0);
    yield Math.exp(logSum / nums.length);
  },
  *'HARMEAN/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const recipSum = nums.reduce((acc, v) => acc + 1 / v, 0);
    yield nums.length / recipSum;
  },
  *'TRIMMEAN/2'(_input, values, percent) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const pct = parseExcelNumber(percent);
    if (pct < 0 || pct >= 1 || nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const trim = Math.floor(nums.length * pct / 2);
    const trimmed = nums.slice(trim, nums.length - trim);
    if (trimmed.length === 0) throwExcelError(EXCEL_ERROR.num);
    yield trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  },
  *'SKEW/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = nums.length;
    if (n < 3) throwExcelError(EXCEL_ERROR.div0);
    const mean = nums.reduce((a, b) => a + b, 0) / n;
    const s = Math.sqrt(nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1));
    if (s === 0) throwExcelError(EXCEL_ERROR.div0);
    const sum3 = nums.reduce((acc, v) => acc + ((v - mean) / s) ** 3, 0);
    yield (n / ((n - 1) * (n - 2))) * sum3;
  },
  *'KURT/1'(_input, values) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = nums.length;
    if (n < 4) throwExcelError(EXCEL_ERROR.div0);
    const mean = nums.reduce((a, b) => a + b, 0) / n;
    const s = Math.sqrt(nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1));
    if (s === 0) throwExcelError(EXCEL_ERROR.div0);
    const sum4 = nums.reduce((acc, v) => acc + ((v - mean) / s) ** 4, 0);
    const coeff = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
    const adj = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    yield coeff * sum4 - adj;
  },

  // ═══════════════════════════════════════════════════════════════
  // Date/time functions
  // ═══════════════════════════════════════════════════════════════

  *'DAYS/2'(_input, endDate, startDate) {
    const end = parseExcelNumber(endDate);
    const start = parseExcelNumber(startDate);
    yield end - start;
  },
  *'TODAY/0'() {
    // Returns Excel date serial for today
    const now = new Date();
    const epoch = new Date(1899, 11, 30);
    yield Math.floor((now.getTime() - epoch.getTime()) / 86400000);
  },
  *'NOW/0'() {
    yield nowSerial();
  },
  *'HOUR/1'(_input, value) {
    const n = parseExcelNumber(value);
    const frac = n - Math.floor(n);
    yield Math.floor(frac * 24) % 24;
  },
  *'MINUTE/1'(_input, value) {
    const n = parseExcelNumber(value);
    const frac = n - Math.floor(n);
    yield Math.floor(frac * 24 * 60) % 60;
  },
  *'SECOND/1'(_input, value) {
    const n = parseExcelNumber(value);
    const frac = n - Math.floor(n);
    yield Math.floor(frac * 24 * 60 * 60) % 60;
  },
  *'WEEKDAY/1'(_input, serialDate) {
    // Default type 1: Sunday=1 .. Saturday=7
    const serial = Math.floor(parseExcelNumber(serialDate));
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    yield date.getDay() + 1;
  },
  *'WEEKDAY/2'(_input, serialDate, returnType) {
    const serial = Math.floor(parseExcelNumber(serialDate));
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    const type = Math.floor(parseExcelNumber(returnType));
    const dow = date.getDay(); // 0=Sun
    if (type === 1) yield dow + 1;
    else if (type === 2) yield dow === 0 ? 7 : dow;
    else if (type === 3) yield dow === 0 ? 6 : dow - 1;
    else yield dow + 1;
  },
  *'ISOWEEKNUM/1'(_input, serialDate) {
    const serial = Math.floor(parseExcelNumber(serialDate));
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
    const dow = date.getDay() || 7; // Mon=1..Sun=7
    const woy = Math.floor((dayOfYear - dow + 10) / 7);
    yield woy;
  },
  *'EDATE/2'(_input, startDate, months) {
    const serial = Math.floor(parseExcelNumber(startDate));
    const m = Math.floor(parseExcelNumber(months));
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    date.setMonth(date.getMonth() + m);
    yield Math.floor((date.getTime() - epoch.getTime()) / 86400000);
  },
  *'EOMONTH/2'(_input, startDate, months) {
    const serial = Math.floor(parseExcelNumber(startDate));
    const m = Math.floor(parseExcelNumber(months));
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    date.setMonth(date.getMonth() + m + 1, 0); // last day of target month
    yield Math.floor((date.getTime() - epoch.getTime()) / 86400000);
  },

  // ═══════════════════════════════════════════════════════════════
  // Additional date/time functions
  // ═══════════════════════════════════════════════════════════════

  *'TIME/3'(_input, hour, minute, second) {
    const h = parseExcelNumber(hour);
    const m = parseExcelNumber(minute);
    const s = parseExcelNumber(second);
    yield (h * 3600 + m * 60 + s) / 86400;
  },
  *'TIMEVALUE/1'(_input, text) {
    const str = String(text);
    const match = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) throwExcelError(EXCEL_ERROR.value);
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const s = match[3] ? parseInt(match[3], 10) : 0;
    yield (h * 3600 + m * 60 + s) / 86400;
  },

  // ═══════════════════════════════════════════════════════════════
  // Additional statistical functions
  // ═══════════════════════════════════════════════════════════════

  *'PERCENTILE_EXC/2'(_input, values, k) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const kk = parseExcelNumber(k);
    const n = nums.length;
    if (kk <= 1 / (n + 1) || kk >= n / (n + 1) || n === 0) throwExcelError(EXCEL_ERROR.num);
    const rank = kk * (n + 1) - 1;
    const intPart = Math.floor(rank);
    const frac = rank - intPart;
    if (intPart + 1 < n) {
      yield nums[intPart] + frac * (nums[intPart + 1] - nums[intPart]);
    } else {
      yield nums[intPart];
    }
  },
  *'QUARTILE_EXC/2'(_input, values, quart) {
    const nums = flattenExcelArgs(values)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const q = Math.floor(parseExcelNumber(quart));
    if (q < 1 || q > 3 || nums.length === 0) throwExcelError(EXCEL_ERROR.num);
    const kk = q * 0.25;
    const n = nums.length;
    const rank = kk * (n + 1) - 1;
    const intPart = Math.floor(rank);
    const frac = rank - intPart;
    if (intPart >= 0 && intPart + 1 < n) {
      yield nums[intPart] + frac * (nums[intPart + 1] - nums[intPart]);
    } else if (intPart >= 0 && intPart < n) {
      yield nums[intPart];
    } else {
      throwExcelError(EXCEL_ERROR.num);
    }
  },
  *'PERCENTRANK_INC/2'(_input, array, x) {
    const nums = flattenExcelArgs(array)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const xVal = parseExcelNumber(x);
    const n = nums.length;
    if (n === 0 || xVal < nums[0] || xVal > nums[n - 1]) throwExcelError(EXCEL_ERROR.na);
    if (n === 1) { yield 0; return; }
    for (let i = 0; i < n; i++) {
      if (nums[i] === xVal) { yield i / (n - 1); return; }
      if (i + 1 < n && nums[i] < xVal && xVal < nums[i + 1]) {
        yield (i + (xVal - nums[i]) / (nums[i + 1] - nums[i])) / (n - 1);
        return;
      }
    }
    yield 0;
  },
  *'PERCENTRANK_EXC/2'(_input, array, x) {
    const nums = flattenExcelArgs(array)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    const xVal = parseExcelNumber(x);
    const n = nums.length;
    if (n === 0 || xVal < nums[0] || xVal > nums[n - 1]) throwExcelError(EXCEL_ERROR.na);
    for (let i = 0; i < n; i++) {
      if (nums[i] === xVal) { yield (i + 1) / (n + 1); return; }
      if (i + 1 < n && nums[i] < xVal && xVal < nums[i + 1]) {
        yield (i + 1 + (xVal - nums[i]) / (nums[i + 1] - nums[i])) / (n + 1);
        return;
      }
    }
    yield 0;
  },
  *'PEARSON/2'(_input, array1, array2) {
    // PEARSON is identical to CORREL
    const x = flattenExcelArgs(array1).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const y = flattenExcelArgs(array2).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const n = Math.min(x.length, y.length);
    if (n < 2) throwExcelError(EXCEL_ERROR.div0);
    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      sumXY += dx * dy;
      sumX2 += dx * dx;
      sumY2 += dy * dy;
    }
    const denom = Math.sqrt(sumX2 * sumY2);
    if (denom === 0) throwExcelError(EXCEL_ERROR.div0);
    yield sumXY / denom;
  },
  *'UNICODE/1'(_input, text) {
    const str = parseExcelString(text);
    if (str.length === 0) throwExcelError(EXCEL_ERROR.value);
    yield str.codePointAt(0)!;
  },
};

// Date filters live in their own file (formula-dateSerial-native.ts) but
// merge into the eager `formula` library — DATE/YEAR/NETWORKDAYS et al
// are common enough that lazy-loading the 3 KB chunk would cost more in
// first-call latency than the bytes save.
import { formulaDateSerialNativeFilters } from './formula-dateSerial-native.js';

export const formulaContribNativeFilters = {
  ...wrapBareNativeFilters(bareNativeFilters),
  ...formulaDateSerialNativeFilters,
};
