import { module, test } from 'qunit';

import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import {
  isTrustedImport,
  isTrustedModule,
} from '@cardstack/host/lib/trusted-modules';

module('Unit | trusted modules', function () {
  test('bare Cardstack packages reject traversal spellings', function (assert) {
    assert.true(isTrustedModule('@cardstack/base/card-api'));
    assert.true(isTrustedModule('@cardstack/boxel-ui/components'));

    for (let identifier of [
      '@cardstack/base/../private/card',
      '@cardstack/base/%2e%2e/private/card',
      '@cardstack/base/%252e%252e/private/card',
      '@cardstack/base/..%2fprivate/card',
      '@cardstack/base\\..\\private\\card',
      '@cardstackish/base/card-api',
    ]) {
      assert.false(
        isTrustedModule(identifier),
        `${identifier} is not a trusted package spelling`,
      );
      assert.false(
        isTrustedImport(identifier),
        `${identifier} is not a Host-provided import`,
      );
    }
  });

  test('URL trust is canonical and path-bounded', function (assert) {
    assert.true(
      isTrustedModule('https://cardstack.com/base/card-api'),
      'the canonical Base realm is trusted',
    );
    assert.false(
      isTrustedModule('https://cardstack.com/base-evil/card-api'),
      'a prefix lookalike is not trusted',
    );
    assert.false(
      isTrustedModule('https://cardstack.com/base/../private/card'),
      'URL normalization cannot escape the trusted Base root',
    );
  });

  test('Host-provided imports are distinct from Direct module trust', function (assert) {
    assert.true(isTrustedImport('@glimmer/component'));
    assert.true(
      isTrustedImport(`${PACKAGES_FAKE_ORIGIN}ember-provide-consume-context`),
      'the resolved exact package facade remains Host-provided',
    );
    assert.false(
      isTrustedModule('@glimmer/component'),
      'a framework facade is provided to a compartment without making an authored card Direct-trusted',
    );
  });
});
