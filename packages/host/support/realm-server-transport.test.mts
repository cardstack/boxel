import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealmServerTransport } from '../app/lib/realm-server-transport.ts';

const identityURL = 'http://realm.default.boxel.localhost:4242/';
const transportURL = 'https://meadow-river-ysrx.boxel.link/';

test('configured identity and public transport identify the same realm server', () => {
  const transport = createRealmServerTransport({ identityURL, transportURL });
  assert.equal(transport.normalizeServerURL(identityURL), transportURL);
  assert.equal(
    transport.normalizeServerURL(identityURL.slice(0, -1)),
    transportURL,
  );
  assert.equal(transport.normalizeServerURL(transportURL), transportURL);
});

test('foreign servers, sibling paths and lookalike hosts retain their own identity', () => {
  const transport = createRealmServerTransport({ identityURL, transportURL });
  for (const url of [
    'https://another-server.example/',
    'http://realm.default.boxel.localhost:4242/other-server/',
    'http://realm.default.boxel.localhost.attacker.test:4242/',
    'http://other.default.boxel.localhost:4242/',
  ])
    assert.equal(transport.normalizeServerURL(url), url);
});

test('the configured boundary supports URL normalization and hosted deployments', () => {
  const direct = createRealmServerTransport({
    identityURL: 'https://APP.EXAMPLE:443',
    transportURL: 'https://app.example/',
  });
  assert.equal(
    direct.normalizeServerURL('https://app.example'),
    'https://app.example/',
  );
  const prefixed = createRealmServerTransport({
    identityURL: 'https://internal.example/boxel',
    transportURL: 'https://public.example/boxel',
  });
  assert.equal(
    prefixed.normalizeServerURL('https://internal.example/boxel/'),
    'https://public.example/boxel/',
  );
});

test('configuration and claims reject credentials and ambiguous URL components', () => {
  const transport = createRealmServerTransport({ identityURL, transportURL });
  for (const url of [
    'file:///tmp/server',
    '/relative',
    'https://user:password@example.test/',
    'https://example.test/?key=value',
    'https://example.test/#fragment',
  ]) {
    assert.throws(
      () => transport.normalizeServerURL(url),
      /^Error: Invalid realm server URL$/,
    );
    assert.throws(
      () => createRealmServerTransport({ identityURL: url, transportURL }),
      /^Error: Invalid realm server URL$/,
    );
  }
});
