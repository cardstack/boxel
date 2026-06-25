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

// Build a minimal valid FLAC stream:
//   "fLaC" + STREAMINFO block (last-of-metadata, 34 bytes payload).
// The packed sampleRate/channels/bps/totalSamples field is laid out big-endian
// across 8 bytes; sampleRate=44100 and totalSamples=44100 yields a 1.0 second
// duration.
function makeMinimalFlac(): Uint8Array {
  let payload = new Uint8Array(34);

  // minBlockSize / maxBlockSize / min+max frame size — values don't affect
  // duration extraction, but must parse as 16-bit / 24-bit BE.
  let view = new DataView(payload.buffer);
  view.setUint16(0, 4096); // minBlockSize
  view.setUint16(2, 4096); // maxBlockSize
  // bytes 4..6 minFrameSize, bytes 7..9 maxFrameSize — leave zero.

  // Packed field starting at byte 10:
  //   sampleRate=44100 (0xAC44) in 20 bits → 0x0_AC44.
  payload[10] = 0x0a;
  payload[11] = 0xc4;
  // bits 16..19 = bottom 4 of sampleRate (0x4); bits 20..27 packed as
  //   3 bits channels-1 (0) + 5 bits bps-1 (15 = 0x0F). Top bit of bps-1 is 0.
  payload[12] = 0x40;
  // bits 24..27 = bottom 4 bits of bps-1 (1111); bits 28..31 = top 4 of
  // totalSamples (0).
  payload[13] = 0xf0;
  // bytes 14..17 = low 32 bits of totalSamples big-endian. totalSamples =
  // 44100 = 0x0000AC44.
  view.setUint32(14, 44100);
  // bytes 18..33 = MD5 signature — zero is acceptable for a header fixture.

  let blockHeader = new Uint8Array(4);
  // last-of-metadata flag (0x80) | block type 0 (STREAMINFO)
  blockHeader[0] = 0x80;
  // 24-bit big-endian block length = 34
  blockHeader[1] = 0x00;
  blockHeader[2] = 0x00;
  blockHeader[3] = 0x22;

  let marker = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // "fLaC"

  let out = new Uint8Array(marker.length + blockHeader.length + payload.length);
  out.set(marker, 0);
  out.set(blockHeader, marker.length);
  out.set(payload, marker.length + blockHeader.length);
  return out;
}

module('Acceptance | flac audio def', function (hooks) {
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

  const flacDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}flac-audio-def` as RealmResourceIdentifier,
    name: 'FlacDef',
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
    let flacBytes = makeMinimalFlac();
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.flac': flacBytes,
          'not-a-flac.flac': 'This is plain text, not a FLAC file.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts duration from FLAC', async function (assert) {
    let url = makeFileURL('sample.flac');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: flacDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.duration, 1, 'extracts FLAC duration');
    assert.strictEqual(result.searchDoc?.name, 'sample.flac');
    assert.ok(
      String(result.searchDoc?.contentType).includes('flac'),
      'sets flac content type',
    );
  });

  test('falls back when FlacDef is used for non-FLAC content', async function (assert) {
    let url = makeFileURL('not-a-flac.flac');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: flacDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid FLAC',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-a-flac.flac');
  });

  test('isolated template renders the formatted duration', async function (assert) {
    let url = makeFileURL('sample.flac');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: flacDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: flacDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: flacDefCodeRef(),
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

  test('indexing stores FLAC metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.flac', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.duration,
      1,
      'index stores FLAC duration',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('flac'),
      'file meta uses flac content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.duration,
      1,
      'file meta includes FLAC duration',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      flacDefCodeRef(),
      'file meta uses FLAC def',
    );
  });
});
