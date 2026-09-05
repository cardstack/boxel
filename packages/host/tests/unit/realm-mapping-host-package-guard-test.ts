import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';
import {
  HOST_PACKAGE_NAMES,
  hostPackageNameOf,
} from '@cardstack/runtime-common/host-package-names';

const TARGET = 'https://realms.example.test/somewhere/';

// `@cardstack/<name>/` is the npm scope and the realm-alias namespace at once,
// and both kinds of registration are stored under that one prefix — so a realm
// registered under a Host package's name replaces it rather than sitting beside
// it, from configuration alone. The registration is the only place that can
// refuse that, because the mapping it produces is the same shape either way.
module('Unit | realm mapping host-package guard', function () {
  test('a realm may not claim a Host package name', function (assert) {
    let virtualNetwork = new VirtualNetwork();
    // Driven from the list so a name added to it is covered without this file
    // being touched.
    for (let name of [...HOST_PACKAGE_NAMES].filter((n) => n !== 'base')) {
      assert.throws(
        () => virtualNetwork.addRealmMapping(`@cardstack/${name}/`, TARGET),
        /is a Host package name/,
        `@cardstack/${name}/ is refused as a realm`,
      );
    }
  });

  test('the base realm is the one permitted overlap', function (assert) {
    // `base` is on the Host package list *and* is a registered realm prefix:
    // the base realm is what `@cardstack/base` resolves to, so its alias and
    // its URL agree. A guard that refused it would refuse the base realm itself.
    let virtualNetwork = new VirtualNetwork();
    assert.true(
      HOST_PACKAGE_NAMES.has('base'),
      'base is on the Host package list',
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', TARGET);
    assert.true(
      virtualNetwork.isRegisteredPrefix('@cardstack/base/'),
      'and registering it as a realm is permitted',
    );
  });

  test('a package namespace may claim one, and resolves the same way', function (assert) {
    // The boxel-ui shim is exactly this case, and it has to keep resolving:
    // `CodeRef.moduleHref` on `@cardstack/boxel-ui/components` depends on it.
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addPackageMapping('@cardstack/boxel-ui/', TARGET);
    assert.true(
      virtualNetwork.isRegisteredPrefix('@cardstack/boxel-ui/'),
      'the package namespace is registered',
    );
    assert.strictEqual(
      virtualNetwork.toURL('@cardstack/boxel-ui/components').href,
      `${TARGET}components`,
      'and resolves identically to a realm mapping',
    );
  });

  test('a realm whose name is not a Host package is unaffected', function (assert) {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping('@cardstack/catalog/', TARGET);
    assert.strictEqual(
      virtualNetwork.toURL('@cardstack/catalog/listing').href,
      `${TARGET}listing`,
      'ordinary realm prefixes register and resolve as before',
    );
  });
  test('an encoded name cannot slip past the guard', function (assert) {
    // The predicate decodes before deciding, so `%62oxel-ui` reaches it as
    // `boxel-ui`. A guard comparing the raw segment would permit the realm under
    // an encoded spelling of the same name — the same prefix taken, spelled
    // differently.
    let virtualNetwork = new VirtualNetwork();
    assert.strictEqual(
      hostPackageNameOf('@cardstack/%62oxel-ui/components'),
      'boxel-ui',
      'the predicate decodes it to a Host package name',
    );
    assert.throws(
      () => virtualNetwork.addRealmMapping('@cardstack/%62oxel-ui/', TARGET),
      /is a Host package name/,
      'so the guard refuses it too',
    );
  });

  test('a realm outside the @cardstack scope may hold any name', function (assert) {
    // Host packages live only under `@cardstack`, so `@other/boxel-ui/` takes
    // no prefix from one, and refusing it would break a legitimate realm for a
    // name collision that cannot matter.
    let virtualNetwork = new VirtualNetwork();
    assert.strictEqual(
      hostPackageNameOf('@other/boxel-ui/components'),
      undefined,
      'it names no Host package',
    );
    virtualNetwork.addRealmMapping('@other/boxel-ui/', TARGET);
    assert.strictEqual(
      virtualNetwork.toURL('@other/boxel-ui/thing').href,
      `${TARGET}thing`,
      'and it registers and resolves normally',
    );
  });
  test('an encoded spelling of base is refused', function (assert) {
    // The exemption is the literal prefix, not the name. A mapping is stored
    // and matched under the raw spelling, so exempting by name would let
    // `@cardstack/%62ase/` resolve to any target while still decoding to
    // `base` — an encoded spelling of the base realm pointing somewhere else
    // entirely. Reachable from config: `main.ts` hands the raw segment of a
    // `https://cardstack.com/<name>/` alias straight to `addRealmMapping`.
    let virtualNetwork = new VirtualNetwork();
    for (let spelling of [
      '@cardstack/%62ase/',
      '@cardstack/bas%65/',
      '@cardstack/%62%61se/',
    ]) {
      assert.strictEqual(
        hostPackageNameOf(`${spelling}evil-card`),
        'base',
        `${spelling} decodes to a Host package name`,
      );
      assert.throws(
        () => virtualNetwork.addRealmMapping(spelling, TARGET),
        /is a Host package name/,
        `${spelling} is refused as a realm`,
      );
    }
  });

  test('the @cardstack scope admits only declared realms', function (assert) {
    // The launch-script scan cannot see a prefix that never appears literally
    // in a scanned file, and `main.ts` derives one from any
    // `https://cardstack.com/<name>/` value however it arrived — an env var
    // included. This is where that is caught.
    let virtualNetwork = new VirtualNetwork();
    assert.throws(
      () =>
        virtualNetwork.addRealmMapping('@cardstack/software-factory/', TARGET),
      /reserved for the realms PREFIX_REALMS declares/,
      'an undeclared @cardstack realm is refused',
    );
    for (let declared of ['@cardstack/catalog/', '@cardstack/skills/']) {
      virtualNetwork.addRealmMapping(declared, TARGET);
      assert.true(
        virtualNetwork.isRegisteredPrefix(declared),
        `${declared} is declared and registers`,
      );
    }
  });
});
