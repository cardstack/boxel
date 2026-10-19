import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { ri, type DeckLibSpec } from '@cardstack/runtime-common';

import type DeckAdoptionService from '@cardstack/host/services/deck-adoption';

const targetRealm = ri('@alex/dispatch/');
const targetRealmURL = 'https://boxel.test/alex/dispatch/';
const dashboard: DeckLibSpec = {
  packageRRI: '@catalog/dispatch-dashboard@3.4.0/',
  specifier: '@catalog/dispatch-dashboard',
  entry: 'app/dashboard.js',
  lock: {
    imports: {
      '@catalog/charts': '@catalog/charts@2.8.1/index.js',
      '@catalog/theme': '@catalog/theme@1.6.0/index.js',
    },
    scopes: {},
  },
};

interface RecordedWrite {
  url: string;
  content: string;
  type: string;
}

class StubRealmService extends Service {
  realmOf() {
    return targetRealm;
  }
}

class StubNetworkService extends Service {
  virtualNetwork = {
    toURL(identifier: string) {
      if (identifier !== targetRealm) {
        throw new Error(`unexpected realm identifier: ${identifier}`);
      }
      return new URL(targetRealmURL);
    },
  };
}

function setupDeckAdoption(hooks: NestedHooks) {
  let sources: Map<string, { status: number; content: string }>;
  let reads: string[];
  let writes: RecordedWrite[];

  hooks.beforeEach(function () {
    sources = new Map();
    reads = [];
    writes = [];

    class StubCardService extends Service {
      async getSource(url: URL) {
        reads.push(url.href);
        return (
          sources.get(url.href) ?? {
            status: 404,
            content: '',
            contentType: null,
          }
        );
      }

      async saveSource(url: URL, content: string, type: string) {
        writes.push({ url: url.href, content, type });
      }
    }

    this.owner.register('service:realm', StubRealmService);
    this.owner.register('service:network', StubNetworkService);
    this.owner.register('service:card-service', StubCardService);
  });

  return {
    sources: () => sources,
    reads: () => reads,
    writes: () => writes,
  };
}

module('Unit | Service | deck-adoption', function (hooks) {
  setupTest(hooks);
  let recording = setupDeckAdoption(hooks);

  test('Use selects an exact product without reading or writing a realm', async function (assert) {
    let service = this.owner.lookup(
      'service:deck-adoption',
    ) as DeckAdoptionService;

    let plan = await service.adopt({ verb: 'use', spec: dashboard });

    assert.strictEqual(
      plan.selected,
      '@catalog/dispatch-dashboard@3.4.0/app/dashboard.js',
    );
    assert.deepEqual(recording.reads(), []);
    assert.deepEqual(recording.writes(), []);
    assert.deepEqual(plan.filesToCopy, []);
  });

  test('Install updates one canonical decklist and preserves existing pins', async function (assert) {
    recording.sources().set(`${targetRealmURL}importmap.json`, {
      status: 200,
      content: JSON.stringify({
        imports: { '@local/session': '@local/session@1.0.0/index.js' },
        scopes: {},
      }),
    });
    let service = this.owner.lookup(
      'service:deck-adoption',
    ) as DeckAdoptionService;

    let plan = await service.adopt({
      verb: 'install',
      targetRealm,
      spec: dashboard,
    });

    assert.deepEqual(plan.filesToCopy, []);
    assert.strictEqual(recording.writes().length, 1);
    assert.deepEqual(recording.writes()[0], {
      url: `${targetRealmURL}importmap.json`,
      content: `${JSON.stringify(plan.effectiveLock, null, 2)}\n`,
      type: 'editor',
    });
    assert.strictEqual(
      plan.effectiveLock.imports['@local/session'],
      '@local/session@1.0.0/index.js',
    );
  });

  test('Remix authors only inheritance and explicit overrides', async function (assert) {
    let service = this.owner.lookup(
      'service:deck-adoption',
    ) as DeckAdoptionService;

    let plan = await service.adopt({
      verb: 'remix',
      targetRealm,
      spec: dashboard,
      overrides: {
        imports: { '@catalog/theme': '@alex/theme@1.0.0/index.js' },
        scopes: {},
      },
    });

    assert.deepEqual(plan.filesToCopy, []);
    assert.strictEqual(recording.writes().length, 1);
    assert.deepEqual(recording.writes()[0], {
      url: `${targetRealmURL}importmap.json`,
      content: `${JSON.stringify(
        {
          imports: { '@catalog/theme': '@alex/theme@1.0.0/index.js' },
          scopes: {},
          deck: { extends: '@catalog/dispatch-dashboard@3.4.0/' },
        },
        null,
        2,
      )}\n`,
      type: 'create-file',
    });
    assert.strictEqual(
      plan.effectiveLock.imports['@catalog/charts'],
      '@catalog/charts@2.8.1/index.js',
      'unchanged dependencies stay inherited',
    );
  });
});
