import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';
import WriteBinaryFileTool from '@cardstack/host/tools/write-binary-file';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let fetch: NetworkService['fetch'];

// A tiny valid PNG (1x1 transparent pixel) encoded in base64
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRkhJRkFJAA==';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }

  realmOf(input: URL | string) {
    let str = input instanceof URL ? input.href : input;
    if (str.startsWith(testRealmURL)) {
      return testRealmURL;
    }
    return undefined;
  }
}

module('Integration | tools | write-binary-file', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    fetch = getService('network').fetch;
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  test('writes a binary file', async function (assert) {
    let toolService = getService('tool-service');
    let command = new WriteBinaryFileTool(toolService.toolContext);
    let result = await command.execute({
      path: 'test-image.png',
      realm: testRealmURL,
      base64Content: TINY_PNG_BASE64,
    });
    assert.strictEqual(
      result.fileIdentifier,
      `${testRealmURL}test-image.png`,
      'returns the correct file URL',
    );
    let response = await fetch(new URL('test-image.png', testRealmURL));
    assert.strictEqual(response.status, 200, 'file is accessible after write');

    let expectedBytes = Uint8Array.from(atob(TINY_PNG_BASE64), (char) =>
      char.charCodeAt(0),
    );
    let actualBytes = new Uint8Array(await response.arrayBuffer());

    assert.deepEqual(
      Array.from(actualBytes),
      Array.from(expectedBytes),
      'stored file bytes match the decoded base64 content',
    );
  });

  test('a 403 from WAF is surfaced in the error message', async function (assert) {
    let networkService = getService('network');
    networkService.virtualNetwork.mount(
      async (req: Request) => {
        if (
          req.method === 'POST' &&
          req.headers.get('Content-Type') === 'application/octet-stream'
        ) {
          return new Response(
            '{ "message": "Request blocked by Web Application Firewall." }',
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                'X-Blocked-By-WAF-Rule': 'CrossSiteScripting_BODY',
              },
            },
          );
        }
        return null;
      },
      { prepend: true },
    );

    let toolService = getService('tool-service');
    let command = new WriteBinaryFileTool(toolService.toolContext);
    try {
      await command.execute({
        path: 'waf-blocked.png',
        realm: testRealmURL,
        base64Content: TINY_PNG_BASE64,
      });
      assert.notOk(true, 'Should have thrown an error');
    } catch (error: any) {
      assert.ok(
        error.message.includes('403'),
        'Error message includes status code',
      );
      assert.ok(
        error.message.includes('waf-blocked.png'),
        'Error message includes the file path',
      );
      assert.ok(
        error.message.includes('WAF rule: CrossSiteScripting_BODY'),
        'Error message includes the WAF rule',
      );
      assert.ok(
        error.message.includes('bytes'),
        'Error message includes file size',
      );
    }
  });

  test('handles a leading slash in the path', async function (assert) {
    let toolService = getService('tool-service');
    let command = new WriteBinaryFileTool(toolService.toolContext);
    let result = await command.execute({
      path: '/test-image.png',
      realm: testRealmURL,
      base64Content: TINY_PNG_BASE64,
    });
    assert.strictEqual(
      result.fileIdentifier,
      `${testRealmURL}test-image.png`,
      'leading slash is stripped from path',
    );
  });

  test('throws an error when an invalid realm is provided', async function (assert) {
    let toolService = getService('tool-service');
    let command = new WriteBinaryFileTool(toolService.toolContext);
    try {
      await command.execute({
        path: 'bad.png',
        realm: 'https://not-a-known-realm.example/',
        base64Content: TINY_PNG_BASE64,
      });
      assert.notOk(true, 'Should have thrown an error for invalid realm');
    } catch (error: any) {
      assert.ok(
        error.message.includes('Invalid or unknown realm provided'),
        'Error message should mention invalid realm',
      );
    }
  });
});
