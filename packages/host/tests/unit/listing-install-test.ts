import { module, test } from 'qunit';

import { planInstall } from '@cardstack/host/commands/listing-install';

module('Unit | Listing Installer', function () {
  test('base', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        id: `${sourceRealmURL}some-spec-id`,
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some.gts`,
      },
      {
        id: `${sourceRealmURL}some-spec-id-2`,
        ref: { name: 'Some Ref Name 2' },
        moduleHref: `${sourceRealmURL}some-2.gts`,
      },
      {
        id: `${sourceRealmURL}some-spec-id-3`,
        ref: { name: 'Some Ref Name 3' },
        moduleHref: `${sourceRealmURL}some-2.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL, 'some-uuid');

    assert.strictEqual(res.length, 3);

    assert.strictEqual(res[0].sourceCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].sourceCodeRef.module,
      `${sourceRealmURL}some.gts`,
    );
    assert.strictEqual(res[0].targetCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some.gts`,
    );

    assert.strictEqual(res[1].sourceCodeRef.name, 'Some Ref Name 2');
    assert.strictEqual(
      res[1].sourceCodeRef.module,
      `${sourceRealmURL}some-2.gts`,
    );
    assert.strictEqual(res[1].targetCodeRef.name, 'Some Ref Name 2');
    assert.strictEqual(
      res[1].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some-2.gts`,
    );

    assert.strictEqual(res[2].sourceCodeRef.name, 'Some Ref Name 3');
    assert.strictEqual(
      res[2].sourceCodeRef.module,
      `${sourceRealmURL}some-2.gts`,
    );
    assert.strictEqual(res[2].targetCodeRef.name, 'Some Ref Name 3');
    assert.strictEqual(
      res[2].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some-2.gts`,
    );
  });
});
