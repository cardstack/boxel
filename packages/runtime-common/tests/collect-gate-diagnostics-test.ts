import { collectGateDiagnostics } from '../realm-source-staging.ts';
import type { SharedTests } from '../helpers/index.ts';

// `resolve` is lexical, so a temp dir that does not exist is enough.
const TEMP_DIR = '/tmp/parse-gate-test';
const FILES = [{ path: 'card.gts' }, { path: 'other.gts' }];

function collect(lines: string[], exitedWithError = true) {
  return collectGateDiagnostics({
    output: lines.join('\n'),
    exitedWithError,
    tempDir: TEMP_DIR,
    files: FILES,
  });
}

const tests = Object.freeze({
  'keeps a diagnostic in a checked file, with its elaboration': async (
    assert,
  ) => {
    let { diagnostics, stagedWarning, silentSetupFailure } = collect([
      "card.gts(4,9): error TS2322: Type 'A' is not assignable to type 'B'.",
      "  Property 'x' is missing in type 'A'.",
    ]);
    assert.deepEqual(
      diagnostics.map((d) => [d.file, d.line, d.column, d.elaboration]),
      [['card.gts', 4, 9, ["  Property 'x' is missing in type 'A'."]]],
    );
    assert.strictEqual(stagedWarning, undefined);
    assert.false(silentSetupFailure);
  },

  'drops a staged-source diagnostic into a warning that carries its elaboration':
    async (assert) => {
      let { diagnostics, stagedWarning, silentSetupFailure } = collect([
        ".realm-sources/catalog/blog/author.gts(7,3): error TS2344: Type 'typeof Author' does not satisfy the constraint 'typeof BaseDef'.",
        "  Types of property 'icon' are incompatible.",
        ".realm-sources/catalog/blog/author.gts(9,3): error TS2304: Cannot find name 'x'.",
      ]);
      assert.deepEqual(diagnostics, []);
      assert.true(
        stagedWarning?.startsWith(
          'ember-tsc reported 2 diagnostic(s) in fetched realm sources',
        ),
        'the warning counts both staged diagnostics',
      );
      assert.true(
        stagedWarning?.endsWith(
          "The first: .realm-sources/catalog/blog/author.gts(7,3): TS2344: Type 'typeof Author' does not satisfy the constraint 'typeof BaseDef'.\n" +
            "  Types of property 'icon' are incompatible.",
        ),
        'the sample carries the elaboration, at the end of the sentence',
      );
      assert.false(
        silentSetupFailure,
        'staged diagnostics explain the non-zero exit',
      );
    },

  "drops the TS2353 'scoped' diagnostic but keeps another TS2353": async (
    assert,
  ) => {
    let { diagnostics } = collect([
      "card.gts(3,10): error TS2353: Object literal may only specify known properties, and 'scoped' does not exist in type 'StyleAttributes'.",
      "card.gts(5,10): error TS2353: Object literal may only specify known properties, and 'colour' does not exist in type 'Options'.",
    ]);
    assert.deepEqual(
      diagnostics.map((d) => d.line),
      [5],
    );
  },

  'drops diagnostics outside the checked files without reading as a setup failure':
    async (assert) => {
      let { diagnostics, silentSetupFailure } = collect([
        "unchecked.gts(1,1): error TS2304: Cannot find name 'x'.",
        "../elsewhere/lib.d.ts(1,1): error TS2304: Cannot find name 'y'.",
      ]);
      assert.deepEqual(diagnostics, []);
      assert.false(
        silentSetupFailure,
        'dropped diagnostics still explain the non-zero exit',
      );
    },

  "does not attach a dropped diagnostic's elaboration to the kept one before it":
    async (assert) => {
      let { diagnostics } = collect([
        "card.gts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  Property 'x' is missing in type 'A'.",
        "unchecked.gts(2,2): error TS2322: Type 'C' is not assignable to type 'D'.",
        "  Property 'y' is missing in type 'C'.",
      ]);
      assert.deepEqual(
        diagnostics.map((d) => d.elaboration),
        [["  Property 'x' is missing in type 'A'."]],
      );
    },

  'reads a non-zero exit with no diagnostics as a silent setup failure': async (
    assert,
  ) => {
    assert.true(collect(['error: cannot find tsconfig']).silentSetupFailure);
    assert.false(
      collect(['error: cannot find tsconfig'], false).silentSetupFailure,
      'a zero exit is never a setup failure',
    );
  },
} as SharedTests<{}>);

export default tests;
