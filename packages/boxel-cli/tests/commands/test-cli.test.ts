import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// The engine drives a headless Chromium, so these tests mock both engine
// entry points and assert on the options the CLI action actually forwards —
// in particular that `--timeout` reaches local and --realm modes as a
// numeric `timeoutMs`, is omitted when the flag is absent, and never
// reaches the engine when the value is invalid.

const runTestsLocally = vi.fn();
const runTestsForRealm = vi.fn();

vi.mock('../../src/lib/test-engine.ts', () => ({
  runTestsLocally: (...args: unknown[]) => runTestsLocally(...args),
  runTestsForRealm: (...args: unknown[]) => runTestsForRealm(...args),
}));

import { registerTestCommand } from '../../src/commands/test.ts';

const passedResult = {
  status: 'passed',
  passedCount: 1,
  failedCount: 0,
  skippedCount: 0,
  durationMs: 5,
  testFiles: ['sample.test.gts'],
  failures: [],
};

async function runTestCli(argv: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerTestCommand(program);
  await program.parseAsync(['test', ...argv], { from: 'user' });
}

describe('boxel test CLI flags', () => {
  beforeEach(() => {
    runTestsLocally.mockReset().mockResolvedValue(passedResult);
    runTestsForRealm.mockReset().mockResolvedValue(passedResult);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards --timeout to runTestsLocally as numeric timeoutMs', async () => {
    await runTestCli(['.', '--timeout', '900000']);
    expect(runTestsLocally).toHaveBeenCalledTimes(1);
    expect(runTestsLocally.mock.calls[0][0]).toMatchObject({
      timeoutMs: 900000,
    });
  });

  it('forwards --timeout to runTestsForRealm as numeric timeoutMs', async () => {
    await runTestCli([
      '--realm',
      'http://realm.localhost/',
      '--timeout',
      '60000',
    ]);
    expect(runTestsForRealm).toHaveBeenCalledTimes(1);
    expect(runTestsForRealm.mock.calls[0][0]).toBe('http://realm.localhost/');
    expect(runTestsForRealm.mock.calls[0][1]).toMatchObject({
      timeoutMs: 60000,
    });
  });

  it('omits timeoutMs entirely when --timeout is not given', async () => {
    await runTestCli(['.']);
    expect(runTestsLocally).toHaveBeenCalledTimes(1);
    expect('timeoutMs' in runTestsLocally.mock.calls[0][0]).toBe(false);
  });

  for (const bad of ['abc', '0', '-5', '1.5']) {
    it(`rejects --timeout ${bad} before reaching the engine`, async () => {
      await expect(runTestCli(['.', '--timeout', bad])).rejects.toThrow(
        'process.exit(1)',
      );
      expect(runTestsLocally).not.toHaveBeenCalled();
      expect(runTestsForRealm).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--timeout must be a positive integer'),
      );
    });
  }
});
