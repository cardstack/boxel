import { describe, it, expect } from 'vitest';
import vitestConfig from '../../vitest.config.mjs';
import {
  RUN_BOXEL_DEFAULT_DEADLINE_MS,
  runBoxel,
} from '../helpers/run-boxel.ts';

// `runBoxel`'s kill deadline is the only mechanism that can end a wedged CLI
// subprocess *and report which command it was*. vitest's budgets have to sit
// above it, or vitest abandons the subprocess first: the failure then reads
// "Test timed out in Nms" with no command and no output, and the abandoned
// command keeps running against the realm server the rest of the file is
// using. Two numbers in two files, so assert the relationship rather than
// trusting the comments to stay in step.

const budgets = (
  vitestConfig as unknown as {
    test: { testTimeout: number; hookTimeout: number };
  }
).test;

describe('deadline ladder', () => {
  it('gives a test more time than runBoxel gives a command', () => {
    expect(budgets.testTimeout).toBeGreaterThan(RUN_BOXEL_DEFAULT_DEADLINE_MS);
  });

  it('keeps runBoxel from deriving a deadline these budgets cannot cover', async () => {
    // `RUN_BOXEL_DEFAULT_DEADLINE_MS` is the whole reason the assertion above
    // means anything: were the helper free to derive a longer deadline from a
    // command's own `--timeout`, a budget set here could still fire first and
    // abandon the subprocess. A command that needs longer has to be given it
    // explicitly, at a call site that raises its own budget to match.
    await expect(
      runBoxel(['realm', 'publish', '--timeout', '600000']),
    ).rejects.toThrow(/past the .*ms this helper takes on its own/);
  });

  it('gives a hook more time than a test', () => {
    // Hooks run commands too, and carry the fixture boot on top of them.
    expect(budgets.hookTimeout).toBeGreaterThanOrEqual(budgets.testTimeout);
  });
});
