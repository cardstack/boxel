export const FORMULA_STATISTICAL_FUNCTIONS = [
  'BETA_DIST',
  'BETA_INV',
  'BINOM_DIST',
  'BINOM_DIST_RANGE',
  'BINOM_INV',
  'CHISQ_DIST',
  'CHISQ_DIST_RT',
  'CHISQ_INV',
  'CHISQ_INV_RT',
  'CHISQ_TEST',
  'CONFIDENCE_NORM',
  'CONFIDENCE_T',
  'EXPON_DIST',
  'F_DIST',
  'F_DIST_RT',
  'F_INV',
  'F_INV_RT',
  'F_TEST',
  'GAMMA',
  'GAMMA_DIST',
  'GAMMA_INV',
  'GAMMALN',
  'GAMMALN_PRECISE',
  'GAUSS',
  'HYPGEOM_DIST',
  'LOGNORM_DIST',
  'LOGNORM_INV',
  'NEGBINOM_DIST',
  'NORM_DIST',
  'NORM_INV',
  'NORM_S_DIST',
  'NORM_S_INV',
  'PHI',
  'POISSON_DIST',
  'STANDARDIZE',
  'T_DIST',
  'T_DIST_2T',
  'T_DIST_RT',
  'T_INV',
  'T_INV_2T',
  'T_TEST',
  'WEIBULL_DIST',
  'Z_TEST',
] as const;

export const FORMULA_STATISTICAL_FILTERS = new Set([
  'BETA_DIST/4',
  'BETA_DIST/5',
  'BETA_DIST/6',
  'BETA_INV/3',
  'BETA_INV/4',
  'BETA_INV/5',
  'BINOM_DIST/4',
  'BINOM_DIST_RANGE/3',
  'BINOM_DIST_RANGE/4',
  'BINOM_INV/3',
  'CHISQ_DIST/3',
  'CHISQ_DIST_RT/2',
  'CHISQ_INV/2',
  'CHISQ_INV_RT/2',
  'CHISQ_TEST/2',
  'CONFIDENCE_NORM/3',
  'CONFIDENCE_T/3',
  'EXPON_DIST/3',
  'F_DIST/4',
  'F_DIST_RT/3',
  'F_INV/3',
  'F_INV_RT/3',
  'F_TEST/2',
  'GAMMA/1',
  'GAMMA_DIST/4',
  'GAMMA_INV/3',
  'GAMMALN/1',
  'GAMMALN_PRECISE/1',
  'GAUSS/1',
  'HYPGEOM_DIST/5',
  'LOGNORM_DIST/4',
  'LOGNORM_INV/3',
  'NEGBINOM_DIST/4',
  'NORM_DIST/4',
  'NORM_INV/3',
  'NORM_S_DIST/2',
  'NORM_S_INV/1',
  'PHI/1',
  'POISSON_DIST/3',
  'STANDARDIZE/3',
  'T_DIST/3',
  'T_DIST_2T/2',
  'T_DIST_RT/2',
  'T_INV/2',
  'T_INV_2T/2',
  'T_TEST/2',
  'WEIBULL_DIST/4',
  'Z_TEST/2',
  'Z_TEST/3',
]);

export const FORMULA_STATISTICAL_DOTTED_ALIASES = new Map([
  ['BETA.DIST', 'BETA_DIST'],
  ['BETA.INV', 'BETA_INV'],
  ['BINOM.DIST.RANGE', 'BINOM_DIST_RANGE'],
  ['BINOM.DIST', 'BINOM_DIST'],
  ['BINOM.INV', 'BINOM_INV'],
  ['CHISQ.DIST.RT', 'CHISQ_DIST_RT'],
  ['CHISQ.DIST', 'CHISQ_DIST'],
  ['CHISQ.INV.RT', 'CHISQ_INV_RT'],
  ['CHISQ.INV', 'CHISQ_INV'],
  ['CHISQ.TEST', 'CHISQ_TEST'],
  ['CONFIDENCE.NORM', 'CONFIDENCE_NORM'],
  ['CONFIDENCE.T', 'CONFIDENCE_T'],
  ['EXPON.DIST', 'EXPON_DIST'],
  ['F.DIST.RT', 'F_DIST_RT'],
  ['F.DIST', 'F_DIST'],
  ['F.INV.RT', 'F_INV_RT'],
  ['F.INV', 'F_INV'],
  ['F.TEST', 'F_TEST'],
  ['GAMMA.DIST', 'GAMMA_DIST'],
  ['GAMMA.INV', 'GAMMA_INV'],
  ['GAMMALN.PRECISE', 'GAMMALN_PRECISE'],
  ['HYPGEOM.DIST', 'HYPGEOM_DIST'],
  ['LOGNORM.DIST', 'LOGNORM_DIST'],
  ['LOGNORM.INV', 'LOGNORM_INV'],
  ['NEGBINOM.DIST', 'NEGBINOM_DIST'],
  ['NORM.S.DIST', 'NORM_S_DIST'],
  ['NORM.S.INV', 'NORM_S_INV'],
  ['NORM.DIST', 'NORM_DIST'],
  ['NORM.INV', 'NORM_INV'],
  ['POISSON.DIST', 'POISSON_DIST'],
  ['T.DIST.2T', 'T_DIST_2T'],
  ['T.DIST.RT', 'T_DIST_RT'],
  ['T.DIST', 'T_DIST'],
  ['T.INV.2T', 'T_INV_2T'],
  ['T.INV', 'T_INV'],
  ['T.TEST', 'T_TEST'],
  ['WEIBULL.DIST', 'WEIBULL_DIST'],
  ['Z.TEST', 'Z_TEST'],
]);

const DOTTED_ALIASES_DESC = [...FORMULA_STATISTICAL_DOTTED_ALIASES.entries()]
  .sort((left, right) => right[0].length - left[0].length);

const STATISTICAL_NAME_SET = new Set(FORMULA_STATISTICAL_FUNCTIONS);

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

function scanFormulaSource(
  source: string,
  visitor: (entry: { start: number; end: number; replacement?: string }) => void,
) {
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;

    if (inComment) {
      if (char === '\n') {
        inComment = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
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

    for (const [dotted, replacement] of DOTTED_ALIASES_DESC) {
      const candidate = source.slice(index, index + dotted.length);
      if (
        candidate.toUpperCase() === dotted &&
        !isIdentifierChar(source[index + dotted.length]) &&
        isCallAfter(source, index + dotted.length)
      ) {
        visitor({ start: index, end: index + dotted.length, replacement });
        index += dotted.length - 1;
        break;
      }
    }
  }
}

export function rewriteStatisticalDottedFormulaNames(source: string): {
  source: string;
  changed: boolean;
} {
  const edits: { start: number; end: number; replacement: string }[] = [];
  scanFormulaSource(source, (entry) => {
    if (entry.replacement) {
      edits.push({
        start: entry.start,
        end: entry.end,
        replacement: entry.replacement,
      });
    }
  });

  if (edits.length === 0) {
    return { source, changed: false };
  }

  let output = '';
  let cursor = 0;
  for (const edit of edits) {
    output += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  output += source.slice(cursor);
  return { source: output, changed: true };
}

export function sourceUsesStatisticalFormula(source: string): boolean {
  let found = false;
  scanFormulaSource(source, () => {
    found = true;
  });
  if (found) {
    return true;
  }

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
      STATISTICAL_NAME_SET.has(name as (typeof FORMULA_STATISTICAL_FUNCTIONS)[number]) &&
      !isIdentifierChar(source[index + match[0].length]) &&
      isCallAfter(source, index + match[0].length)
    ) {
      return true;
    }
    index += match[0].length - 1;
  }
  return false;
}
