import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealmRRI,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  SupportedMimeType,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import type NetworkService from '@cardstack/host/services/network';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import { setupTestRealmServiceWorker } from '../../helpers/test-realm-service-worker';

// Build a minimal MP3 fixture: one MPEG1 Layer III mono frame at 48 kHz with
// a "Xing" VBR header advertising 125 frames. 125 * 1152 / 48000 = 3.0 sec.
function makeMinimalMp3(): Uint8Array {
  let buf = new Uint8Array(64);
  let view = new DataView(buf.buffer);

  // MPEG audio frame header (4 bytes):
  //   FF       sync hi
  //   FB       sync lo (111) | MPEG1 (11) | Layer III (01) | no CRC (1)
  //   94       bitrate idx 9 (128 kbps) | sample rate idx 1 (48 kHz) | no pad
  //   C0       channel mode mono (11) | mode ext 0 | copy 0 | orig 0 | emph 0
  buf[0] = 0xff;
  buf[1] = 0xfb;
  buf[2] = 0x94;
  buf[3] = 0xc0;

  // For MPEG1 mono, the Xing/Info header sits 17 bytes after the frame
  // header (side-info region). Bytes 4..20 stay zero — irrelevant to the
  // duration extractor.
  let xingOffset = 4 + 17;
  buf.set([0x58, 0x69, 0x6e, 0x67], xingOffset); // "Xing"
  view.setUint32(xingOffset + 4, 0x01); // flags: bit 0 = frames present
  view.setUint32(xingOffset + 8, 125); // total frame count

  return buf;
}

module('Acceptance | mp3 audio def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupTestRealmServiceWorker(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let realm: Realm;

  const fileExtractPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const fileRenderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    format = 'isolated',
    ancestorLevel = 0,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/html/${format}/${ancestorLevel}`;

  const makeFileURL = (path: string) => new URL(path, testRealmURL).href;

  const mp3DefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}mp3-audio-def` as RealmResourceIdentifier,
    name: 'Mp3Def',
  });

  async function captureFileExtractResult(
    expectedStatus?: 'ready' | 'error',
  ): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        let status = container.getAttribute(
          'data-prerender-file-extract-status',
        );
        if (!status) {
          return false;
        }
        if (expectedStatus && status !== expectedStatus) {
          return false;
        }
        return status === 'ready' || status === 'error';
      },
      { timeout: 5000 },
    );

    let container = document.querySelector(
      '[data-prerender-file-extract]',
    ) as HTMLElement | null;
    if (!container) {
      throw new Error(
        'captureFileExtractResult: missing [data-prerender-file-extract] container after wait',
      );
    }
    let pre = container.querySelector('pre');
    let text = pre?.textContent?.trim() ?? '';
    return JSON.parse(text) as FileExtractResponse;
  }

  hooks.beforeEach(async function () {
    let mp3Bytes = makeMinimalMp3();
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.mp3': mp3Bytes,
          'not-an-mp3.mp3': 'This is plain text, not an MP3 file.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts duration from MP3', async function (assert) {
    let url = makeFileURL('sample.mp3');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: mp3DefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.duration, 3, 'extracts MP3 duration');
    assert.strictEqual(result.searchDoc?.name, 'sample.mp3');
    assert.ok(
      String(result.searchDoc?.contentType).includes('mpeg'),
      'sets mp3 content type',
    );
  });

  test('falls back when Mp3Def is used for non-MP3 content', async function (assert) {
    let url = makeFileURL('not-an-mp3.mp3');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: mp3DefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid MP3',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-an-mp3.mp3');
  });

  test('isolated template renders the formatted duration', async function (assert) {
    let url = makeFileURL('sample.mp3');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: mp3DefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: mp3DefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: mp3DefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let duration = document.querySelector(
      '[data-prerender] .audio-isolated__duration',
    );
    assert.ok(duration, 'duration element is rendered');
    assert.strictEqual(
      duration?.textContent?.trim(),
      '0:03',
      'duration is formatted as m:ss',
    );
  });

  test('indexing stores MP3 metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.mp3', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.duration,
      3,
      'index stores MP3 duration',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('mpeg'),
      'file meta uses mp3 content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.duration,
      3,
      'file meta includes MP3 duration',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      mp3DefCodeRef(),
      'file meta uses MP3 def',
    );
  });
});
