import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkedReturn,
  checkedUser,
  handOffURL,
  needsConfirmation,
} from '../src/security/app-handoff.js';

const LISTED = [
  'https://app.example.test',
  'https://*.preview.example.test',
  'http://localhost:*',
  'https://localhost:*',
  'http://127.0.0.1:*',
];
const CONFIG = { realmServerURL: new URL('https://app.example.test/') };

test('a return on a listed origin is kept whole, path and query included', () => {
  assert.equal(
    checkedReturn(
      'https://app.example.test/a/b?operatorModeState=%7B%7D',
      LISTED,
    ),
    'https://app.example.test/a/b?operatorModeState=%7B%7D',
  );
  assert.equal(
    checkedReturn('https://branch.preview.example.test/', LISTED),
    'https://branch.preview.example.test/',
  );
});

test('a return anywhere else is refused', () => {
  for (let value of [
    'https://elsewhere.example/',
    'https://app.example.test.elsewhere.example/',
    'https://user:pass@app.example.test/',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//app.example.test/',
    '/relative',
    '',
    undefined,
  ]) {
    assert.equal(checkedReturn(value, LISTED), undefined, String(value));
  }
});

test('the token goes in the fragment, never the query', () => {
  let url = new URL(
    handOffURL('https://app.example.test/a?loginToken=stale#old', 'fresh'),
  );
  assert.equal(url.searchParams.has('loginToken'), false);
  assert.equal(url.hash, '#loginToken=fresh');
  assert.equal(url.pathname, '/a');
});

test('the device the app signs in as rides in the fragment beside the token', () => {
  let url = new URL(
    handOffURL('https://app.example.test/a?b=c', 'fresh', 'WINDOWBOUND'),
  );
  assert.equal(url.search, '?b=c');
  assert.equal(url.hash, '#loginToken=fresh&deviceId=WINDOWBOUND');
});

test('a hand-off to a loopback origin asks first, whatever the scheme', () => {
  assert.equal(needsConfirmation('http://localhost:4200/', CONFIG), true);
  assert.equal(needsConfirmation('https://localhost:4200/', CONFIG), true);
  assert.equal(needsConfirmation('http://127.0.0.1:4200/', CONFIG), true);
  assert.equal(needsConfirmation('https://app.example.test/', CONFIG), false);
});

test("the realm server's own origin is never asked about", () => {
  let local = { realmServerURL: new URL('https://localhost:4205/') };
  assert.equal(needsConfirmation('https://localhost:4205/test/', local), false);
  assert.equal(needsConfirmation('https://localhost:4200/', local), true);
});

test('an account is named only by a Matrix user ID', () => {
  for (let value of [
    '@someone:example.test',
    '@some.one_2=x/y+z-w:boxel.ai',
    '@someone:localhost:8008',
  ]) {
    assert.equal(checkedUser(value), value);
  }
  for (let value of [
    'someone',
    'someone@example.test',
    '@someone',
    '@:example.test',
    '@some one:example.test',
    '@someone:example.test/path',
    '@someone:example.test#x',
    '@someone:exa mple.test',
    `@${'a'.repeat(250)}:example.test`,
    '',
    undefined,
    42,
  ]) {
    assert.equal(checkedUser(value), undefined, String(value));
  }
});
