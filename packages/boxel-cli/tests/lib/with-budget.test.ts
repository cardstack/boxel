import { describe, it, expect, vi, afterEach } from 'vitest';
import { withBudget } from '../helpers/with-budget.ts';

// `stopTestRealmServer` has to finish releasing a process-wide port, worker and
// database whatever any one step does, so `withBudget` never rejects. The cost
// of that is that the log is the only place the reason survives, which makes
// telling a deliberate abandonment from a broken shutdown path the whole job of
// the return value.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withBudget', () => {
  it('reports a step that completed', async () => {
    expect(await withBudget('step', Promise.resolve(), 1000)).toBe('finished');
  });

  it('reports a budget that expired, and does not wait for the step', async () => {
    let neverSettles = new Promise(() => {});
    let started = Date.now();
    expect(await withBudget('step', neverSettles, 50)).toBe('expired');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('reports a rejection as failed rather than as an expired budget', async () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let started = Date.now();
    expect(
      await withBudget(
        'queue runner drain',
        Promise.reject(new Error('boom')),
        60_000,
      ),
    ).toBe('failed');
    // Returning promptly is half the point: a rejection reported as an expired
    // budget would also claim 60 seconds had passed.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[teardown] queue runner drain failed: Error: boom',
      ),
    );
  });

  it('does not reject, whatever the step does', async () => {
    await expect(
      withBudget('step', Promise.reject(new Error('boom')), 1000),
    ).resolves.toBe('failed');
  });
});
