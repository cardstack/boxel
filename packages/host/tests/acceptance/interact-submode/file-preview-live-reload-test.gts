import { waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import { setupTestRealmServiceWorker } from '../../helpers/test-realm-service-worker';

// Each test opens a file in an interact stack, where the preview component
// stays mounted while the store reloads the FileDef after a write, then writes
// new bytes to the same path and asserts the preview shows them. The fixtures
// differ in something the browser itself reports (an image's intrinsic width,
// an audio track's duration) or in what the preview loads (the bytes behind a
// blob URL or a fetch, the face URL it hands the browser), so a preview that
// keeps showing the first load fails.

const encoder = new TextEncoder();

function svgImage(width: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10" viewBox="0 0 ${width} 10"><rect width="${width}" height="10" fill="#38f"/></svg>`;
}

// Mono 8-bit PCM at 8 kHz: one second of silence per 8000 data bytes.
function wavOfSeconds(seconds: number): Uint8Array {
  let sampleRate = 8000;
  let dataSize = sampleRate * seconds;
  let bytes = new Uint8Array(44 + dataSize).fill(0x80, 44);
  let view = new DataView(bytes.buffer);
  bytes.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set(encoder.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  bytes.set(encoder.encode('data'), 36);
  view.setUint32(40, dataSize, true);
  return bytes;
}

function ebml(id: number, body: number[]): number[] {
  let idBytes: number[] = [];
  for (let value = id; value > 0; value = Math.floor(value / 256)) {
    idBytes.unshift(value & 0xff);
  }
  // An eight-byte size: the marker byte, then the length.
  let size = [0x01, 0, 0, 0, 0, 0, 0, 0];
  let length = body.length;
  for (let i = 7; i > 0 && length > 0; i--) {
    size[i] = length & 0xff;
    length = Math.floor(length / 256);
  }
  return [...idBytes, ...size, ...body];
}

// A structurally legible WebM header whose Info block carries `title`, so two
// fixtures differ in their bytes. Not playable; the test compares the bytes
// the player is handed.
function webmTitled(title: string): Uint8Array {
  let header = ebml(0x1a45dfa3, ebml(0x4286, [1]));
  let info = ebml(0x1549a966, ebml(0x7ba9, [...encoder.encode(title)]));
  return new Uint8Array([...header, ...ebml(0x18538067, info)]);
}

function pdfTitled(title: string): string {
  return (
    '%PDF-1.7\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R>>endobj\n' +
    `4 0 obj<</Title(${title})>>endobj\n` +
    'trailer<</Root 1 0 R/Info 4 0 R>>\n' +
    '%%EOF\n'
  );
}

// A one-facet ASCII STL whose triangle spans `width` × `height`.
function stlTriangle(width: number, height: number): string {
  return [
    'solid tri',
    ' facet normal 0 0 1',
    '  outer loop',
    '   vertex 0 0 0',
    `   vertex ${width} 0 0`,
    `   vertex 0 ${height} 0`,
    '  endloop',
    ' endfacet',
    'endsolid tri',
  ].join('\n');
}

// A TrueType offset table with no tables, padded with `marker` so two fixtures
// differ. The font reader accepts it by its signature; the browser can't
// render it, which doesn't matter to a test that watches which face the
// specimen asks the browser to load.
function fontWithMarker(marker: string): Uint8Array {
  return new Uint8Array([
    0,
    1,
    0,
    0,
    ...new Array(8).fill(0),
    ...encoder.encode(marker),
  ]);
}

async function textAt(url: string): Promise<string> {
  let response = await fetch(url);
  return await response.text();
}

function pdfObjectData(): string {
  return (
    document.querySelector('[data-test-pdf-viewer]')?.getAttribute('data') ?? ''
  );
}

module(
  'Acceptance | interact submode | file preview live reload',
  function (hooks) {
    let realm: Realm;

    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);
    setupTestRealmServiceWorker(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    hooks.beforeEach(async function () {
      mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      ({ realm } = await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'picture.svg': svgImage(20),
          'tone.wav': wavOfSeconds(2),
          'clip.webm': webmTitled('first cut'),
          'report.pdf': pdfTitled('First draft'),
          'part.stl': stlTriangle(2, 4),
          'face.ttf': fontWithMarker('first'),
        },
      }));
    });

    async function openInInteractStack(path: string) {
      await visitOperatorMode({
        stacks: [
          [{ id: `${testRealmURL}${path}`, format: 'isolated', type: 'file' }],
        ],
      });
    }

    test('image preview shows the new picture after its file is written', async function (assert) {
      await openInInteractStack('picture.svg');

      let image = () =>
        document.querySelector(
          '[data-test-image-preview]',
        ) as HTMLImageElement | null;
      await waitUntil(() => image()?.complete && image()!.naturalWidth === 20, {
        timeout: 5000,
        timeoutMessage: 'the first picture did not load',
      });

      await realm.write('picture.svg', svgImage(60));

      await waitUntil(() => image()?.complete && image()!.naturalWidth === 60, {
        timeout: 5000,
        timeoutMessage: 'the image preview kept the first picture',
      });
      assert.strictEqual(
        image()!.naturalWidth,
        60,
        'the image element decoded the rewritten file',
      );
    });

    test('audio preview loads the new track after its file is written', async function (assert) {
      await openInInteractStack('tone.wav');

      let player = () =>
        document.querySelector(
          '[data-test-audio-player]',
        ) as HTMLAudioElement | null;
      await waitUntil(() => player()?.duration === 2, {
        timeout: 5000,
        timeoutMessage: 'the first track did not load',
      });

      await realm.write('tone.wav', wavOfSeconds(3));

      await waitUntil(() => player()?.duration === 3, {
        timeout: 5000,
        timeoutMessage: 'the audio player kept the first track',
      });
      assert.strictEqual(
        player()!.duration,
        3,
        'the player loaded the rewritten file',
      );
    });

    test('video preview hands its player the new bytes after its file is written', async function (assert) {
      await openInInteractStack('clip.webm');

      let playerSrc = () =>
        (
          document.querySelector(
            '[data-test-video-player]',
          ) as HTMLVideoElement | null
        )?.getAttribute('src') ?? '';
      await waitUntil(() => playerSrc().startsWith('blob:'), {
        timeout: 5000,
        timeoutMessage: 'the video player did not receive the first file',
      });
      assert.true(
        (await textAt(playerSrc())).includes('first cut'),
        'the player starts with the first file',
      );
      let firstSrc = playerSrc();

      await realm.write('clip.webm', webmTitled('second cut'));

      await waitUntil(
        () => playerSrc() !== firstSrc && playerSrc().startsWith('blob:'),
        {
          timeout: 5000,
          timeoutMessage: 'the video player kept the first file',
        },
      );
      assert.true(
        (await textAt(playerSrc())).includes('second cut'),
        'the player holds the rewritten file',
      );
    });

    test('PDF viewer hands its object the new document after its file is written', async function (assert) {
      await openInInteractStack('report.pdf');

      await waitUntil(() => pdfObjectData().startsWith('blob:'), {
        timeout: 5000,
        timeoutMessage: 'the PDF viewer did not receive the first document',
      });
      assert.true(
        (await textAt(pdfObjectData())).includes('First draft'),
        'the viewer starts with the first document',
      );
      let firstData = pdfObjectData();

      await realm.write('report.pdf', pdfTitled('Second draft'));

      await waitUntil(
        () =>
          pdfObjectData() !== firstData && pdfObjectData().startsWith('blob:'),
        {
          timeout: 5000,
          timeoutMessage: 'the PDF viewer kept the first document',
        },
      );
      assert.true(
        (await textAt(pdfObjectData())).includes('Second draft'),
        'the viewer holds the rewritten document',
      );
    });

    module('PDF viewer while it refetches', function (hooks) {
      // Once `holding` is set, holds every document fetch until the test
      // releases it, so the test can look at the viewer while a refetch is in
      // flight.
      let holding: boolean;
      let heldFetches: number;
      let release: () => void;
      let released: Promise<void>;
      let nativeFetch: typeof fetch;

      hooks.beforeEach(function () {
        holding = false;
        heldFetches = 0;
        released = new Promise((resolve) => (release = resolve));
        nativeFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          let url = input instanceof Request ? input.url : String(input);
          if (holding && url.includes('report.pdf')) {
            heldFetches++;
            await released;
          }
          return nativeFetch(input, init);
        };
      });

      hooks.afterEach(function () {
        release();
        globalThis.fetch = nativeFetch;
      });

      test('PDF viewer keeps the document it shows loadable until the rewritten one arrives', async function (assert) {
        await openInInteractStack('report.pdf');

        await waitUntil(() => pdfObjectData().startsWith('blob:'), {
          timeout: 5000,
          timeoutMessage: 'the PDF viewer did not receive the first document',
        });
        let firstData = pdfObjectData();

        holding = true;
        await realm.write('report.pdf', pdfTitled('Second draft'));

        await waitUntil(() => heldFetches > 0, {
          timeout: 5000,
          timeoutMessage: 'the PDF viewer did not refetch the document',
        });
        assert.strictEqual(
          pdfObjectData(),
          firstData,
          'the viewer keeps showing the first document while it refetches',
        );
        assert.true(
          (await textAt(firstData)).includes('First draft'),
          'the document on screen is still loadable during the refetch',
        );

        release();

        await waitUntil(
          () =>
            pdfObjectData() !== firstData &&
            pdfObjectData().startsWith('blob:'),
          {
            timeout: 5000,
            timeoutMessage: 'the PDF viewer kept the first document',
          },
        );
        assert.true(
          (await textAt(pdfObjectData())).includes('Second draft'),
          'the viewer holds the rewritten document',
        );
        await assert.rejects(
          textAt(firstData),
          'the replaced document is released',
        );
      });
    });

    module('3D viewer', function (hooks) {
      // The bodies the viewer fetched for the model. The viewer fetches the
      // bytes before it creates a WebGL context, so this watches the reload
      // in a browser that has no WebGL.
      let fetchedModels: Promise<string>[];
      let nativeFetch: typeof fetch;

      hooks.beforeEach(function () {
        fetchedModels = [];
        nativeFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          let response = await nativeFetch(input, init);
          let url = input instanceof Request ? input.url : String(input);
          if (url.includes('part.stl')) {
            fetchedModels.push(response.clone().text());
          }
          return response;
        };
      });

      hooks.afterEach(function () {
        globalThis.fetch = nativeFetch;
      });

      async function lastFetchedModel() {
        return await fetchedModels[fetchedModels.length - 1];
      }

      test('3D viewer fetches the new geometry after its file is written', async function (assert) {
        await openInInteractStack('part.stl');

        await waitUntil(() => fetchedModels.length > 0, {
          timeout: 15000,
          timeoutMessage: 'the viewer did not fetch the first model',
        });
        assert.true(
          (await lastFetchedModel()).includes('vertex 2 0 0'),
          'the viewer starts with the first model',
        );
        let firstCount = fetchedModels.length;

        await realm.write('part.stl', stlTriangle(6, 8));

        await waitUntil(() => fetchedModels.length > firstCount, {
          timeout: 15000,
          timeoutMessage: 'the 3D viewer did not refetch the model',
        });
        assert.true(
          (await lastFetchedModel()).includes('vertex 6 0 0'),
          'the viewer fetched the rewritten model',
        );
      });
    });

    module('font specimen', function (hooks) {
      // The sources of the faces the specimen asks the browser to load.
      let requestedFaces: string[];
      let NativeFontFace: typeof FontFace;

      hooks.beforeEach(function () {
        requestedFaces = [];
        NativeFontFace = globalThis.FontFace;
        globalThis.FontFace = class extends NativeFontFace {
          constructor(
            family: string,
            source: string | BufferSource,
            descriptors?: FontFaceDescriptors,
          ) {
            super(family, source, descriptors);
            if (typeof source === 'string') {
              requestedFaces.push(source);
            }
          }
        };
      });

      hooks.afterEach(function () {
        globalThis.FontFace = NativeFontFace;
      });

      test('font specimen loads the new face after its file is written', async function (assert) {
        await openInInteractStack('face.ttf');

        await waitUntil(() => requestedFaces.length > 0, {
          timeout: 5000,
          timeoutMessage: 'the specimen did not load the first face',
        });
        let firstFace = requestedFaces[requestedFaces.length - 1]!;
        assert.true(
          firstFace.includes('face.ttf'),
          'the specimen loads the file as its face',
        );

        await realm.write('face.ttf', fontWithMarker('second'));

        await waitUntil(
          () => requestedFaces.some((face) => face !== firstFace),
          {
            timeout: 5000,
            timeoutMessage: 'the specimen kept the first face',
          },
        );
        assert.true(
          requestedFaces[requestedFaces.length - 1]!.includes('face.ttf?rev='),
          'the specimen loads the rewritten file as a new face',
        );
      });
    });
  },
);
