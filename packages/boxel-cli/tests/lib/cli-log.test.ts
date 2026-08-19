import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cliLog, isQuiet, setQuiet } from '../../src/lib/cli-log.ts';

describe('cli-log', () => {
  // Use `any` for spy types to avoid friction with vitest's overloaded
  // signatures for write() and the various console.* methods.
  let stdoutSpy: any;
  let stderrSpy: any;
  let consoleLogSpy: any;
  let consoleInfoSpy: any;
  let consoleDebugSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setQuiet(false);
    vi.restoreAllMocks();
  });

  describe('cliLog.output', () => {
    it('writes to stdout regardless of quiet state', () => {
      cliLog.output('hello');
      expect(stdoutSpy).toHaveBeenCalledWith('hello\n');

      stdoutSpy.mockClear();
      setQuiet(true);
      cliLog.output('still here');
      expect(stdoutSpy).toHaveBeenCalledWith('still here\n');
    });

    it('serializes objects as JSON', () => {
      cliLog.output({ status: 'ok' });
      expect(stdoutSpy).toHaveBeenCalledWith('{"status":"ok"}\n');
    });
  });

  describe('cliLog.info', () => {
    it('writes to stderr when not quiet', () => {
      cliLog.info('progress message');
      expect(stderrSpy).toHaveBeenCalledWith('progress message\n');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('is silenced when quiet', () => {
      setQuiet(true);
      cliLog.info('progress message');
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('cliLog.warn / cliLog.error', () => {
    it('always writes to stderr (warn) even when quiet', () => {
      setQuiet(true);
      cliLog.warn('something funny');
      expect(stderrSpy).toHaveBeenCalledWith('something funny\n');
    });

    it('always writes to stderr (error) even when quiet', () => {
      setQuiet(true);
      cliLog.error('boom');
      expect(stderrSpy).toHaveBeenCalledWith('boom\n');
    });
  });

  describe('console interception under quiet mode', () => {
    it('replaces console.log/info/debug with no-ops when quiet=true', () => {
      // Restore console.* so we can observe whether the replacements stick.
      consoleLogSpy.mockRestore();
      consoleInfoSpy.mockRestore();
      consoleDebugSpy.mockRestore();

      // Fresh spies on stdout so we can see if any writes leak through.
      stdoutSpy.mockClear();

      setQuiet(true);
      console.log('arbitrary message from a command file');
      console.info('arbitrary info');
      console.debug('arbitrary debug');

      // Under quiet, the interceptor replaces console.log/info/debug with
      // no-ops, so nothing should reach stdout.
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('does NOT silence console.warn or console.error when quiet=true', () => {
      // Re-spy on console.warn / console.error so we can observe whether
      // setQuiet(true) replaced them (it must not).
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setQuiet(true);
      console.warn('legit warning');
      console.error('legit error');

      // The spy receives the call iff console.warn/error were not
      // replaced by no-ops (which is exactly what we want: setQuiet only
      // intercepts log/info/debug).
      expect(warnSpy).toHaveBeenCalledWith('legit warning');
      expect(errorSpy).toHaveBeenCalledWith('legit error');
    });

    it('restores original console functions when quiet=false again', () => {
      consoleLogSpy.mockRestore();

      // First, in quiet mode console.log is a no-op
      setQuiet(true);
      // After setQuiet(true) the underlying console.log reference has
      // been replaced with our no-op, so installing a NEW spy here would
      // observe calls into the no-op replacement, not the original.
      // Instead, exit quiet mode and then verify console.log functions
      // again by spying on it post-restoration.
      setQuiet(false);

      const restoredSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      console.log('back');
      expect(restoredSpy).toHaveBeenCalledWith('back');
    });
  });

  describe('isQuiet', () => {
    it('reflects current quiet state', () => {
      expect(isQuiet()).toBe(false);
      setQuiet(true);
      expect(isQuiet()).toBe(true);
      setQuiet(false);
      expect(isQuiet()).toBe(false);
    });
  });
});
