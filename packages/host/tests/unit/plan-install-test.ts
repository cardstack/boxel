import { module, test } from 'qunit';

import { planInstall } from '@cardstack/host/commands/listing-install';

module('Unit | Listing Installer', function () {
  test('base example', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some.gts`,
      },
      {
        ref: { name: 'Some Ref Name 2' },
        moduleHref: `${sourceRealmURL}some-2.gts`,
      },
      {
        ref: { name: 'Some Ref Name 3' },
        moduleHref: `${sourceRealmURL}some-2.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL, {
      dirName: 'some-uuid',
    });

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

  test('installing code from a source directory into root of target realm', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some-folder/some.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL);

    assert.strictEqual(res.length, 1);

    assert.strictEqual(res[0].sourceCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].sourceCodeRef.module,
      `${sourceRealmURL}some-folder/some.gts`,
    );
    assert.strictEqual(res[0].targetCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].targetCodeRef.module,
      `${targetRealmURL}some-folder/some.gts`,
    );
  });

  test('installing code from a source directory into a target directory', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some-folder/some.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL, {
      dirName: 'some-uuid',
    });

    assert.strictEqual(res.length, 1);

    assert.strictEqual(res[0].sourceCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].sourceCodeRef.module,
      `${sourceRealmURL}some-folder/some.gts`,
    );
    assert.strictEqual(res[0].targetCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some-folder/some.gts`,
    );
  });

  test('installing code from a source directory but splat into a target directory', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some-folder/some.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL, {
      dirName: 'some-uuid',
      sourceDir: `${sourceRealmURL}some-folder/`,
    });

    assert.strictEqual(res.length, 1);

    assert.strictEqual(res[0].sourceCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].sourceCodeRef.module,
      `${sourceRealmURL}some-folder/some.gts`,
    );
    assert.strictEqual(res[0].targetCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some.gts`,
    );
  });

  test('installing code from a source directory which has code dependent inside another directory into root of realm', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some-folder/some.gts`,
      },
      {
        ref: { name: 'Some Ref Name 2' },
        moduleHref: `${sourceRealmURL}some-other-folder/some-needs-this.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL, {
      sourceDir: `${sourceRealmURL}some-folder/`,
    });

    assert.strictEqual(res.length, 2);

    assert.strictEqual(res[0].sourceCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].sourceCodeRef.module,
      `${sourceRealmURL}some-folder/some.gts`,
    );
    assert.strictEqual(res[0].targetCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].targetCodeRef.module,
      `${targetRealmURL}some-folder/some.gts`,
    );

    assert.strictEqual(res[1].sourceCodeRef.name, 'Some Ref Name 2');
    assert.strictEqual(
      res[1].sourceCodeRef.module,
      `${sourceRealmURL}some-other-folder/some-needs-this.gts`,
    );
    assert.strictEqual(res[1].targetCodeRef.name, 'Some Ref Name 2');
    assert.strictEqual(
      res[1].targetCodeRef.module,
      `${targetRealmURL}some-other-folder/some-needs-this.gts`,
    );
  });

  test('installing code from a source directory which has code dependent inside another directory into a target directory', function (assert) {
    const sourceRealmURL = 'http://localhost:4201/catalog/';
    const targetRealmURL = 'http://localhost:4201/experiments/';
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL}some-folder/some.gts`,
      },
      {
        ref: { name: 'Some Ref Name 2' },
        moduleHref: `${sourceRealmURL}some-other-folder/some-needs-this.gts`,
      },
    ];
    const res = planInstall(specs, sourceRealmURL, targetRealmURL, {
      dirName: 'some-uuid',
      sourceDir: `${sourceRealmURL}some-folder/`,
    });

    assert.strictEqual(res.length, 2);

    assert.strictEqual(res[0].sourceCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].sourceCodeRef.module,
      `${sourceRealmURL}some-folder/some.gts`,
    );
    assert.strictEqual(res[0].targetCodeRef.name, 'Some Ref Name');
    assert.strictEqual(
      res[0].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some-folder/some.gts`,
    );

    assert.strictEqual(res[1].sourceCodeRef.name, 'Some Ref Name 2');
    assert.strictEqual(
      res[1].sourceCodeRef.module,
      `${sourceRealmURL}some-other-folder/some-needs-this.gts`,
    );
    assert.strictEqual(res[1].targetCodeRef.name, 'Some Ref Name 2');
    assert.strictEqual(
      res[1].targetCodeRef.module,
      `${targetRealmURL}some-uuid/some-other-folder/some-needs-this.gts`,
    );
  });
});
