import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isPagePath,
  keyOfSharePath,
  keySharePath,
  LEGACY_MODES,
  movesAsDocument,
  NEW_PASSWORD_PAGES,
  PAGE_PATHS,
  splitPagePath,
} from '../src/shell/pages.js';

const KEY = '0b6c1e9e-5a1f-4c47-9d0e-2f5b8f6f1a3c';

describe("the shell's pages", () => {
  test('every page path and the shell itself is a page', () => {
    assert.ok(isPagePath(''));
    for (let page of PAGE_PATHS) {
      assert.ok(isPagePath(page), page);
    }
    assert.ok(isPagePath(`keys/${KEY}/share`));
  });

  test('nothing else is', () => {
    for (let path of [
      'credentials',
      'shell.js',
      'keys/',
      'keys/share',
      `keys/${KEY}`,
      `keys/${KEY}/share/more`,
      'keys/not a key/share',
      `keys/${'a'.repeat(65)}/share`,
      'sign-in/',
      '/sign-in',
    ]) {
      assert.ok(!isPagePath(path), path);
    }
  });

  test("a key's share page names the key in its path", () => {
    assert.equal(keySharePath(KEY), `keys/${KEY}/share`);
    assert.equal(keyOfSharePath(keySharePath(KEY)), KEY);
    assert.equal(keyOfSharePath('share-key'), undefined);
  });

  test('every mode an older address names is a page of the same name', () => {
    for (let mode of LEGACY_MODES) {
      assert.ok(PAGE_PATHS.includes(mode), mode);
    }
  });

  test('a move to or from a page that makes a new password loads a document', () => {
    for (let page of NEW_PASSWORD_PAGES) {
      assert.ok(PAGE_PATHS.includes(page), page);
    }
    assert.ok(movesAsDocument('sign-in', 'register'));
    assert.ok(movesAsDocument('register', 'sign-in'));
    assert.ok(movesAsDocument('cli-auth', 'register'));
    assert.ok(movesAsDocument('reset-password', 'sign-in'));
    assert.ok(!movesAsDocument('sign-in', 'forgot-password'));
    assert.ok(!movesAsDocument('sign-out', 'sign-in'));
    assert.ok(!movesAsDocument('', 'keys/add'));
    assert.ok(!movesAsDocument('keys', `keys/${KEY}/share`));
  });

  test('a path splits into the shell and the page beneath it', () => {
    assert.deepEqual(splitPagePath('/secure/keys/add'), {
      shell: '/secure/',
      page: 'keys/add',
    });
    assert.deepEqual(splitPagePath(`/secure/keys/${KEY}/share`), {
      shell: '/secure/',
      page: `keys/${KEY}/share`,
    });
    assert.deepEqual(splitPagePath('/sign-in'), {
      shell: '/',
      page: 'sign-in',
    });
    assert.deepEqual(splitPagePath('/secure'), { shell: '/secure/', page: '' });
    assert.deepEqual(splitPagePath('/'), { shell: '/', page: '' });
  });
});
