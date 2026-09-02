import { describe, it, expect } from 'vitest';
import vitestConfig from '../../vitest.config.mjs';
import { RUN_BOXEL_DEFAULT_DEADLINE_MS } from '../helpers/run-boxel.ts';
import {
  BOOT_SETTLE_TIMEOUT_MS,
  DRAIN_BUDGET_MS,
  DB_CLOSE_BUDGET_MS,
} from '../helpers/fixture-budgets.ts';

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

  it('gives a hook more time than a test', () => {
    // Hooks run commands too, and carry the fixture boot on top of them.
    expect(budgets.hookTimeout).toBeGreaterThanOrEqual(budgets.testTimeout);
  });

  it('gives a hook more time than teardown can spend releasing the fixture', () => {
    // `stopTestRealmServer` can spend all three budgets in sequence: settling
    // a boot whose caller stopped waiting, draining a job already claimed,
    // then closing a pool that job still holds. A hook budget inside their
    // sum fires while teardown is still releasing the port and the database
    // the next file needs — the failure the budgets exist to prevent, moved
    // from the boot to the teardown rather than fixed.
    expect(budgets.hookTimeout).toBeGreaterThan(
      BOOT_SETTLE_TIMEOUT_MS + DRAIN_BUDGET_MS + DB_CLOSE_BUDGET_MS,
    );
  });
});
