import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
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

// Build a minimal valid Ogg/Opus stream: one BOS page carrying the OpusHead
// identification packet, then one EOS page whose granule position encodes the
// total sample count (Opus output sample rate is fixed at 48 kHz, so a
// granule of 48000 means 1.0 second).
function makeMinimalOggOpus(): Uint8Array {
  let serial = 0x12345678;

  // ---- Page 1: BOS with OpusHead packet (19 bytes) ----
  let opusHead = new Uint8Array(19);
  let headView = new DataView(opusHead.buffer);
  opusHead.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  opusHead[8] = 1; // version
  opusHead[9] = 1; // channels
  headView.setUint16(10, 0, true); // preSkip = 0
  headView.setUint32(12, 48000, true); // input sample rate (informational)
  // bytes 16..17 output gain = 0; byte 18 channel mapping family = 0.

  let page1 = new Uint8Array(27 + 1 + opusHead.length);
  let p1 = new DataView(page1.buffer);
  page1.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page1[4] = 0; // version
  page1[5] = 0x02; // header type: BOS
  // bytes 6..13 granule position = 0 (LE int64) — leave zero.
  p1.setUint32(14, serial, true);
  p1.setUint32(18, 0, true); // page sequence
  p1.setUint32(22, 0, true); // CRC — extractor does not validate
  page1[26] = 1; // page_segments
  page1[27] = opusHead.length; // single segment containing OpusHead
  page1.set(opusHead, 28);

  // ---- Page 2: EOS with granule position = 48000 ----
  let page2 = new Uint8Array(27 + 1 + 1);
  let p2 = new DataView(page2.buffer);
  page2.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page2[4] = 0;
  page2[5] = 0x04; // header type: EOS
  // 8-byte little-endian granule position. 48000 fits in low 32 bits.
  p2.setUint32(6, 48000, true);
  p2.setUint32(10, 0, true);
  p2.setUint32(14, serial, true);
  p2.setUint32(18, 1, true); // page sequence
  p2.setUint32(22, 0, true); // CRC
  page2[26] = 1; // page_segments
  page2[27] = 1; // single 1-byte segment
  page2[28] = 0; // dummy payload byte

  let out = new Uint8Array(page1.length + page2.length);
  out.set(page1, 0);
  out.set(page2, page1.length);
  return out;
}

module('Acceptance | ogg audio def', function (hooks) {
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

  const oggDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}ogg-audio-def` as RealmResourceIdentifier,
    name: 'OggDef',
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
    let oggBytes = makeMinimalOggOpus();
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.ogg': oggBytes,
          'not-an-ogg.ogg': 'This is plain text, not an OGG file.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts duration from OGG', async function (assert) {
    let url = makeFileURL('sample.ogg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: oggDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.duration, 1, 'extracts OGG duration');
    assert.strictEqual(result.searchDoc?.name, 'sample.ogg');
    assert.ok(
      String(result.searchDoc?.contentType).includes('ogg'),
      'sets ogg content type',
    );
  });

  test('falls back when OggDef is used for non-OGG content', async function (assert) {
    let url = makeFileURL('not-an-ogg.ogg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: oggDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid OGG',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-an-ogg.ogg');
  });

  test('isolated template renders the formatted duration', async function (assert) {
    let url = makeFileURL('sample.ogg');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: oggDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: oggDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: oggDefCodeRef(),
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
      '0:01',
      'duration is formatted as m:ss',
    );
  });

  test('indexing stores OGG metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.ogg', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.duration,
      1,
      'index stores OGG duration',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('ogg'),
      'file meta uses ogg content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.duration,
      1,
      'file meta includes OGG duration',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      oggDefCodeRef(),
      'file meta uses OGG def',
    );
  });
});
