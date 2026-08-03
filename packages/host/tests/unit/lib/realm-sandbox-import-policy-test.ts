import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import {
  isBaseRealmModule,
  isModuleWithinRealm,
  trustedSandboxImportIdentity,
} from '@cardstack/host/lib/realm-sandbox-import-policy';

module('Unit | realm sandbox import policy', function () {
  test('trusts a canonical Base import', function (assert) {
    let baseModule = new URL('card-api', `${ENV.resolvedBaseRealmURL}/`).href;
    assert.strictEqual(
      trustedSandboxImportIdentity(
        '@cardstack/base/card-api',
        () => baseModule,
      ),
      baseModule,
    );
    assert.true(isBaseRealmModule(baseModule));
    assert.strictEqual(
      trustedSandboxImportIdentity(
        '@cardstack/base/rich-markdown',
        () => 'https://user-realm.example/@cardstack/base/rich-markdown',
      ),
      new URL(
        'rich-markdown',
        `${ENV.resolvedBaseRealmURL.replace(/\/$/, '')}/`,
      ).href,
      'package spelling is canonicalized before a realm-local import map',
    );
  });

  test('rejects traversal spellings before they can mint host authority', function (assert) {
    let escapedModule = new URL(
      '../attacker/evil.gts',
      `${ENV.resolvedBaseRealmURL}/`,
    ).href;
    for (let specifier of [
      '@cardstack/base/../attacker/evil.gts',
      '@cardstack/base/%2e%2e/attacker/evil.gts',
      'https://cardstack.com/base/../attacker/evil.gts',
    ]) {
      assert.strictEqual(
        trustedSandboxImportIdentity(specifier, () => escapedModule),
        undefined,
        `${specifier} is not trusted`,
      );
      assert.false(isBaseRealmModule(specifier));
    }
  });

  test('realm containment is path-segment anchored', function (assert) {
    assert.true(
      isModuleWithinRealm(
        'https://realm.example/base/cards/example.gts',
        'https://realm.example/base',
      ),
    );
    assert.false(
      isModuleWithinRealm(
        'https://realm.example/base-tenant/cards/example.gts',
        'https://realm.example/base',
      ),
    );
    assert.false(
      isModuleWithinRealm(
        'https://realm.example/base/../private/example.gts',
        'https://realm.example/base',
      ),
    );
  });
});
