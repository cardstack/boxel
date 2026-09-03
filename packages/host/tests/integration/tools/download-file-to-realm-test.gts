import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';
import DownloadFileToRealmTool from '@cardstack/host/tools/download-file-to-realm';

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

// A non-realm source URL, served by a mounted virtual-network handler so the
// download path is exercised without touching a real network.
const sourceURL = 'https://media.example/captures/pet.png';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }

  get defaultWritableRealm() {
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

module('Integration | tools | download-file-to-realm', function (hooks) {
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

  function mountSource(responder: (req: Request) => Promise<Response | null>) {
    getService('network').virtualNetwork.mount(responder, { prepend: true });
  }

  test('downloads a URL and persists it through the binary-write path', async function (assert) {
    let sourceBytes = Uint8Array.from(atob(TINY_PNG_BASE64), (char) =>
      char.charCodeAt(0),
    );
    mountSource(async (req: Request) => {
      if (req.url === sourceURL) {
        return new Response(sourceBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return null;
    });

    let command = new DownloadFileToRealmTool(
      getService('tool-service').toolContext,
    );
    let result = await command.execute({
      sourceUrl: sourceURL,
      realm: testRealmURL,
      path: 'downloads/pet.png',
    });
    assert.strictEqual(
      result.fileIdentifier,
      `${testRealmURL}downloads/pet.png`,
      'returns the written file URL',
    );

    let response = await fetch(new URL('downloads/pet.png', testRealmURL));
    assert.strictEqual(response.status, 200, 'file is accessible after write');
    let actualBytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(
      Array.from(actualBytes),
      Array.from(sourceBytes),
      'stored bytes match the downloaded content byte-for-byte',
    );
  });

  test('an omitted realm falls back to the default writable realm', async function (assert) {
    let sourceBytes = Uint8Array.from(atob(TINY_PNG_BASE64), (char) =>
      char.charCodeAt(0),
    );
    mountSource(async (req: Request) => {
      if (req.url === sourceURL) {
        return new Response(sourceBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return null;
    });

    let command = new DownloadFileToRealmTool(
      getService('tool-service').toolContext,
    );
    let result = await command.execute({
      sourceUrl: sourceURL,
      path: 'downloads/defaulted.png',
    });
    assert.strictEqual(
      result.fileIdentifier,
      `${testRealmURL}downloads/defaulted.png`,
      'the file lands in the default writable realm',
    );
  });

  test('with no realm and no writable realm, the failure is clear and nothing downloads', async function (assert) {
    let downloads = 0;
    mountSource(async (req: Request) => {
      if (req.url === sourceURL) {
        downloads++;
        return new Response('bytes', { status: 200 });
      }
      return null;
    });
    Object.defineProperty(getService('realm'), 'defaultWritableRealm', {
      value: null,
    });

    let command = new DownloadFileToRealmTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({
        sourceUrl: sourceURL,
        path: 'downloads/nowhere.png',
      }),
      /No realm provided and no writable realm is available/,
    );
    assert.strictEqual(downloads, 0, 'the download never started');
  });

  test('a failed download surfaces the status and writes nothing', async function (assert) {
    mountSource(async (req: Request) => {
      if (req.url === sourceURL) {
        return new Response('gone', { status: 404, statusText: 'Not Found' });
      }
      return null;
    });

    let command = new DownloadFileToRealmTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({
        sourceUrl: sourceURL,
        realm: testRealmURL,
        path: 'downloads/missing.png',
      }),
      /Failed to download .*\(404/,
      'the error names the source URL and status',
    );

    let response = await fetch(new URL('downloads/missing.png', testRealmURL));
    assert.strictEqual(response.status, 404, 'nothing was written');
  });
});
