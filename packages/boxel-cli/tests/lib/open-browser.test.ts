import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { describe, it, expect, vi } from 'vitest';

import {
  browserLaunchCommand,
  openBrowser,
} from '../../src/lib/open-browser.js';

describe('browserLaunchCommand', () => {
  it('passes the URL straight through on darwin', () => {
    expect(
      browserLaunchCommand('https://app.boxel.ai/?a=1&b=2', 'darwin'),
    ).toEqual(['open', ['https://app.boxel.ai/?a=1&b=2']]);
  });

  it('passes the URL straight through on linux', () => {
    expect(
      browserLaunchCommand('https://app.boxel.ai/?a=1&b=2', 'linux'),
    ).toEqual(['xdg-open', ['https://app.boxel.ai/?a=1&b=2']]);
  });

  it('caret-escapes cmd metacharacters on win32', () => {
    // Unescaped, cmd.exe would cut the `start` line at the `&` and run the
    // rest (`cardPath=...`) as a separate command.
    expect(
      browserLaunchCommand(
        'https://localhost:4200/?loginToken=tok&cardPath=cards%2F1.json',
        'win32',
      ),
    ).toEqual([
      'cmd',
      [
        '/c',
        'start',
        '',
        'https://localhost:4200/?loginToken=tok^&cardPath=cards%2F1.json',
      ],
    ]);
  });

  it('escapes a literal caret before the other metacharacters on win32', () => {
    expect(browserLaunchCommand('https://x.test/?a=^&b=|', 'win32')).toEqual([
      'cmd',
      ['/c', 'start', '', 'https://x.test/?a=^^^&b=^|'],
    ]);
  });
});

// A launcher that starts, then exits with `code` after `exitAfterMs`, or
// keeps running when `code` is undefined.
function launcher({
  code,
  exitAfterMs = 10,
  startFails = false,
}: {
  code?: number;
  exitAfterMs?: number;
  startFails?: boolean;
}) {
  return () => {
    let child = Object.assign(new EventEmitter(), {
      unref: () => {},
    }) as unknown as ChildProcess;
    setTimeout(() => {
      if (startFails) {
        child.emit('error', new Error('spawn xdg-open ENOENT'));
        return;
      }
      child.emit('spawn');
      if (code !== undefined) {
        setTimeout(() => child.emit('exit', code, null), exitAfterMs);
      }
    }, 0);
    return child;
  };
}

describe('openBrowser', () => {
  const URL = 'https://app.boxel.ai/';

  it('counts a launcher that hands the URL on as opened', async () => {
    expect(await openBrowser(URL, { spawnFn: launcher({ code: 0 }) })).toBe(
      true,
    );
  });

  it('counts a launcher that is missing as not opened', async () => {
    expect(
      await openBrowser(URL, { spawnFn: launcher({ startFails: true }) }),
    ).toBe(false);
  });

  it('counts a launcher that exits with an error as not opened', async () => {
    // xdg-open with a display but no browser to hand the URL to.
    expect(await openBrowser(URL, { spawnFn: launcher({ code: 3 }) })).toBe(
      false,
    );
  });

  it('counts a launcher still running after the grace period as opened', async () => {
    vi.useFakeTimers();
    try {
      let opened = openBrowser(URL, { spawnFn: launcher({}), graceMs: 1500 });
      await vi.advanceTimersByTimeAsync(1500);
      expect(await opened).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a launcher that fails after the grace period as opened', async () => {
    expect(
      await openBrowser(URL, {
        spawnFn: launcher({ code: 1, exitAfterMs: 50 }),
        graceMs: 20,
      }),
    ).toBe(true);
  });
});
