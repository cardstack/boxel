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

// Build a minimal valid MP4/M4A container: an ftyp box advertising the M4A
// brand, then a moov box whose single mvhd child sets timescale=1000 and
// duration=2000 (so playback duration = 2.0 seconds).
function makeMinimalM4a(): Uint8Array {
  // ---- ftyp box (16 bytes) ----
  let ftyp = new Uint8Array(16);
  let ftypView = new DataView(ftyp.buffer);
  ftypView.setUint32(0, 16); // box size
  ftyp.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  ftyp.set([0x4d, 0x34, 0x41, 0x20], 8); // major brand "M4A "
  ftypView.setUint32(12, 0); // minor version

  // ---- mvhd box (108 bytes) ----
  let mvhd = new Uint8Array(108);
  let mvhdView = new DataView(mvhd.buffer);
  mvhdView.setUint32(0, 108); // box size
  mvhd.set([0x6d, 0x76, 0x68, 0x64], 4); // "mvhd"
  // byte 8 = version 0; bytes 9..11 = flags 0; bytes 12..15 = creation time;
  // 16..19 = modification time. All zero.
  mvhdView.setUint32(20, 1000); // timescale
  mvhdView.setUint32(24, 2000); // duration (in timescale units)
  // bytes 28..31 rate (0x00010000), 32..33 volume (0x0100), 34..43 reserved,
  // 44..79 matrix, 80..103 predefined, 104..107 next track ID — all zero is
  // acceptable for our extractor, which only reads version + timescale +
  // duration.

  // ---- moov box wraps mvhd (8-byte header + 108-byte mvhd = 116 bytes) ----
  let moov = new Uint8Array(8 + mvhd.length);
  let moovView = new DataView(moov.buffer);
  moovView.setUint32(0, moov.length);
  moov.set([0x6d, 0x6f, 0x6f, 0x76], 4); // "moov"
  moov.set(mvhd, 8);

  let out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  return out;
}

// iPhone / Apple Voice Memos layout: the moov box trails a large mdat media
// payload, so the duration is only reachable after streaming past (and
// discarding) mdat. Reuses makeMinimalM4a's ftyp + moov and splices a chunky
// mdat box between them.
function makeM4aMoovAtEnd(): Uint8Array {
  let fastStart = makeMinimalM4a(); // ftyp (16 bytes) + moov
  let ftyp = fastStart.subarray(0, 16);
  let moov = fastStart.subarray(16);

  let mdatPayload = new Uint8Array(4096).fill(0xab);
  let mdat = new Uint8Array(8 + mdatPayload.length);
  let mdatView = new DataView(mdat.buffer);
  mdatView.setUint32(0, mdat.length); // box size
  mdat.set([0x6d, 0x64, 0x61, 0x74], 4); // "mdat"
  mdat.set(mdatPayload, 8);

  let out = new Uint8Array(ftyp.length + mdat.length + moov.length);
  out.set(ftyp, 0);
  out.set(mdat, ftyp.length);
  out.set(moov, ftyp.length + mdat.length);
  return out;
}

module('Acceptance | m4a audio def', function (hooks) {
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

  const m4aDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}m4a-audio-def` as RealmResourceIdentifier,
    name: 'M4aDef',
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
    let m4aBytes = makeMinimalM4a();
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.m4a': m4aBytes,
          'sample-moov-at-end.m4a': makeM4aMoovAtEnd(),
          'not-an-m4a.m4a': 'This is plain text, not an M4A file.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts duration from M4A', async function (assert) {
    let url = makeFileURL('sample.m4a');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: m4aDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.duration, 2, 'extracts M4A duration');
    assert.strictEqual(result.searchDoc?.name, 'sample.m4a');
    let contentType = String(result.searchDoc?.contentType);
    let isM4aCompatibleType =
      contentType.includes('mp4') || contentType.includes('m4a');
    assert.true(isM4aCompatibleType, 'sets m4a-compatible content type');
  });

  test('extracts duration from M4A with a trailing moov box', async function (assert) {
    // Exercises the streaming walk's mdat-skipping: the moov box only appears
    // after the media payload, as in iPhone / Voice Memo recordings.
    let url = makeFileURL('sample-moov-at-end.m4a');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: m4aDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.duration,
      2,
      'extracts duration after skipping past mdat',
    );
    assert.strictEqual(result.searchDoc?.name, 'sample-moov-at-end.m4a');
  });

  test('falls back when M4aDef is used for non-M4A content', async function (assert) {
    let url = makeFileURL('not-an-m4a.m4a');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: m4aDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid M4A',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-an-m4a.m4a');
  });

  test('isolated template renders the formatted duration', async function (assert) {
    let url = makeFileURL('sample.m4a');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: m4aDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: m4aDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: m4aDefCodeRef(),
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
      '0:02',
      'duration is formatted as m:ss',
    );
  });

  test('indexing stores M4A metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.m4a', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.duration,
      2,
      'index stores M4A duration',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.strictEqual(
      body?.data?.attributes?.duration,
      2,
      'file meta includes M4A duration',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      m4aDefCodeRef(),
      'file meta uses M4A def',
    );
  });
});
