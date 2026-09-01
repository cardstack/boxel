import { describe, it, expect } from 'vitest';

import { browserLaunchCommand } from '../../src/lib/open-browser.js';

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
