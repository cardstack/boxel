import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  headlessShellDirNameFrom,
  playwrightHeadlessShellDirName,
  playwrightHeadlessShellPresent,
} from '../src/preflight.ts';

module('preflight > Playwright headless shell', function (hooks) {
  let browsersPath: string;
  let savedBrowsersPath: string | undefined;

  hooks.beforeEach(function () {
    savedBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    browsersPath = mkdtempSync(join(tmpdir(), 'sf-preflight-'));
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  });

  hooks.afterEach(function () {
    if (savedBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsersPath;
    }
    rmSync(browsersPath, { recursive: true, force: true });
  });

  test('names the revision the installed Playwright launches', function (assert) {
    let name = playwrightHeadlessShellDirName();
    assert.true(
      /^chromium_headless_shell-\d+$/.test(name ?? ''),
      `unexpected directory name: ${name}`,
    );
  });

  test('a build of another revision does not satisfy it', function (assert) {
    let expected = playwrightHeadlessShellDirName()!;
    let revision = Number(expected.split('-').pop());
    mkdirSync(join(browsersPath, `chromium_headless_shell-${revision - 1}`));

    assert.false(playwrightHeadlessShellPresent(expected));
  });

  test('the installed revision satisfies it', function (assert) {
    let expected = playwrightHeadlessShellDirName()!;
    mkdirSync(join(browsersPath, expected));

    assert.true(playwrightHeadlessShellPresent(expected));
  });

  test('an entry with platform overrides names no single directory', function (assert) {
    assert.strictEqual(
      headlessShellDirNameFrom([
        { name: 'chromium', revision: '1254' },
        { name: 'chromium-headless-shell', revision: '1254' },
      ]),
      'chromium_headless_shell-1254',
    );
    assert.strictEqual(
      headlessShellDirNameFrom([
        {
          name: 'chromium-headless-shell',
          revision: '1254',
          revisionOverrides: { 'mac14-arm64': '1250' },
        },
      ]),
      undefined,
    );
  });

  test('with no expected directory, a platform override build satisfies it', function (assert) {
    assert.false(playwrightHeadlessShellPresent(undefined));

    mkdirSync(
      join(browsersPath, 'chromium_headless_shell_mac14_arm64_special-1250'),
    );

    assert.true(playwrightHeadlessShellPresent(undefined));
  });
});
