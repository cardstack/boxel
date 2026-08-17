export const FORMULA_BESSEL_FUNCTIONS = [
  'BESSELI',
  'BESSELJ',
  'BESSELK',
  'BESSELY',
] as const;

export const FORMULA_BESSEL_FILTERS = new Set([
  'BESSELI/2',
  'BESSELJ/2',
  'BESSELK/2',
  'BESSELY/2',
]);

const BESSEL_NAME_SET = new Set(FORMULA_BESSEL_FUNCTIONS);

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

export function sourceUsesBesselFormula(source: string): boolean {
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
      BESSEL_NAME_SET.has(name as (typeof FORMULA_BESSEL_FUNCTIONS)[number]) &&
      !isIdentifierChar(source[index + match[0].length]) &&
      isCallAfter(source, index + match[0].length)
    ) {
      return true;
    }
    index += match[0].length - 1;
  }
  return false;
}
