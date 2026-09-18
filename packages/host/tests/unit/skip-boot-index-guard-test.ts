import { module, test } from 'qunit';

import { guardIndexReads } from '../helpers';

const realmURL = 'https://test-realm/test/';

function guarded(contents: Record<string, unknown>) {
  let reached: string[] = [];
  let handler = guardIndexReads(
    async (request: Request) => {
      reached.push(request.url);
      return null;
    },
    realmURL,
    contents as never,
  );
  return { handler, reached };
}

module('Unit | skipBootIndex index-read guard', function () {
  test('refuses a read of a seeded instance', async function (assert) {
    let { handler } = guarded({ 'Person/hassan.json': {} });
    await assert.rejects(
      handler(new Request(`${realmURL}Person/hassan`)),
      /skipBootIndex/,
      'names the option that caused it',
    );
  });

  test('refuses the read whether or not the id carries .json', async function (assert) {
    let { handler } = guarded({ 'Person/hassan.json': {} });
    await assert.rejects(
      handler(new Request(`${realmURL}Person/hassan.json`)),
      /skipBootIndex/,
    );
  });

  test('refuses a search, which cannot match an unbuilt index', async function (assert) {
    let { handler } = guarded({ 'Person/hassan.json': {} });
    await assert.rejects(
      handler(new Request(`${realmURL}_search?filter=x`)),
      /skipBootIndex/,
    );
  });

  test('allows a source read, which is served from the adapter', async function (assert) {
    let { handler, reached } = guarded({ 'Person/hassan.json': {} });
    await handler(
      new Request(`${realmURL}Person/hassan`, {
        headers: { accept: 'application/vnd.card+source' },
      }),
    );
    assert.deepEqual(reached, [`${realmURL}Person/hassan`]);
  });

  test('allows a read of an instance written during the test', async function (assert) {
    // Not in the seeded contents, so incremental indexing covers it.
    let { handler, reached } = guarded({ 'Person/hassan.json': {} });
    await handler(new Request(`${realmURL}Person/written-later`));
    assert.deepEqual(reached, [`${realmURL}Person/written-later`]);
  });

  test('allows a module read', async function (assert) {
    let { handler, reached } = guarded({ 'person.gts': 'export class {}' });
    await handler(new Request(`${realmURL}person.gts`));
    assert.deepEqual(reached, [`${realmURL}person.gts`]);
  });
});
