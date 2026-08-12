import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { parseRealmPackageAlias } from '../handlers/handle-realm-package-alias.ts';

module(basename(import.meta.filename), function () {
  module('the realm-relative package address', function () {
    test('it reads the realm, the package, the version and the rest', function (assert) {
      assert.deepEqual(parseRealmPackageAlias('/experiments/@crm@2.0.0'), {
        prefix: '/experiments',
        key: 'crm',
        version: '2.0.0',
        rest: '',
      });
      assert.deepEqual(
        parseRealmPackageAlias('/experiments/@crm@2.0.0/account'),
        {
          prefix: '/experiments',
          key: 'crm',
          version: '2.0.0',
          rest: 'account',
        },
      );
      assert.deepEqual(
        parseRealmPackageAlias('/experiments/@crm@2.0.0/cards/lead.gts'),
        {
          prefix: '/experiments',
          key: 'crm',
          version: '2.0.0',
          rest: 'cards/lead.gts',
        },
      );
    });

    test('an ordinary realm path is not an alias', function (assert) {
      // The cost of a false positive here is not a 404 — it is this handler
      // swallowing a path that belongs to the realm's own router. A card
      // called `notes@home.gts` is a legal realm path and must stay one.
      for (let path of [
        '/experiments/AccountCard.gts',
        '/experiments/notes@home.gts',
        '/experiments/index.json',
        // The serve door itself. It carries an `@` and sits under a realm, so
        // it is the closest thing to an alias that is not one — and this
        // handler swallowing it would break every module load in the realm.
        '/experiments/_packages/lib/palette@4.1.0/index.js',
        '/experiments/_source/lib/palette@4.1.0/index.gts',
      ]) {
        assert.strictEqual(
          parseRealmPackageAlias(path),
          undefined,
          `${path} is not an alias`,
        );
      }
    });

    test('a key may not hide a second @ or a slash', function (assert) {
      // `@a@b@c` is ambiguous about where the version starts, and guessing
      // would publish under a name nobody wrote.
      assert.strictEqual(parseRealmPackageAlias('/r/@a@b@c'), undefined);
      // A version, however, may carry a prerelease.
      assert.strictEqual(
        parseRealmPackageAlias('/r/@crm@2.0.0-dev.7')?.version,
        '2.0.0-dev.7',
      );
    });
  });
});
