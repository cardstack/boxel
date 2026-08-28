import { module, test } from 'qunit';

import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import config from '@cardstack/host/config/environment';

import {
  documentExecutionModeFor,
  isTrustedImport,
  isTrustedModule,
} from '@cardstack/host/lib/trusted-modules';

module('Unit | trusted modules', function () {
  test('document execution is Direct only for trusted modules', function (assert) {
    assert.strictEqual(
      documentExecutionModeFor('@cardstack/base/card-api'),
      'direct',
      'Host-owned package modules execute Direct',
    );
    assert.strictEqual(
      documentExecutionModeFor(config.resolvedBaseRealmURL + 'card-api'),
      'direct',
      'the configured Base realm executes Direct',
    );
    assert.strictEqual(
      documentExecutionModeFor(
        'https://realms-staging.stack.cards/ctse/example/card',
      ),
      'sandbox',
      'authored realm modules execute in Sandbox regardless of their source',
    );
    assert.strictEqual(
      documentExecutionModeFor('@glimmer/component'),
      'sandbox',
      'a Host-provided dependency is not itself a Direct entry grant',
    );
  });

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

  test('deployment grants trust exact module identities only', function (assert) {
    let previous = config.boxelExecutionTrustedModules;
    config.boxelExecutionTrustedModules = [
      'https://realm.example/trusted-card',
    ];
    try {
      assert.true(isTrustedModule('https://realm.example/trusted-card'));
      assert.false(
        isTrustedModule('https://realm.example/trusted-card/child'),
        'a module grant is not a realm or path-prefix grant',
      );
      assert.false(
        isTrustedModule('https://realm.example/other-card'),
        'neighboring authored modules remain untrusted',
      );
    } finally {
      config.boxelExecutionTrustedModules = previous;
    }
  });

  test('Host-provided imports are distinct from Direct module trust', function (assert) {
    assert.true(isTrustedImport('@glimmer/component'));
    assert.true(isTrustedImport('@ember/destroyable'));
    assert.true(
      isTrustedImport(`${PACKAGES_FAKE_ORIGIN}@ember/destroyable`),
      'resolved Ember facades remain Host-provided graph leaves',
    );
    assert.true(isTrustedImport('ember-modifier'));
    assert.true(
      isTrustedImport(`${PACKAGES_FAKE_ORIGIN}ember-provide-consume-context`),
      'the resolved exact package facade remains Host-provided',
    );
    assert.true(
      isTrustedImport(`${config.resolvedCatalogRealmURL}catalog-entry`),
      'Catalog is a Host-provided platform dependency',
    );
    assert.true(
      isTrustedImport(`${config.resolvedSkillsRealmURL}skill`),
      'Skills is a Host-provided platform dependency',
    );
    if (config.resolvedOpenRouterRealmURL) {
      assert.true(
        isTrustedImport(`${config.resolvedOpenRouterRealmURL}openrouter-model`),
        'OpenRouter is a Host-provided platform dependency',
      );
    }
    assert.strictEqual(
      documentExecutionModeFor(`${config.resolvedSkillsRealmURL}skill`),
      'sandbox',
      'a platform dependency grant does not make its documents Direct entry points',
    );
    assert.false(
      isTrustedModule('@glimmer/component'),
      'a framework facade is provided to a compartment without making an authored card Direct-trusted',
    );
    assert.false(
      isTrustedImport('@ember/../attacker'),
      'framework namespace trust remains path-bounded',
    );
    assert.false(
      isTrustedImport('ember-not-installed-by-the-host'),
      'an arbitrary Ember-looking package is not a Host-provided leaf',
    );
  });
});
