import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader, baseRealm } from '@cardstack/runtime-common';

import { lookupLoaderService } from '../helpers';
import { setupRenderingTest } from '../helpers/setup';

let cardApi: typeof import('https://cardstack.com/base/card-api');

let loader: Loader;

module('Unit | box', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = lookupLoaderService().loader;
  });
  hooks.beforeEach(async function () {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
  });

  test('Box children maintain object strict equality after re-ordering', async function (assert) {
    let { Box } = cardApi;
    let parentCardModel = {
      someField: [],
    };
    let childCard1Model = {};
    let childCard2Model = {};
    let childCard3Model = {};
    let box = Box.create(parentCardModel);
    let boxArr = box.field('someField');
    let childValues: any = [childCard1Model, childCard2Model, childCard3Model];
    boxArr.set(childValues);
    assert.strictEqual(boxArr.children[0].value, childCard1Model);
    assert.strictEqual(boxArr.children[1].value, childCard2Model);
    assert.strictEqual(boxArr.children[2].value, childCard3Model);
    assert.strictEqual(boxArr.children[0].name, '0');
    assert.strictEqual(boxArr.children[1].name, '1');
    assert.strictEqual(boxArr.children[2].name, '2');

    let childValuesReordered: any = [
      childCard2Model,
      childCard3Model,
      childCard1Model,
    ];
    boxArr.set(childValuesReordered);
    assert.strictEqual(boxArr.children[0].value, childCard2Model);
    assert.strictEqual(boxArr.children[1].value, childCard3Model);
    assert.strictEqual(boxArr.children[2].value, childCard1Model);
    assert.strictEqual(boxArr.children[0].name, '0');
    assert.strictEqual(boxArr.children[1].name, '1');
    assert.strictEqual(boxArr.children[2].name, '2');
  });
});
