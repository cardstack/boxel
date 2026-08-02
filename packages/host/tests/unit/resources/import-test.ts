import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import { loadModule } from '@cardstack/host/resources/import';

module('Unit | resource | import', function () {
  test('preserves the loader failure status when its diagnostic fetch succeeds', async function (assert) {
    let url = 'https://realm.example/new-card.gts';
    let loader = new Loader(async () =>
      Promise.resolve(new Response('not found', { status: 404 })),
    );

    let result = await loadModule(url, loader, async () =>
      Promise.resolve(
        new Response('compiled source is now visible', { status: 200 }),
      ),
    );

    assert.true('error' in result, 'the failed module evaluation is reported');
    if ('error' in result) {
      assert.strictEqual(
        result.error.status,
        404,
        'callers can distinguish a transient newly-created-module 404',
      );
    }
  });
});
