import { describe, expect, it } from 'vitest';

import {
  diagnosticText,
  parseTscDiagnostics,
} from '@cardstack/runtime-common/tsc-diagnostics';

describe('parseTscDiagnostics', () => {
  it('reads a single-line diagnostic with no elaboration', () => {
    let diagnostics = parseTscDiagnostics(
      "a.gts(3,7): error TS2304: Cannot find name 'foo'.\n",
    );
    expect(diagnostics).toEqual([
      {
        file: 'a.gts',
        line: 3,
        column: 7,
        code: 'TS2304',
        message: "Cannot find name 'foo'.",
        elaboration: [],
      },
    ]);
  });

  it('keeps indented continuation lines, in order and with their indentation', () => {
    let [diagnostic] = parseTscDiagnostics(
      [
        "a.ts(3,12): error TS2322: Type '{ a: { b: string; }; }' is not assignable to type 'Want'.",
        "  The types of 'a.b' are incompatible between these types.",
        "    Type 'string' is not assignable to type 'number'.",
        '',
      ].join('\n'),
    );
    expect(diagnostic.elaboration).toEqual([
      "  The types of 'a.b' are incompatible between these types.",
      "    Type 'string' is not assignable to type 'number'.",
    ]);
    expect(diagnosticText(diagnostic)).toBe(
      "Type '{ a: { b: string; }; }' is not assignable to type 'Want'.\n" +
        "  The types of 'a.b' are incompatible between these types.\n" +
        "    Type 'string' is not assignable to type 'number'.",
    );
  });

  it('gives each of two adjacent diagnostics only its own elaboration', () => {
    let diagnostics = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  Property 'x' is missing in type 'A'.",
        "b.ts(2,2): error TS2322: Type 'C' is not assignable to type 'D'.",
        "  Property 'y' is missing in type 'C'.",
      ].join('\n'),
    );
    expect(diagnostics.map((d) => [d.file, d.elaboration])).toEqual([
      ['a.ts', ["  Property 'x' is missing in type 'A'."]],
      ['b.ts', ["  Property 'y' is missing in type 'C'."]],
    ]);
  });

  it('stops at a non-indented line that is not a diagnostic', () => {
    // The shape `--explainFiles` interleaves: a program-file path, then its
    // indented inclusion reasons.
    let [diagnostic] = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  Property 'x' is missing in type 'A'.",
        'node_modules/typescript/lib/lib.es2022.d.ts',
        "  Library referenced via 'es2022' from file 'lib.esnext.d.ts'",
      ].join('\n'),
    );
    expect(diagnostic.elaboration).toEqual([
      "  Property 'x' is missing in type 'A'.",
    ]);
  });

  it('does not read an unlocated error as a diagnostic, and ends elaboration at it', () => {
    let diagnostics = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        "error TS5083: Cannot read file 'tsconfig.base.json'.",
        '  an indented line after it',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].elaboration).toEqual([]);
  });

  it('keeps elaboration across blank lines', () => {
    let [diagnostic] = parseTscDiagnostics(
      [
        "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
        '',
        "  Property 'x' is missing in type 'A'.",
      ].join('\n'),
    );
    expect(diagnostic.elaboration).toEqual([
      "  Property 'x' is missing in type 'A'.",
    ]);
  });

  it('reads CRLF output without leaving a carriage return in the text', () => {
    let [diagnostic] = parseTscDiagnostics(
      "a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.\r\n" +
        "  Property 'x' is missing in type 'A'.\r\n",
    );
    expect(diagnosticText(diagnostic)).toBe(
      "Type 'A' is not assignable to type 'B'.\n" +
        "  Property 'x' is missing in type 'A'.",
    );
  });
});
