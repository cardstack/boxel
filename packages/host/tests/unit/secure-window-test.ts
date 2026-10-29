import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import {
  isSecureWindowName,
  secureWindowURL,
} from '@cardstack/host/lib/secure-window';

function secureOriginPage(page: string) {
  return `${ENV.secureOriginURL.replace(/\/+$/, '')}/${page}`;
}

function fragmentOf(url: string) {
  return Object.fromEntries(new URLSearchParams(new URL(url).hash.slice(1)));
}

module('Unit | secure-window', function () {
  const CARD = 'http://localhost:4201/experiments/WeatherStation/home';
  const REALM = 'http://localhost:4201/experiments/';

  test('a key for an operation on a card names the card and the operation', function (assert) {
    let url = secureWindowURL({
      mode: 'enter-key',
      target: { kind: 'instance', card: CARD, operation: 'forecast' },
      reason: 'Needs your forecast key',
    });
    assert.strictEqual(url.split('#')[0], secureOriginPage('enter-key'));
    assert.strictEqual(new URL(url).search, '', 'nothing in the query string');
    assert.deepEqual(fragmentOf(url), {
      card: CARD,
      operation: 'forecast',
      reason: 'Needs your forecast key',
    });
  });

  test('a key for an operation on a card type names its module, export and realm', function (assert) {
    let url = secureWindowURL({
      mode: 'enter-key',
      target: {
        kind: 'type',
        module: `${REALM}weather-station`,
        name: 'WeatherStation',
        realm: REALM,
        operation: 'forecast',
      },
    });
    assert.deepEqual(fragmentOf(url), {
      module: `${REALM}weather-station`,
      name: 'WeatherStation',
      realm: REALM,
      operation: 'forecast',
    });
  });

  test('replacing the key an operation sends names the operation and what it is on', function (assert) {
    let onCard = secureWindowURL({
      mode: 'replace-key',
      target: { kind: 'instance', card: CARD, operation: 'forecast' },
      reason: 'The forecast service rejected your key',
    });
    assert.strictEqual(onCard.split('#')[0], secureOriginPage('replace-key'));
    assert.strictEqual(new URL(onCard).search, '');
    assert.deepEqual(fragmentOf(onCard), {
      card: CARD,
      operation: 'forecast',
      reason: 'The forecast service rejected your key',
    });
    let onType = secureWindowURL({
      mode: 'replace-key',
      target: {
        kind: 'type',
        module: `${REALM}weather-station`,
        name: 'WeatherStation',
        realm: REALM,
        operation: 'forecast',
      },
    });
    assert.deepEqual(fragmentOf(onType), {
      module: `${REALM}weather-station`,
      name: 'WeatherStation',
      realm: REALM,
      operation: 'forecast',
    });
  });

  test('a key entered for nothing in particular carries no fragment', function (assert) {
    let url = secureWindowURL({ mode: 'enter-key' });
    assert.strictEqual(url, secureOriginPage('enter-key'));
  });

  test('sharing a key names the realm', function (assert) {
    let url = secureWindowURL({ mode: 'share-key', realm: REALM });
    assert.strictEqual(url.split('#')[0], secureOriginPage('share-key'));
    assert.deepEqual(fragmentOf(url), { realm: REALM });
  });

  test('connecting an account for an operation on a card names the card and the operation', function (assert) {
    let url = secureWindowURL({
      mode: 'connect',
      target: { kind: 'instance', card: CARD, operation: 'listRepos' },
      reason: 'Lists your repositories',
    });
    assert.strictEqual(url.split('#')[0], secureOriginPage('connect'));
    assert.strictEqual(new URL(url).search, '', 'nothing in the query string');
    assert.deepEqual(fragmentOf(url), {
      card: CARD,
      operation: 'listRepos',
      reason: 'Lists your repositories',
    });
  });

  test('connecting an account for an operation on a card type names its module, export and realm', function (assert) {
    let url = secureWindowURL({
      mode: 'connect',
      target: {
        kind: 'type',
        module: `${REALM}repo-list`,
        name: 'RepoList',
        realm: REALM,
        operation: 'listRepos',
      },
    });
    assert.deepEqual(fragmentOf(url), {
      module: `${REALM}repo-list`,
      name: 'RepoList',
      realm: REALM,
      operation: 'listRepos',
    });
  });

  test('connecting an account for a workspace names the realm, and for nothing carries no fragment', function (assert) {
    let url = secureWindowURL({ mode: 'connect', realm: REALM });
    assert.strictEqual(url.split('#')[0], secureOriginPage('connect'));
    assert.deepEqual(fragmentOf(url), { realm: REALM });
    assert.strictEqual(
      secureWindowURL({ mode: 'connect' }),
      secureOriginPage('connect'),
    );
  });

  test('the window reads http(s) URLs and prefix-form ids, and nothing else', function (assert) {
    assert.true(isSecureWindowName(CARD));
    assert.true(isSecureWindowName('https://app.boxel.ai/someone/realm/'));
    assert.true(isSecureWindowName('@cardstack/catalog/WeatherStation/home'));
    assert.false(isSecureWindowName('javascript:alert(1)'));
    assert.false(isSecureWindowName('data:text/html,hi'));
    assert.false(isSecureWindowName('WeatherStation/home'));
  });
});
