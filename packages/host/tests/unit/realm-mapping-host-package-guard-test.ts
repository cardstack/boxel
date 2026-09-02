import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';
import {
  HOST_PACKAGE_NAMES,
  isHostPackageSpecifier,
} from '@cardstack/runtime-common/host-package-names';

const TARGET = 'https://realms.example.test/somewhere/';

// `@cardstack/<name>/` is the npm scope and the realm-alias namespace at once,
// and `trusted-modules` admits a specifier under a Host package's name as
// Host-provided — which lets it run uncaged. So a realm registered under such a
// name would have its *authored* content trusted, from configuration alone. The
// registration is the only place that can see the difference between a realm
// and a shimmed package namespace, because nothing downstream can tell them
// apart by looking at the resulting mapping.
module('Unit | realm mapping host-package guard', function () {
  test('a realm may not claim a Host package name', function (assert) {
    let virtualNetwork = new VirtualNetwork();
    for (let name of ['boxel-ui', 'boxel-host', 'runtime-common']) {
      assert.throws(
        () => virtualNetwork.addRealmMapping(`@cardstack/${name}/`, TARGET),
        /is a Host package name/,
        `@cardstack/${name}/ is refused as a realm`,
      );
    }
  });

  test('the base realm is the one permitted overlap', function (assert) {
    // `base` is on the Host package list *and* is a registered realm prefix:
    // the base realm is trusted on its own account, so its alias and its URL
    // agree. A guard that refused it would refuse the base realm itself.
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
    // The classifier decodes before deciding, so `%62oxel-ui` reaches it as
    // `boxel-ui` and is trusted. A guard comparing the raw segment would permit
    // the realm the classifier then trusts — the boundary open again, spelled
    // differently. Both sides ask one shared predicate for exactly this reason.
    let virtualNetwork = new VirtualNetwork();
    assert.true(
      isHostPackageSpecifier('@cardstack/%62oxel-ui/components'),
      'the classifier decodes and trusts it',
    );
    assert.throws(
      () => virtualNetwork.addRealmMapping('@cardstack/%62oxel-ui/', TARGET),
      /is a Host package name/,
      'so the guard refuses it too',
    );
  });

  test('a realm outside the @cardstack scope may hold any name', function (assert) {
    // The classifier trusts nothing outside `@cardstack`, so
    // `@other/boxel-ui/` carries no hazard and refusing it would break a
    // legitimate realm for a name collision that cannot matter.
    let virtualNetwork = new VirtualNetwork();
    assert.false(
      isHostPackageSpecifier('@other/boxel-ui/components'),
      'the classifier does not trust it',
    );
    virtualNetwork.addRealmMapping('@other/boxel-ui/', TARGET);
    assert.strictEqual(
      virtualNetwork.toURL('@other/boxel-ui/thing').href,
      `${TARGET}thing`,
      'and it registers and resolves normally',
    );
  });
});
