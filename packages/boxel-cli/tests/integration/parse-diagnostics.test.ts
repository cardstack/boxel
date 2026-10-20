import { describe, it, expect } from 'vitest';

import { runGlintCheck } from '../../src/commands/parse.ts';

// tsc names the actual incompatibility in indented lines under the error
// line; an author running `boxel parse` needs those, not just the headline.

describe('boxel parse — diagnostic messages (in-process glint)', () => {
  it(
    "carries tsc's elaboration lines in the error message",
    async () => {
      let { errors } = await runGlintCheck([
        {
          path: 'nested-mismatch.ts',
          content: `interface Want {
  a: { b: number };
}
const value = { a: { b: 'not a number' } };
export const got: Want = value;
`,
        },
      ]);

      expect(errors).toHaveLength(1);
      let [error] = errors;
      expect(error.file).toBe('nested-mismatch.ts');
      expect(error.line).toBe(5);
      expect(error.message.split('\n')).toEqual([
        expect.stringMatching(/is not assignable to type 'Want'/),
        expect.stringMatching(/^ {2}The types of 'a\.b' are incompatible/),
        expect.stringMatching(
          /^ {4}Type 'string' is not assignable to type 'number'/,
        ),
      ]);
    },
    { timeout: 180_000 },
  );
});
