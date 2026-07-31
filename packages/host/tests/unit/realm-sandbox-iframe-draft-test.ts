import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type { RealmIframeSandboxRender } from '@cardstack/host/services/realm-sandbox';

module('Unit | realm sandbox iframe draft', function (hooks) {
  setupTest(hooks);

  test('counts each mounted iframe Code preview loader once', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let token = {};

    assert.strictEqual(service.metricsSnapshot().activeCodePreviewLoaders, 0);
    service.registerIframeCodePreviewLoader(token);
    service.registerIframeCodePreviewLoader(token);
    assert.strictEqual(
      service.metricsSnapshot().activeCodePreviewLoaders,
      1,
      'modifier revalidation does not double-count the child Loader',
    );

    service.releaseIframeCodePreviewLoader(token);
    assert.strictEqual(service.metricsSnapshot().activeCodePreviewLoaders, 0);
  });

  test('serves the private Monaco buffer only for its exact module URL', async function (assert) {
    let sandbox = {
      draft: {
        sourceURL: 'https://realm.example/cards/article.gts',
        source: 'export const title = "Unsaved draft";',
        revision: 7,
      },
    } as RealmIframeSandboxRender;
    let service = getService('realm-sandbox') as RealmSandboxService;

    let response = await service.fetchForIframe(
      sandbox,
      'https://realm.example/cards/article.gts?preview-cache-bust=7',
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, sandbox.draft!.source);
    assert.deepEqual(response.headers, [
      ['content-type', 'application/vnd.card+source'],
    ]);
    assert.strictEqual(
      response.url,
      'https://realm.example/cards/article.gts?preview-cache-bust=7',
      'the child Loader keeps the requested module identity',
    );
  });
});
