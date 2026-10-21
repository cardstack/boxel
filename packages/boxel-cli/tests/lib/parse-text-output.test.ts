import { describe, expect, it } from 'vitest';

import {
  explainDiagnostic,
  formatParseError,
  formatParseWarning,
} from '../../src/commands/parse.ts';

// Colours are on only for a TTY; strip them so the columns are what's checked.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (text: string) => text.replace(ANSI, '');

describe('explainDiagnostic', () => {
  it('puts the TS1206 hint on the headline, ahead of the elaboration', () => {
    let lines = explainDiagnostic({
      file: 'card.gts',
      line: 1,
      column: 1,
      code: 'TS1206',
      message: 'Decorators are not valid here.',
      elaboration: ['  first reason', '    nested reason'],
    }).split('\n');

    expect(lines[0]).toMatch(
      /^Decorators are not valid here\. Decorators like @tracked aren't allowed/,
    );
    expect(lines.slice(1)).toEqual(['  first reason', '    nested reason']);
  });

  it('leaves other diagnostics as the headline and its elaboration', () => {
    expect(
      explainDiagnostic({
        file: 'card.gts',
        line: 1,
        column: 1,
        code: 'TS2322',
        message: "Type 'A' is not assignable to type 'B'.",
        elaboration: ["  Property 'x' is missing in type 'A'."],
      }),
    ).toBe(
      "Type 'A' is not assignable to type 'B'.\n" +
        "  Property 'x' is missing in type 'A'.",
    );
  });
});

describe('formatParseError', () => {
  it('hangs continuation lines under the start of the message', () => {
    let lines = plain(
      formatParseError({
        file: 'card.gts',
        line: 5,
        column: 14,
        message:
          "Type 'A' is not assignable to type 'B'.\n" +
          "  The types of 'a.b' are incompatible between these types.\n" +
          "    Type 'string' is not assignable to type 'number'.",
      }),
    ).split('\n');

    let messageColumn = lines[0].indexOf("Type 'A'");
    expect(messageColumn).toBe('  error 5:14 '.length);
    expect(lines[1]).toBe(
      ' '.repeat(messageColumn) +
        "  The types of 'a.b' are incompatible between these types.",
    );
    expect(lines[2]).toBe(
      ' '.repeat(messageColumn) +
        "    Type 'string' is not assignable to type 'number'.",
    );
  });

  it('measures the indent from the location it prints', () => {
    let [, continuation] = plain(
      formatParseError({
        file: 'card.gts',
        line: 120,
        column: 3,
        message: 'headline\n  reason',
      }),
    ).split('\n');
    expect(continuation).toBe(' '.repeat('  error 120:3 '.length) + '  reason');
  });

  it('leaves a single-line message and blank lines as they are', () => {
    expect(
      plain(
        formatParseError({ file: 'a.gts', line: 1, column: 2, message: 'x' }),
      ),
    ).toBe('  error 1:2 x');
    expect(
      plain(
        formatParseError({
          file: 'a.gts',
          line: 1,
          column: 2,
          message: 'x\n\n  y',
        }),
      ).split('\n')[1],
    ).toBe('');
  });
});

describe('formatParseWarning', () => {
  it('hangs continuation lines under the start of the warning', () => {
    expect(plain(formatParseWarning('first\n  second'))).toBe(
      'warning first\n' + ' '.repeat('warning '.length) + '  second',
    );
  });
});
