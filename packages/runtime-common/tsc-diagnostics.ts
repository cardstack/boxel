/**
 * Parse the located `error TSxxxx` diagnostics out of a tsc / ember-tsc run's
 * text output, for the parse gates `boxel parse` and the software factory both
 * run. Each gate decides which diagnostics to keep; how the output is read
 * lives here once, so both report the same message for the same error.
 *
 * tsc elaborates many diagnostics as indented continuation lines under the
 * error line ("The types of 'a.b' are incompatible between these types.",
 * "Type 'string' is not assignable to type 'number'."). Those name the actual
 * incompatibility, so they are kept with the diagnostic they belong to rather
 * than dropped. A non-indented line that is not a diagnostic — an unlocated
 * error, or a program-file path under `--explainFiles` — ends the elaboration,
 * so the indented lines that follow it never attach to an unrelated error.
 *
 * Kept free of `node:` imports and of any reach into `@cardstack/base/*`, so a
 * dependency-light consumer can import it.
 */

export interface TscDiagnostic {
  /** The path as tsc printed it, usually relative to its working directory. */
  file: string;
  line: number;
  column: number;
  /** e.g. `TS2322` */
  code: string;
  /** The headline: the text after `error TSxxxx:` on the diagnostic's line. */
  message: string;
  /** Indented continuation lines, in order, with their indentation kept. */
  elaboration: string[];
}

const DIAGNOSTIC_LINE = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/;
const INDENTED_LINE = /^\s+\S/;
const NON_INDENTED_LINE = /^\S/;

export function parseTscDiagnostics(output: string): TscDiagnostic[] {
  let diagnostics: TscDiagnostic[] = [];
  let current: TscDiagnostic | null = null;

  for (let line of output.split(/\r?\n/)) {
    let match = line.match(DIAGNOSTIC_LINE);
    if (match) {
      let [, file, lineStr, colStr, code, message] = match;
      current = {
        file,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        code,
        message,
        elaboration: [],
      };
      diagnostics.push(current);
    } else if (current && INDENTED_LINE.test(line)) {
      current.elaboration.push(line.trimEnd());
    } else if (NON_INDENTED_LINE.test(line)) {
      current = null;
    }
  }

  return diagnostics;
}

/** The headline followed by its elaboration, one line each. */
export function diagnosticText(diagnostic: TscDiagnostic): string {
  return [diagnostic.message, ...diagnostic.elaboration].join('\n');
}
