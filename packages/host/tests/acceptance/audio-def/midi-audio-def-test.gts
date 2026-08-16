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

// A Standard MIDI File is chunks of big-endian data, so the fixture is built by
// hand rather than with any encoder.
function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
function be32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}
function be16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}
// MIDI's variable-length quantity: seven bits per byte, high bit set on all but
// the last.
function vlq(value: number): number[] {
  let out = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return out;
}

// A format-0 file: one 120 BPM quarter-note tempo, a program change to General
// MIDI voice 40 (Violin), and a single middle-C note held four beats. At 480
// ticks per quarter that is 1920 ticks = 2.0 seconds.
function makeMinimalMidi(): Uint8Array {
  let microsPerQuarter = 500_000; // 120 BPM
  let events = [
    ...vlq(0),
    0xff,
    0x51,
    0x03,
    (microsPerQuarter >>> 16) & 0xff,
    (microsPerQuarter >>> 8) & 0xff,
    microsPerQuarter & 0xff,
    ...vlq(0),
    0xc0,
    40, // program change, channel 0 → Violin
    ...vlq(0),
    0x90,
    60,
    64, // note on, middle C
    ...vlq(1920),
    0x80,
    60,
    0, // note off, four beats later
    ...vlq(0),
    0xff,
    0x2f,
    0x00, // end of track
  ];
  let track = [...ascii('MTrk'), ...be32(events.length), ...events];
  let header = [
    ...ascii('MThd'),
    ...be32(6),
    ...be16(0), // format 0
    ...be16(1), // one track
    ...be16(480), // 480 ticks per quarter note
  ];
  return new Uint8Array([...header, ...track]);
}

module('Acceptance | midi audio def', function (hooks) {
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

  const midiDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}midi-audio-def` as RealmResourceIdentifier,
    name: 'MidiDef',
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
    let midiBytes = makeMinimalMidi();
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.mid': midiBytes,
          'not-a-midi.mid': 'This is plain text, not a MIDI file.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts the sequence metadata from a MIDI file', async function (assert) {
    let url = makeFileURL('sample.mid');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: midiDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.name, 'sample.mid');
    assert.strictEqual(
      result.searchDoc?.duration,
      2,
      'walks the tempo map to the last event for duration',
    );
    assert.strictEqual(
      result.searchDoc?.midi?.noteCount,
      1,
      'counts the one sounding note',
    );
    assert.strictEqual(
      result.searchDoc?.midi?.trackCount,
      1,
      'counts the one sounding track',
    );
    assert.ok(
      String(result.searchDoc?.contentType).includes('midi'),
      'sets midi content type',
    );
  });

  test('falls back when MidiDef is used for non-MIDI content', async function (assert) {
    let url = makeFileURL('not-a-midi.mid');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: midiDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not a Standard MIDI File',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-a-midi.mid');
  });

  test('isolated preview renders the sequence and formatted duration', async function (assert) {
    let url = makeFileURL('sample.mid');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: midiDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: midiDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: midiDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let preview = document.querySelector(
      '[data-prerender] [data-test-midi-preview]',
    );
    assert.ok(preview, 'midi preview renders in the shared shell');
    let player = document.querySelector(
      '[data-prerender] [data-test-audio-player]',
    );
    assert.notOk(player, 'a symbolic MIDI file mounts no audio player');
    let duration = document.querySelector(
      '[data-prerender] [data-test-midi-duration]',
    );
    assert.ok(duration, 'duration element is rendered');
    assert.strictEqual(
      duration?.textContent?.trim(),
      '0:02',
      'duration is formatted as m:ss',
    );
    let voices = document.querySelector(
      '[data-prerender] [data-test-midi-voices]',
    );
    assert.ok(voices, 'voices list is rendered');
    assert.true(
      voices?.textContent?.includes('Violin'),
      'program 40 resolves to its General MIDI voice name',
    );
  });

  test('indexing stores MIDI metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.mid', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.duration,
      2,
      'index stores MIDI duration',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('midi'),
      'file meta uses midi content type',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      midiDefCodeRef(),
      'file meta uses MIDI def',
    );
  });
});
