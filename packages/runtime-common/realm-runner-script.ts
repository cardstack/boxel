// How a run-realm-code script is wrapped before it is evaluated, and how an
// error from the script is described to the model. The host's realm-runner
// worker runs the script; ai-bot parses it first, to catch a script that
// can't parse before the call reaches the host. Both describe the error the
// same way, so the model reads the same message from either.

// The script runs inside `(async () => {\n … \n})()`, so its first line is
// line 2 of what is evaluated.
export function wrapRealmRunnerScript(code: string): string {
  return `(async () => {\n${code}\n})()`;
}

export const REALM_RUNNER_SCRIPT_FILE_NAME = 'realm-code.js';

// The wrapper adds one line above the script, so the script's line N is line
// N + 1 of what QuickJS evaluates.
export const REALM_RUNNER_WRAPPER_LINES = 1;

// Turns an error from the script itself into a message the model can act on:
// the error, the line of its own script it points at with the lines around
// it, and, for the error that comes up most, what usually causes it. Errors
// from realm calls and the time-limit interrupt keep their own message.
// `lineNumber` is the line in the wrapped script.
export function describeScriptError(dumped: unknown, code: string): string {
  let error = (dumped ?? {}) as {
    name?: string;
    message?: string;
    lineNumber?: number;
  };
  let message = error.message ?? String(dumped);
  let name = error.name ?? 'Error';
  if (
    !['SyntaxError', 'TypeError', 'ReferenceError', 'RangeError'].includes(name)
  ) {
    return message;
  }
  let lines = code.split('\n');
  let line =
    typeof error.lineNumber === 'number'
      ? error.lineNumber - REALM_RUNNER_WRAPPER_LINES
      : undefined;
  let parts = [
    `${name} in the script${line ? ` at line ${line}` : ''}: ${message}`,
  ];
  if (line && line >= 1 && line <= lines.length) {
    let from = Math.max(1, line - 2);
    let to = Math.min(lines.length, line + 1);
    let excerpt = [];
    for (let n = from; n <= to; n++) {
      excerpt.push(
        `${n === line ? '>' : ' '} ${n} | ${lines[n - 1].slice(0, 200)}`,
      );
    }
    parts.push(excerpt.join('\n'));
  }
  if (name === 'SyntaxError' && code.includes('`')) {
    parts.push(
      "If a file's content is inside a template literal, a backtick or ${ in that content ends the string or is interpolated. Escape them in the content as \\` and \\${, or build the content without a template literal.",
    );
  }
  return parts.join('\n');
}
