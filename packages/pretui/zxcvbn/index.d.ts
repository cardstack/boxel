// Hand-written types for the vendored bundle in this directory. They exist so
// that `import('./zxcvbn/index.js')` type-resolves under `boxel parse` instead
// of joining the "Cannot find module" baseline noise. Keep in sync with
// lean.ts as recorded in README.md.

/** A password estimate reduced to values that contain no part of the password. */
export interface PasswordEstimate {
  /** zxcvbn score, 0 (too guessable) … 4 (very unguessable) */
  score: 0 | 1 | 2 | 3 | 4;
  /** zxcvbn's single headline warning, '' when it has none */
  warning: string;
  /** zxcvbn's actionable suggestions, possibly empty */
  suggestions: string[];
  /** log10 of the estimated guess count */
  guessesLog10: number;
  /** humanised crack time under a slow salted hash at 1e4 guesses/second */
  crackTime: string;
}

/**
 * Estimate the strength of `password`, optionally told what the user's own
 * name / email / handle are so that "chris1985" does not read as strong.
 * Runs entirely locally; makes no network request of any kind.
 */
export declare function estimate(
  password: string,
  userInputs?: (string | number)[],
): PasswordEstimate;
