export const FORMULA_ENGINEERING_FUNCTIONS = [
  'BASE',
  'BIN2DEC',
  'BIN2HEX',
  'BIN2OCT',
  'BITAND',
  'BITLSHIFT',
  'BITOR',
  'BITRSHIFT',
  'BITXOR',
  'COMPLEX',
  'CONVERT',
  'DEC2BIN',
  'DEC2HEX',
  'DEC2OCT',
  'DECIMAL',
  'DELTA',
  'ERF',
  'ERFC',
  'GESTEP',
  'HEX2BIN',
  'HEX2DEC',
  'HEX2OCT',
  'IMABS',
  'IMAGINARY',
  'IMARGUMENT',
  'IMCONJUGATE',
  'IMCOS',
  'IMCOSH',
  'IMCOT',
  'IMCSC',
  'IMCSCH',
  'IMDIV',
  'IMEXP',
  'IMLN',
  'IMLOG10',
  'IMLOG2',
  'IMPOWER',
  'IMPRODUCT',
  'IMREAL',
  'IMSEC',
  'IMSECH',
  'IMSIN',
  'IMSINH',
  'IMSQRT',
  'IMSUB',
  'IMSUM',
  'IMTAN',
  'OCT2BIN',
  'OCT2DEC',
  'OCT2HEX',
  'UNICHAR',
] as const;

export const FORMULA_ENGINEERING_FILTERS = new Set([
  'BASE/2',
  'BASE/3',
  'BIN2DEC/1',
  'BIN2HEX/1',
  'BIN2HEX/2',
  'BIN2OCT/1',
  'BIN2OCT/2',
  'BITAND/2',
  'BITLSHIFT/2',
  'BITOR/2',
  'BITRSHIFT/2',
  'BITXOR/2',
  'COMPLEX/2',
  'COMPLEX/3',
  'CONVERT/3',
  'DEC2BIN/1',
  'DEC2BIN/2',
  'DEC2HEX/1',
  'DEC2HEX/2',
  'DEC2OCT/1',
  'DEC2OCT/2',
  'DECIMAL/2',
  'DELTA/1',
  'DELTA/2',
  'ERF/1',
  'ERF/2',
  'ERFC/1',
  'GESTEP/1',
  'GESTEP/2',
  'HEX2BIN/1',
  'HEX2BIN/2',
  'HEX2DEC/1',
  'HEX2OCT/1',
  'HEX2OCT/2',
  'IMABS/1',
  'IMAGINARY/1',
  'IMARGUMENT/1',
  'IMCONJUGATE/1',
  'IMCOS/1',
  'IMCOSH/1',
  'IMCOT/1',
  'IMCSC/1',
  'IMCSCH/1',
  'IMDIV/2',
  'IMEXP/1',
  'IMLN/1',
  'IMLOG10/1',
  'IMLOG2/1',
  'IMPOWER/2',
  'IMPRODUCT/1',
  'IMREAL/1',
  'IMSEC/1',
  'IMSECH/1',
  'IMSIN/1',
  'IMSINH/1',
  'IMSQRT/1',
  'IMSUB/2',
  'IMSUM/1',
  'IMSUM/2',
  'IMSUM/3',
  'IMTAN/1',
  'OCT2BIN/1',
  'OCT2BIN/2',
  'OCT2DEC/1',
  'OCT2HEX/1',
  'OCT2HEX/2',
  'UNICHAR/1',
]);

const NAME_SET = new Set(FORMULA_ENGINEERING_FUNCTIONS);

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

export function sourceUsesEngineeringFormula(source: string): boolean {
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
      NAME_SET.has(name as (typeof FORMULA_ENGINEERING_FUNCTIONS)[number]) &&
      !isIdentifierChar(source[index + match[0].length]) &&
      isCallAfter(source, index + match[0].length)
    ) {
      return true;
    }
    index += match[0].length - 1;
  }
  return false;
}
