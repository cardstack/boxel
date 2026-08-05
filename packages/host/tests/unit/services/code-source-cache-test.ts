import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type CodeSourceCacheService from '@cardstack/host/services/code-source-cache';
import type SessionService from '@cardstack/host/services/session';

const source = {
  content: 'export class Example {}',
  lastModified: 'now',
  realmURL: 'https://example.test/realm/',
};

module('Unit | Service | code-source-cache', function (hooks) {
  setupTest(hooks);

  test('keeps aliases identity-stable and clears them with the session', function (assert) {
    let cache = this.owner.lookup(
      'service:code-source-cache',
    ) as CodeSourceCacheService;
    let session = this.owner.lookup('service:session') as SessionService;

    let canonical = cache.remember(
      'https://example.test/canonical.gts',
      source,
    );
    let alias = cache.remember('https://example.test/alias.gts', canonical);

    assert.strictEqual(alias, canonical, 'an alias reuses the same snapshot');
    assert.strictEqual(
      cache.sourceFor('https://example.test/alias.gts'),
      canonical,
      'the alias is available synchronously',
    );

    session.notifySessionEnded();
    assert.strictEqual(
      cache.sourceFor('https://example.test/alias.gts'),
      undefined,
      'source bytes do not cross a sign-out boundary',
    );
  });

  test('bounds the number of remembered source files', function (assert) {
    let cache = this.owner.lookup(
      'service:code-source-cache',
    ) as CodeSourceCacheService;

    for (let i = 0; i < 49; i++) {
      cache.remember(`https://example.test/${i}.gts`, {
        ...source,
        content: `export class Example${i} {}`,
      });
    }

    assert.strictEqual(
      cache.sourceFor('https://example.test/0.gts'),
      undefined,
      'the least-recent entry is evicted',
    );
    assert.ok(
      cache.sourceFor('https://example.test/48.gts'),
      'the newest entry remains available',
    );
  });
});
