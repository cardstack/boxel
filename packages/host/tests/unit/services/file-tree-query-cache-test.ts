import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { rri, type SearchEntryWireQuery } from '@cardstack/runtime-common';

import type FileTreeQueryCacheService from '@cardstack/host/services/file-tree-query-cache';
import type SessionService from '@cardstack/host/services/session';

const query: SearchEntryWireQuery = {
  filter: {
    'item.on': {
      module: rri('https://cardstack.com/base/markdown-file-def'),
      name: 'MarkdownDef',
    },
    eq: { 'item.kind': 'skill' },
  },
  fields: { entry: ['item.name'] },
};

class StoreStub extends Service {
  calls = 0;

  async searchEntries() {
    this.calls++;
    return {
      data: [
        {
          id: 'https://realm.example/skills/source-editing/SKILL.md',
          type: 'card',
        },
      ],
    };
  }
}

module('Unit | Service | file-tree-query-cache', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.owner.register('service:store', StoreStub);
  });

  test('deduplicates filtered index queries and clears them at the session boundary', async function (assert) {
    let cache = this.owner.lookup(
      'service:file-tree-query-cache',
    ) as FileTreeQueryCacheService;
    let store = this.owner.lookup('service:store') as unknown as StoreStub;
    let session = this.owner.lookup('service:session') as SessionService;
    let realmURL = 'https://realm.example/';

    let first = await cache.load(realmURL, query);
    let second = await cache.load(realmURL, {
      fields: { entry: ['item.name'] },
      filter: {
        eq: { 'item.kind': 'skill' },
        'item.on': {
          name: 'MarkdownDef',
          module: rri('https://cardstack.com/base/markdown-file-def'),
        },
      },
    });

    assert.strictEqual(
      first,
      second,
      'equivalent query objects share a result',
    );
    assert.strictEqual(store.calls, 1, 'the index is queried once');

    await cache.load(realmURL, query, { force: true });
    assert.strictEqual(store.calls, 2, 'an index event can force revalidation');

    session.notifySessionEnded();
    assert.strictEqual(
      cache.peek(realmURL, query),
      undefined,
      'file names do not cross an authentication boundary',
    );
  });
});
