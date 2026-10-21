import { diagnosticText, parseTscDiagnostics } from '../tsc-diagnostics.ts';
import type { SharedTests } from '../helpers/index.ts';

// Captured from ember-tsc: a nested mismatch, whose cause is only in the
// 2/4-space indented lines, followed by the `--explainFiles` shape of a
// non-indented program-file path and its indented inclusion reason.
const CAPTURED_OUTPUT = [
  "nested-mismatch.ts(5,14): error TS2322: Type '{ a: { b: string; }; }' is not assignable to type 'Want'.",
  "  The types of 'a.b' are incompatible between these types.",
  "    Type 'string' is not assignable to type 'number'.",
  'node_modules/typescript/lib/lib.es2022.d.ts',
  "  Library referenced via 'es2022' from file 'node_modules/typescript/lib/lib.esnext.d.ts'",
  '',
].join('\n');

const tests = Object.freeze({
  'reads captured ember-tsc output with its elaboration': async (assert) => {
    let diagnostics = parseTscDiagnostics(CAPTURED_OUTPUT);
    assert.strictEqual(diagnostics.length, 1);
    let [diagnostic] = diagnostics;
    assert.deepEqual(
      [diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.code],
      ['nested-mismatch.ts', 5, 14, 'TS2322'],
    );
    assert.strictEqual(
      diagnosticText(diagnostic),
      "Type '{ a: { b: string; }; }' is not assignable to type 'Want'.\n" +
        "  The types of 'a.b' are incompatible between these types.\n" +
        "    Type 'string' is not assignable to type 'number'.",
    );
  },

  'reads a single-line diagnostic with no elaboration': async (assert) => {
    assert.deepEqual(
      parseTscDiagnostics(
        "a.gts(3,7): error TS2304: Cannot find name 'foo'.\n",
      ),
      [
        {
          file: 'a.gts',
          line: 3,
          column: 7,
          code: 'TS2304',
          message: "Cannot find name 'foo'.",
          elaboration: [],
        },
      ],
    );
  },

  'gives each of two adjacent diagnostics only its own elaboration': async (
    assert,
  ) => {
    let diagnostics = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  Property 'x' is missing in type 'A'.",
        "b.ts(2,2): error TS2322: Type 'C' is not assignable to type 'D'.",
        "  Property 'y' is missing in type 'C'.",
      ].join('\n'),
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.file, d.elaboration]),
      [
        ['a.ts', ["  Property 'x' is missing in type 'A'."]],
        ['b.ts', ["  Property 'y' is missing in type 'C'."]],
      ],
    );
  },

  'stops at a non-indented line that is not a diagnostic': async (assert) => {
    let [diagnostic] = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  Property 'x' is missing in type 'A'.",
        'node_modules/typescript/lib/lib.es2022.d.ts',
        "  Library referenced via 'es2022' from file 'lib.esnext.d.ts'",
      ].join('\n'),
    );
    assert.deepEqual(diagnostic.elaboration, [
      "  Property 'x' is missing in type 'A'.",
    ]);
  },

  'does not read an unlocated error as a diagnostic, and ends elaboration at it':
    async (assert) => {
      let diagnostics = parseTscDiagnostics(
        [
          "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
          "error TS5083: Cannot read file 'tsconfig.base.json'.",
          '  an indented line after it',
        ].join('\n'),
      );
      assert.strictEqual(diagnostics.length, 1);
      assert.deepEqual(diagnostics[0].elaboration, []);
    },

  'keeps elaboration across blank lines': async (assert) => {
    let [diagnostic] = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        '',
        "  Property 'x' is missing in type 'A'.",
      ].join('\n'),
    );
    assert.deepEqual(diagnostic.elaboration, [
      "  Property 'x' is missing in type 'A'.",
    ]);
  },

  'reads CRLF output without leaving a carriage return in the text': async (
    assert,
  ) => {
    let [diagnostic] = parseTscDiagnostics(
      "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.\r\n" +
        "  Property 'x' is missing in type 'A'.\r\n",
    );
    assert.strictEqual(
      diagnosticText(diagnostic),
      "Type 'A' is not assignable to type 'B'.\n" +
        "  Property 'x' is missing in type 'A'.",
    );
  },
} as SharedTests<{}>);

export default tests;
