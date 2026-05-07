export const FORMULA_FINANCIAL_FUNCTIONS = [
  'ACCRINT',
  'COUPDAYS',
  'CUMIPMT',
  'CUMPRINC',
  'DB',
  'DDB',
  'DISC',
  'DOLLARDE',
  'DOLLARFR',
  'EFFECT',
  'FV',
  'FVSCHEDULE',
  'IPMT',
  'IRR',
  'IRR_BY',
  'ISPMT',
  'MIRR',
  'NOMINAL',
  'NPER',
  'NPV',
  'NPV_BY',
  'PDURATION',
  'PMT',
  'PPMT',
  'PRICEDISC',
  'PV',
  'RATE',
  'RRI',
  'SLN',
  'SYD',
  'TBILLEQ',
  'TBILLPRICE',
  'TBILLYIELD',
  'XIRR',
  'XIRR_BY',
  'XNPV',
  'XNPV_BY',
] as const;

export const FORMULA_FINANCIAL_FILTERS = new Set([
  'ACCRINT/6',
  'ACCRINT/7',
  'COUPDAYS/3',
  'COUPDAYS/4',
  'CUMIPMT/6',
  'CUMPRINC/6',
  'DB/4',
  'DB/5',
  'DDB/4',
  'DDB/5',
  'DISC/4',
  'DISC/5',
  'DOLLARDE/2',
  'DOLLARFR/2',
  'EFFECT/2',
  'FV/3',
  'FV/4',
  'FV/5',
  'FVSCHEDULE/2',
  'IPMT/4',
  'IPMT/5',
  'IPMT/6',
  'IRR/1',
  'IRR/2',
  'IRR_BY/2',
  'IRR_BY/3',
  'ISPMT/4',
  'MIRR/3',
  'NOMINAL/2',
  'NPER/3',
  'NPER/4',
  'NPER/5',
  'NPV/2',
  'NPV_BY/3',
  'PDURATION/3',
  'PMT/3',
  'PMT/4',
  'PMT/5',
  'PPMT/4',
  'PPMT/5',
  'PPMT/6',
  'PRICEDISC/4',
  'PRICEDISC/5',
  'PV/3',
  'PV/4',
  'PV/5',
  'RATE/3',
  'RATE/4',
  'RATE/5',
  'RATE/6',
  'RRI/3',
  'SLN/3',
  'SYD/4',
  'TBILLEQ/3',
  'TBILLPRICE/3',
  'TBILLYIELD/3',
  'XIRR/2',
  'XIRR/3',
  'XIRR_BY/3',
  'XIRR_BY/4',
  'XNPV/3',
  'XNPV_BY/4',
]);

const NAME_SET = new Set(FORMULA_FINANCIAL_FUNCTIONS);

function isIdentifierChar(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}

function isCallAfter(source: string, index: number) {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? '')) {
    cursor++;
  }
  return source[cursor] === '(';
}

export function sourceUsesFinancialFormula(source: string): boolean {
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '#') {
      inComment = true;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (isIdentifierChar(source[index - 1])) {
      continue;
    }
    const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) {
      continue;
    }
    const name = match[0].toUpperCase();
    if (
      NAME_SET.has(name as (typeof FORMULA_FINANCIAL_FUNCTIONS)[number]) &&
      !isIdentifierChar(source[index + match[0].length]) &&
      isCallAfter(source, index + match[0].length)
    ) {
      return true;
    }
    index += match[0].length - 1;
  }
  return false;
}
