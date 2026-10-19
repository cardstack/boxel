import { module, test } from 'qunit';

import { destinationCovers } from '@cardstack/runtime-common/card-operations';

module('Unit | callApi destination', function () {
  test('a request under the destination is covered', function (assert) {
    let cases: [string, string][] = [
      ['https://api.example.com/', 'https://api.example.com/'],
      ['https://api.example.com/', 'https://api.example.com/v1/chat'],
      ['https://api.example.com/v1/', 'https://api.example.com/v1/'],
      ['https://api.example.com/v1/', 'https://api.example.com/v1/items?x=1'],
      ['https://api.example.com/v1/', 'https://API.example.com:443/v1/items'],
      ['http://localhost:4519/', 'http://localhost:4519/echo'],
    ];
    for (let [destination, url] of cases) {
      assert.true(
        destinationCovers(destination, url),
        `${destination} covers ${url}`,
      );
    }
  });

  test('a match always ends at a `/`', function (assert) {
    let cases: [string, string][] = [
      ['https://api.example.com/', 'https://api.example.com.evil.net/'],
      ['https://api.example.com/v1/', 'https://api.example.com/v1beta'],
      ['https://api.example.com/v1/', 'https://api.example.com/v1'],
      ['https://api.example.com/', 'https://api.example.com:8443/'],
      ['https://api.example.com/', 'https://api.example.com@evil.net/'],
      ['https://api.example.com/', 'http://api.example.com/'],
      ['https://api.example.com/v1/', 'https://api.example.com/v1/../admin'],
    ];
    for (let [destination, url] of cases) {
      assert.false(
        destinationCovers(destination, url),
        `${destination} does not cover ${url}`,
      );
    }
  });

  test('a destination that is not an origin and a path ending in `/` covers nothing', function (assert) {
    for (let destination of [
      'https://api.example.com/v1',
      'https://api.example.com/v1/?key=x',
      'https://api.example.com/v1/#x',
      'https://user@api.example.com/',
      'not a url',
    ]) {
      assert.false(
        destinationCovers(destination, 'https://api.example.com/v1/items'),
        destination,
      );
    }
    assert.false(
      destinationCovers('https://api.example.com/', 'not a url'),
      'an unparseable request URL',
    );
  });
});
