import { module, test } from 'qunit';
import { basename } from 'path';
import { systemInitiatedPriority } from '@cardstack/runtime-common';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm Server Endpoints (not specific to one realm)', function (hooks) {
    let context = setupServerEndpointsTest(hooks);

    test('startup indexing uses system initiated queue priority', async function (assert) {
      let [job] = (await context.dbAdapter.execute(
        `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${testRealm2URL.href}' ORDER BY created_at DESC LIMIT 1`,
      )) as { priority: number }[];

      assert.ok(job, 'found startup from-scratch index job for realm');
      assert.strictEqual(
        job.priority,
        systemInitiatedPriority,
        'realm startup uses system initiated priority',
      );
    });

    test('serves isolated HTML in index responses for card URLs', async function (assert) {
      let cardURL = new URL('isolated-test', testRealm2URL).href;
      let isolatedHTML = '<div data-test-isolated-html>Isolated HTML</div>';

      await context.dbAdapter.execute(
        `INSERT INTO boxel_index_working (url, file_alias, type, realm_version, realm_url, isolated_html)
         VALUES ('${cardURL}', '${cardURL}', 'instance', 1, '${testRealm2URL.href}', '${isolatedHTML}')`,
      );

      let response = await context.request2
        .get('/test/isolated-test')
        .set('Accept', 'text/html');

      assert.strictEqual(response.status, 200, 'serves HTML response');
      assert.ok(
        response.text.includes('data-test-isolated-html'),
        'isolated HTML is injected into the HTML response',
      );
    });

    test('does not inject head or isolated HTML when realm is not public', async function (assert) {
      let cardURL = new URL('private-index-test', testRealm2URL).href;
      let headHTML = '<meta data-test-head-html content="private-head" />';
      let isolatedHTML =
        '<div data-test-isolated-html>Private isolated HTML</div>';

      await context.dbAdapter.execute(
        `INSERT INTO boxel_index_working (url, file_alias, type, realm_version, realm_url, head_html, isolated_html)
         VALUES ('${cardURL}', '${cardURL}', 'instance', 1, '${testRealm2URL.href}', '${headHTML}', '${isolatedHTML}')`,
      );

      await context.dbAdapter.execute(
        `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealm2URL.href}' AND username = '*'`,
      );

      let response = await context.request2
        .get('/test/private-index-test')
        .set('Accept', 'text/html');

      assert.strictEqual(response.status, 200, 'serves HTML response');
      assert.notOk(
        response.text.includes('data-test-head-html'),
        'head HTML is not injected into the HTML response',
      );
      assert.notOk(
        response.text.includes('data-test-isolated-html'),
        'isolated HTML is not injected into the HTML response',
      );
    });

    test('serves scoped CSS in index responses for card URLs', async function (assert) {
      let cardURL = new URL('scoped-css-test', testRealm2URL).href;
      let scopedCSS = '.layout{display:flex;}';
      let encodedCSS = encodeURIComponent(
        Buffer.from(scopedCSS).toString('base64'),
      );
      let deps = JSON.stringify([
        `https://cardstack.com/base/card-api.gts.${encodedCSS}.glimmer-scoped.css`,
      ]);

      await context.dbAdapter.execute(
        `INSERT INTO boxel_index_working (url, file_alias, type, realm_version, realm_url, deps)
         VALUES ('${cardURL}', '${cardURL}', 'instance', 1, '${testRealm2URL.href}', '${deps}'::jsonb)`,
      );

      let response = await context.request2
        .get('/test/scoped-css-test')
        .set('Accept', 'text/html');

      assert.strictEqual(response.status, 200, 'serves HTML response');
      assert.ok(
        response.text.includes('data-boxel-scoped-css'),
        'scoped CSS style tag is injected into the HTML response',
      );
      assert.ok(
        response.text.includes(scopedCSS),
        'scoped CSS is included in the HTML response',
      );
    });

    test('returns 404 for request that has malformed URI', async function (assert) {
      let response = await context.request2.get('/%c0').set('Accept', '*/*');
      assert.strictEqual(response.status, 404, 'HTTP 404 status');
    });
  });
});
