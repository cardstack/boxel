import { module, test } from 'qunit';

import { RealmPaths, rri, toSafeFileName } from '@cardstack/runtime-common';

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

  test('#toSafeFileName leaves ordinary names alone', function (assert) {
    for (let name of [
      'New Recording 3.m4a',
      'Recording 2026-08-11 at 10.32.15 AM.m4a',
      'Voice Memo (1).m4a',
      'Q&A session.m4a',
      'notes re: budget.m4a',
      'Récital.m4a',
      '会議.m4a',
      'card-api.gts',
    ]) {
      assert.strictEqual(toSafeFileName(name), name, `${name} is unchanged`);
    }
  });

  test('#toSafeFileName replaces characters that URL syntax would eat', function (assert) {
    assert.strictEqual(toSafeFileName('Standup #3.m4a'), 'Standup -3.m4a');
    assert.strictEqual(toSafeFileName('notes?.m4a'), 'notes-.m4a');
    assert.strictEqual(
      toSafeFileName('meeting 100% done.m4a'),
      'meeting 100- done.m4a',
    );
    assert.strictEqual(toSafeFileName('a\\b.m4a'), 'a-b.m4a');
    assert.strictEqual(toSafeFileName('a/b.m4a'), 'a-b.m4a');
    assert.strictEqual(toSafeFileName('Rec\tx.m4a'), 'Rec-x.m4a');

    // A run of unsafe characters collapses to a single replacement.
    assert.strictEqual(toSafeFileName('a#?%b.m4a'), 'a-b.m4a');

    // Surrounding whitespace is what the URL parser would strip anyway.
    assert.strictEqual(toSafeFileName('  Rec.m4a  '), 'Rec.m4a');

    // Names that resolve to a directory rather than a file.
    for (let name of ['', '   ', '.', '..', '/']) {
      assert.strictEqual(toSafeFileName(name), '-', `${name} is replaced`);
    }
  });

  test('a safe file name survives the fileURL -> local round trip', function (assert) {
    // The invariant the sanitizer exists for, asserted as a property rather
    // than against a fixed character list: whatever `toSafeFileName` returns,
    // the realm stores under exactly that name. A file whose name is mangled
    // in transit loses its extension, and with it the content type every layer
    // re-derives from the path.
    for (let name of [
      'Standup #3.m4a',
      'notes?.m4a',
      'meeting 100% done.m4a',
      'a%zz.m4a',
      'a\\b.m4a',
      'Rec\tx.m4a',
      '  Rec.m4a  ',
      'New Recording 3.m4a',
      'Récital.m4a',
      '会議.m4a',
    ]) {
      let safe = toSafeFileName(name);
      assert.strictEqual(
        realmPaths.local(realmPaths.fileURL(safe)),
        safe,
        `${JSON.stringify(name)} round trips as ${JSON.stringify(safe)}`,
      );
      assert.true(safe.endsWith('.m4a'), `${safe} keeps its extension`);
    }
  });
});
