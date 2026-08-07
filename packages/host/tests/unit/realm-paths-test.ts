import { module, test } from 'qunit';

import { RealmPaths, rri } from '@cardstack/runtime-common';

module('Unit | RealmPaths', function (hooks) {
  let realmPaths: RealmPaths;
  hooks.beforeEach(function () {
    realmPaths = new RealmPaths(new URL('https://cardstack.com/hümans'));
  });

  test('#local', function (assert) {
    assert.strictEqual(
      realmPaths.local(new URL('https://cardstack.com/hümans/example')),
      'example',
    );
    assert.strictEqual(
      realmPaths.local(new URL('https://cardstack.com/hümans/éxample')),
      'éxample',
    );
    assert.strictEqual(
      realmPaths.local(
        new URL('https://cardstack.com/hümans/éxample?stripped=true'),
      ),
      'éxample',
    );
    assert.strictEqual(
      realmPaths.local(
        new URL('https://cardstack.com/hümans/éxample?stripped=ü'),
        {
          preserveQuerystring: true,
        },
      ),
      'éxample?stripped=ü',
    );
  });

  test('#fileURL', function (assert) {
    assert.strictEqual(
      realmPaths.fileURL('example').href,
      'https://cardstack.com/h%C3%BCmans/example',
    );
    assert.strictEqual(
      realmPaths.fileURL('éxample').href,
      'https://cardstack.com/h%C3%BCmans/%C3%A9xample',
    );
  });

  test('#directoryURL', function (assert) {
    assert.strictEqual(
      realmPaths.directoryURL('').href,
      'https://cardstack.com/h%C3%BCmans/',
    );
    assert.strictEqual(
      realmPaths.directoryURL('example').href,
      'https://cardstack.com/h%C3%BCmans/example/',
    );
    assert.strictEqual(
      realmPaths.directoryURL('éxample').href,
      'https://cardstack.com/h%C3%BCmans/%C3%A9xample/',
    );
  });

  test('#inRealm', function (assert) {
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/hümans/example')),
    );
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/hümans/éxample')),
    );
    assert.false(
      realmPaths.inRealm(rri('https://cardstack.com/humans/éxample')),
    );
  });

  test('#inRealm handles percent-encoding, query strings, and the realm root', function (assert) {
    // Percent-escapes are decoded before comparing, so an encoded id inside
    // the realm still matches while an encoded id outside it does not.
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/h%C3%BCmans/example')),
      'percent-encoded realm path is in realm',
    );
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/hümans/a%20b.json')),
      'percent-encoded local path is in realm',
    );
    assert.false(
      realmPaths.inRealm(rri('https://cardstack.com/h%C3%BCmans2/example')),
      'a percent-encoded path outside the realm is not in realm',
    );

    // A malformed escape can't be decoded; that is a "not in realm" answer
    // rather than a thrown error.
    assert.false(
      realmPaths.inRealm(rri('https://cardstack.com/hümans/bad%ZZ')),
      'malformed percent-escape is not in realm',
    );

    // The realm root matches with or without its trailing slash, and a query
    // string doesn't defeat the match.
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/hümans')),
      'realm root without trailing slash is in realm',
    );
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/hümans?foo=bar')),
      'realm root with a query string is in realm',
    );
    assert.true(
      realmPaths.inRealm(rri('https://cardstack.com/hümans/example?a=1&b=2')),
      'local path with a query string is in realm',
    );
  });
});
