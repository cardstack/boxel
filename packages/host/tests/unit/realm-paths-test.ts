import { module, test } from 'qunit';

import {
  RealmPaths,
  inferContentType,
  ri,
  rri,
  toSafeFileName,
} from '@cardstack/runtime-common';
import { fileSizeLimitFor } from '@cardstack/runtime-common/write-size-validation';

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

  test('the two constructor overloads describe the same realm', function (assert) {
    // A caller holding a realm identifier uses the string overload; one holding
    // a URL uses the other. Both must answer for the same realm, including when
    // the identifier itself carries percent-escapes — `inRealm` decodes the
    // candidate, so a realm left encoded would match neither the encoded form
    // nor the decoded one.
    let fromId = new RealmPaths(ri('https://cardstack.com/h%C3%BCmans/'));
    let fromURL = new RealmPaths(new URL('https://cardstack.com/h%C3%BCmans/'));

    assert.strictEqual(
      fromId.url,
      fromURL.url,
      'an encoded identifier and the same URL produce one realm url',
    );

    for (let candidate of [
      'https://cardstack.com/h%C3%BCmans/example',
      'https://cardstack.com/hümans/example',
    ]) {
      assert.true(
        fromId.inRealm(rri(candidate)),
        `${candidate} is in the realm built from the identifier`,
      );
      assert.strictEqual(
        fromId.local(rri(candidate)),
        'example',
        `${candidate} resolves to its local path`,
      );
    }
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

    // Surrounding spaces and control characters are what the URL parser strips
    // anyway. Other Unicode whitespace it keeps, so a name keeps it too.
    assert.strictEqual(toSafeFileName('  Rec.m4a  '), 'Rec.m4a');
    assert.strictEqual(toSafeFileName('\tRec.m4a'), 'Rec.m4a');
    let nbsp = String.fromCharCode(0xa0);
    assert.strictEqual(
      toSafeFileName(`${nbsp}Rec.m4a`),
      `${nbsp}Rec.m4a`,
      'a non-breaking space is preserved, not trimmed',
    );

    // Names that resolve to a directory rather than a file.
    for (let name of ['', '   ', '.', '..', '/']) {
      assert.strictEqual(toSafeFileName(name), '-', `${name} is replaced`);
    }
  });

  test('#toSafeFileName keeps the extension when URL syntax trails it', function (assert) {
    // `#` and `?` open a fragment or query that runs to the end of the name, so
    // the tail is cut rather than substituted for. Replacing it would seat a
    // character after the extension and cost the file its content type — the
    // very outcome the sanitizer exists to avoid.
    for (let name of [
      'recording.m4a#',
      'recording.m4a?',
      'recording.m4a%',
      'recording.m4a#x',
      'foo.m4a??',
    ]) {
      let safe = toSafeFileName(name);
      assert.true(
        safe.endsWith('.m4a'),
        `${name} keeps its extension (got ${safe})`,
      );
    }

    // The cut applies to the extension, not to a dot earlier in the name: this
    // one really is a .txt file and stays one.
    assert.strictEqual(
      toSafeFileName('recording.m4a#frag.txt'),
      'recording.m4a-frag.txt',
    );
  });

  test('#toSafeFileName neutralizes a name that reads as a URL scheme', function (assert) {
    // `new URL('foo:bar.txt', realmURL)` resolves to an absolute `foo:` URL
    // rather than a path inside the realm, so the write lands outside it.
    assert.strictEqual(toSafeFileName('foo:bar.txt'), 'foo-bar.txt');
    assert.strictEqual(toSafeFileName('a:b.m4a'), 'a-b.m4a');

    // Replacing a colon can uncover another scheme behind it, since `-` is
    // legal in one: a single pass over 'x:y:z.txt' leaves 'x-y:z.txt', which
    // still reads as scheme 'x-y'.
    assert.strictEqual(toSafeFileName('x:y:z.txt'), 'x-y-z.txt');
    assert.strictEqual(
      toSafeFileName('Meeting:2pm:notes.txt'),
      'Meeting-2pm-notes.txt',
    );
    assert.strictEqual(toSafeFileName('a::b.txt'), 'a--b.txt');

    // A colon anywhere but the scheme position is ordinary and stays put.
    for (let name of [
      'notes re: budget.m4a',
      'Rec : x.m4a',
      '10:30 notes.m4a',
    ]) {
      assert.strictEqual(toSafeFileName(name), name, `${name} is unchanged`);
    }
  });

  test('#toSafeFileName is idempotent', function (assert) {
    // Sanitizing an already-sanitized name has to be a no-op, or a name that
    // makes a second trip through the upload path drifts.
    for (let name of [
      'x:y:z.txt',
      'a::b.txt',
      'Standup #3.m4a',
      'recording.m4a#x',
      'image.png?v=2',
      '  Rec.m4a  ',
      'New Recording 3.m4a',
    ]) {
      let once = toSafeFileName(name);
      assert.strictEqual(
        toSafeFileName(once),
        once,
        `${JSON.stringify(name)} settles at ${JSON.stringify(once)}`,
      );
    }
  });

  test('a sanitized name keeps the content type and size ceiling of its extension', function (assert) {
    // The reason the extension has to survive: content type is never stored,
    // so every layer re-derives it from the path, and the write ceiling is
    // chosen from that same inference.
    let limits = { default: 5, audio: 20, video: 50 };
    for (let name of [
      'Standup #3.m4a',
      'recording.m4a#',
      'recording.m4a#x',
      'a:b.m4a',
      'meeting 100% done.m4a',
    ]) {
      let safe = toSafeFileName(name);
      assert.strictEqual(
        inferContentType(safe),
        'audio/mp4',
        `${JSON.stringify(name)} is still audio as ${JSON.stringify(safe)}`,
      );
      assert.strictEqual(
        fileSizeLimitFor(safe, limits),
        limits.audio,
        `${JSON.stringify(name)} is held to the audio ceiling`,
      );
    }

    // Without sanitizing, the query/fragment is what costs the file its type:
    // `fileSizeLimitFor` splits on `?`/`#` and is left with no extension.
    assert.strictEqual(
      fileSizeLimitFor('Standup #3.m4a', limits),
      limits.default,
    );
    assert.strictEqual(
      inferContentType('image.png?v=2'),
      'application/octet-stream',
    );
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
      'recording.m4a#',
      'recording.m4a#x',
      'a:b.m4a',
      `${String.fromCharCode(0xa0)}Rec.m4a`,
      'New Recording 3.m4a',
      'Récital.m4a',
      '会議.m4a',
    ]) {
      let safe = toSafeFileName(name);
      let stored = realmPaths.local(realmPaths.fileURL(safe));
      assert.strictEqual(
        stored,
        safe,
        `${JSON.stringify(name)} round trips as ${JSON.stringify(safe)}`,
      );
      // Asserted against the stored path rather than the sanitizer's own
      // return value, which would hold for a sanitizer that did nothing.
      assert.true(
        stored.endsWith('.m4a'),
        `${stored} reaches the realm with its extension`,
      );
    }
  });

  test('every ASCII character survives sanitizing in any position', function (assert) {
    // The character list is derived from what this module does to a name, so it
    // is checked against that behaviour rather than restated: put each ASCII
    // code point in turn at the front, the middle, the end, and just before the
    // extension, and the sanitized name must still be what the realm stores.
    let unstable: string[] = [];
    for (let code = 0; code < 128; code++) {
      let ch = String.fromCharCode(code);
      for (let candidate of [
        `a${ch}b.m4a`,
        `${ch}ab.m4a`,
        `ab.m4a${ch}`,
        `ab${ch}.m4a`,
      ]) {
        let safe = toSafeFileName(candidate);
        let stored: string;
        try {
          stored = realmPaths.local(realmPaths.fileURL(safe));
        } catch (e: any) {
          stored = `threw ${e.message}`;
        }
        if (stored !== safe) {
          unstable.push(
            `0x${code.toString(16)} in ${JSON.stringify(candidate)}: sanitized to ${JSON.stringify(safe)}, stored as ${JSON.stringify(stored)}`,
          );
        }
      }
    }
    assert.deepEqual(unstable, [], 'no ASCII character survives unsanitized');
  });
});
