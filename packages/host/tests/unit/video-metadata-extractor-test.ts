// Byte-level tests for the video container readers.
//
// Same contract as the image and audio readers: these run during indexing
// against whatever a realm holds, so malformed input must degrade to "no
// metadata" rather than throw out of the extract, and a fact the container never
// stated must not be invented.
//
// MP4/MOV and WebM are entirely different containers — a box tree versus an EBML
// tree — so the fixtures below build each from scratch.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as Mp4Module from '@cardstack/base/mp4-meta-extractor';
import type * as VideoFileDefModule from '@cardstack/base/video-file-def';
import type * as VideoMetadataModule from '@cardstack/base/video-metadata';
import type * as WebmModule from '@cardstack/base/webm-meta-extractor';

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

function uint32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function int32be(value: number): number[] {
  return uint32be(value >>> 0);
}

// ---- ISO BMFF (MP4 / MOV) ----

function box(type: string, body: number[]): number[] {
  return [...uint32be(8 + body.length), ...ascii(type), ...body];
}

// A 3x3 display matrix in 16.16 fixed point, for the given right angle.
function rotationMatrix(degrees: number): number[] {
  const ONE = 0x00010000;
  let pairs: Record<number, [number, number]> = {
    0: [ONE, 0],
    90: [0, ONE],
    180: [-ONE, 0],
    270: [0, -ONE],
  };
  let [a, b] = pairs[degrees] ?? pairs[0]!;
  // Only the first row is read; the rest is filled with a plausible remainder.
  return [
    ...int32be(a),
    ...int32be(b),
    ...uint32be(0),
    ...uint32be(0),
    ...uint32be(ONE),
    ...uint32be(0),
    ...uint32be(0),
    ...uint32be(0),
    ...uint32be(0x40000000),
  ];
}

function tkhd(width: number, height: number, rotationDegrees = 0): number[] {
  return box('tkhd', [
    0,
    0,
    0,
    0, // version 0 + flags
    ...uint32be(0), // creation
    ...uint32be(0), // modification
    ...uint32be(1), // track id
    ...uint32be(0), // reserved
    ...uint32be(0), // duration
    ...uint32be(0), // reserved
    ...uint32be(0), // reserved
    ...uint32be(0), // layer + alternate group
    ...uint32be(0), // volume + reserved
    ...rotationMatrix(rotationDegrees),
    ...uint32be(width * 65536),
    ...uint32be(height * 65536),
  ]);
}

function mdhd(timescale: number, duration: number): number[] {
  return box('mdhd', [
    0,
    0,
    0,
    0, // version 0 + flags
    ...uint32be(0), // creation
    ...uint32be(0), // modification
    ...uint32be(timescale),
    ...uint32be(duration),
    ...uint32be(0), // language + quality
  ]);
}

function hdlr(handler: string): number[] {
  return box('hdlr', [
    0,
    0,
    0,
    0, // version + flags
    ...uint32be(0), // pre_defined
    ...ascii(handler),
    ...new Array(12).fill(0), // reserved
    0, // empty name
  ]);
}

// stts as a single run of `frames` samples.
function stts(frames: number, sampleDuration: number): number[] {
  return box('stts', [
    0,
    0,
    0,
    0, // version + flags
    ...uint32be(1), // one entry
    ...uint32be(frames),
    ...uint32be(sampleDuration),
  ]);
}

function stsd(sampleEntryType: string): number[] {
  return box('stsd', [
    0,
    0,
    0,
    0, // version + flags
    ...uint32be(1), // entry count
    ...box(sampleEntryType, new Array(70).fill(0)),
  ]);
}

function trak(options: {
  handler: string;
  width?: number;
  height?: number;
  rotationDegrees?: number;
  codec: string;
  timescale?: number;
  duration?: number;
  frames?: number;
}): number[] {
  let timescale = options.timescale ?? 600;
  let duration = options.duration ?? 6000;
  let stblBody = [...stsd(options.codec)];
  if (options.frames) {
    stblBody.push(...stts(options.frames, duration / options.frames));
  }
  return box('trak', [
    ...tkhd(options.width ?? 0, options.height ?? 0, options.rotationDegrees),
    ...box('mdia', [
      ...mdhd(timescale, duration),
      ...hdlr(options.handler),
      ...box('minf', [...box('stbl', stblBody)]),
    ]),
  ]);
}

function mvhd(timescale: number, duration: number): number[] {
  return box('mvhd', [
    0,
    0,
    0,
    0, // version 0 + flags
    ...uint32be(0),
    ...uint32be(0),
    ...uint32be(timescale),
    ...uint32be(duration),
    ...new Array(80).fill(0),
  ]);
}

function buildMp4(
  traks: number[][],
  options: { timescale?: number; duration?: number; withFtyp?: boolean } = {},
): Uint8Array {
  let moov = box('moov', [
    ...mvhd(options.timescale ?? 600, options.duration ?? 6000),
    ...traks.flat(),
  ]);
  let ftyp =
    options.withFtyp === false
      ? []
      : box('ftyp', [...ascii('isom'), ...uint32be(512), ...ascii('isom')]);
  // A little mdat so the file looks like a real one.
  return new Uint8Array([...ftyp, ...moov, ...box('mdat', [1, 2, 3, 4])]);
}

// ---- EBML (WebM) ----

// Encode an EBML id, which is written with its length marker intact.
function ebmlId(id: number): number[] {
  let bytes: number[] = [];
  let value = id;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return bytes;
}

// Encode a size with the leading length marker EBML expects.
function ebmlSize(size: number): number[] {
  if (size < 0x7f) {
    return [0x80 | size];
  }
  if (size < 0x3fff) {
    return [0x40 | (size >> 8), size & 0xff];
  }
  return [0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff];
}

function ebml(id: number, body: number[]): number[] {
  return [...ebmlId(id), ...ebmlSize(body.length), ...body];
}

function ebmlUint(value: number): number[] {
  if (value === 0) {
    return [0];
  }
  let bytes: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function ebmlFloat64(value: number): number[] {
  let buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value);
  return [...new Uint8Array(buffer)];
}

function buildWebm(options: {
  timecodeScale?: number;
  durationTicks?: number;
  video?: {
    codec: string;
    pixelWidth: number;
    pixelHeight: number;
    displayWidth?: number;
    displayHeight?: number;
    defaultDurationNs?: number;
  };
  audio?: { codec: string };
}): Uint8Array {
  let header = ebml(0x1a45dfa3, [...ebml(0x4286, ebmlUint(1))]);

  let info: number[] = [];
  if (options.timecodeScale !== undefined) {
    info.push(...ebml(0x2ad7b1, ebmlUint(options.timecodeScale)));
  }
  if (options.durationTicks !== undefined) {
    info.push(...ebml(0x4489, ebmlFloat64(options.durationTicks)));
  }

  let trackEntries: number[] = [];
  if (options.video) {
    let videoBody = [
      ...ebml(0xb0, ebmlUint(options.video.pixelWidth)),
      ...ebml(0xba, ebmlUint(options.video.pixelHeight)),
      ...(options.video.displayWidth === undefined
        ? []
        : ebml(0x54b0, ebmlUint(options.video.displayWidth))),
      ...(options.video.displayHeight === undefined
        ? []
        : ebml(0x54ba, ebmlUint(options.video.displayHeight))),
    ];
    trackEntries.push(
      ...ebml(0xae, [
        ...ebml(0x83, ebmlUint(1)), // track type: video
        ...ebml(0x86, ascii(options.video.codec)),
        ...(options.video.defaultDurationNs === undefined
          ? []
          : ebml(0x23e383, ebmlUint(options.video.defaultDurationNs))),
        ...ebml(0xe0, videoBody),
      ]),
    );
  }
  if (options.audio) {
    trackEntries.push(
      ...ebml(0xae, [
        ...ebml(0x83, ebmlUint(2)), // track type: audio
        ...ebml(0x86, ascii(options.audio.codec)),
      ]),
    );
  }

  let segmentBody = [
    ...(info.length > 0 ? ebml(0x1549a966, info) : []),
    ...(trackEntries.length > 0 ? ebml(0x1654ae6b, trackEntries) : []),
    // A Cluster, which the walk should simply pass over.
    ...ebml(0x1f43b675, [0x00]),
  ];
  return new Uint8Array([...header, ...ebml(0x18538067, segmentBody)]);
}

module('Unit | video metadata extractors', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractMp4VideoEncoding: typeof Mp4Module.extractMp4VideoEncoding;
  let assertMp4Container: typeof Mp4Module.assertMp4Container;
  let extractWebmEncoding: typeof WebmModule.extractWebmEncoding;
  let displayDimensions: typeof VideoMetadataModule.displayDimensions;
  let videoAttributes: typeof VideoFileDefModule.videoAttributes;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractMp4VideoEncoding, assertMp4Container } = await loader.import<
      typeof Mp4Module
    >('@cardstack/base/mp4-meta-extractor'));
    ({ extractWebmEncoding } = await loader.import<typeof WebmModule>(
      '@cardstack/base/webm-meta-extractor',
    ));
    ({ displayDimensions } = await loader.import<typeof VideoMetadataModule>(
      '@cardstack/base/video-metadata',
    ));
    ({ videoAttributes } = await loader.import<typeof VideoFileDefModule>(
      '@cardstack/base/video-file-def',
    ));
  });

  module('MP4 / MOV', function () {
    test('reads dimensions, codec, and duration from the video track', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'vide', width: 1920, height: 1080, codec: 'avc1' }),
        ]),
      );
      assert.strictEqual(encoding?.container, 'MP4');
      assert.strictEqual(encoding?.videoCodec, 'H.264 (AVC)');
      assert.strictEqual(encoding?.width, 1920);
      assert.strictEqual(encoding?.height, 1080);
      assert.strictEqual(encoding?.durationSeconds, 10, '6000 / 600 timescale');
    });

    test('picks the picture track rather than whichever comes first', function (assert) {
      // Real files routinely put the audio track first.
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'soun', codec: 'mp4a' }),
          trak({ handler: 'vide', width: 1280, height: 720, codec: 'hvc1' }),
        ]),
      );
      assert.strictEqual(encoding?.width, 1280);
      assert.strictEqual(encoding?.videoCodec, 'H.265 (HEVC)');
      assert.strictEqual(encoding?.audioCodec, 'AAC');
      assert.true(encoding?.hasAudio);
    });

    test('a silent video reports no audio rather than omitting the question', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'vide', width: 640, height: 480, codec: 'avc1' }),
        ]),
      );
      assert.false(encoding?.hasAudio);
      assert.strictEqual(encoding?.audioCodec, undefined);
    });

    test('reads a quarter-turn out of the display matrix', function (assert) {
      // A phone shoots landscape and asks for a 90-degree rotation, so the file
      // stores 1920x1080 but should present as 1080x1920. Ignoring the matrix
      // reports the wrong shape for a large share of real video.
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({
            handler: 'vide',
            width: 1920,
            height: 1080,
            rotationDegrees: 90,
            codec: 'avc1',
          }),
        ]),
      );
      assert.strictEqual(encoding?.rotationDegrees, 90);
      assert.strictEqual(encoding?.width, 1920, 'stored dimensions are as-is');
      assert.deepEqual(
        displayDimensions(encoding!),
        { width: 1080, height: 1920 },
        'but the presented shape swaps the axes',
      );
    });

    test('an upright video needs no swap', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'vide', width: 1920, height: 1080, codec: 'avc1' }),
        ]),
      );
      assert.strictEqual(encoding?.rotationDegrees, 0);
      assert.deepEqual(displayDimensions(encoding!), {
        width: 1920,
        height: 1080,
      });
    });

    test('a half-turn keeps the axes', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({
            handler: 'vide',
            width: 1920,
            height: 1080,
            rotationDegrees: 180,
            codec: 'avc1',
          }),
        ]),
      );
      assert.deepEqual(displayDimensions(encoding!), {
        width: 1920,
        height: 1080,
      });
    });

    test('derives frame rate from the sample table, not from one sample', function (assert) {
      // 240 samples over 10 seconds is 24 fps. Taking any single sample's
      // duration would misreport a variable-rate file.
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({
            handler: 'vide',
            width: 1920,
            height: 1080,
            codec: 'avc1',
            frames: 240,
          }),
        ]),
      );
      assert.strictEqual(encoding?.frameRate, 24);
    });

    test('omits the frame rate when there is no sample table to derive it from', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'vide', width: 640, height: 480, codec: 'avc1' }),
        ]),
      );
      assert.strictEqual(encoding?.frameRate, undefined);
    });

    test('leaves an unrecognized codec unnamed rather than guessing', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'vide', width: 640, height: 480, codec: 'zzzz' }),
        ]),
      );
      assert.strictEqual(encoding?.videoCodec, undefined);
      assert.strictEqual(
        encoding?.width,
        640,
        'the rest of the track still reads',
      );
    });

    test('MOV reports its own container name from the same reader', function (assert) {
      let encoding = extractMp4VideoEncoding(
        buildMp4([
          trak({ handler: 'vide', width: 1920, height: 1080, codec: 'apcn' }),
        ]),
        'QuickTime',
      );
      assert.strictEqual(encoding?.container, 'QuickTime');
      assert.strictEqual(encoding?.videoCodec, 'Apple ProRes 422');
    });

    test('a file with no moov yields nothing rather than throwing', function (assert) {
      let noMoov = new Uint8Array([
        ...box('ftyp', ascii('isom')),
        ...box('mdat', [1, 2, 3, 4]),
      ]);
      assert.strictEqual(extractMp4VideoEncoding(noMoov), undefined);
    });

    test('a truncated box tree yields nothing rather than throwing', function (assert) {
      let full = buildMp4([
        trak({ handler: 'vide', width: 640, height: 480, codec: 'avc1' }),
      ]);
      let truncated = full.subarray(0, 40);
      assert.strictEqual(extractMp4VideoEncoding(truncated), undefined);
    });

    test('rejects a file that is not an ISO BMFF container', function (assert) {
      assert.throws(
        () => assertMp4Container(new Uint8Array(64).fill(0x41)),
        /ISO BMFF/,
        'the extractor falls back to the base FileDef',
      );
    });

    test('accepts a QuickTime file that leads with moov instead of ftyp', function (assert) {
      let bytes = buildMp4(
        [trak({ handler: 'vide', width: 640, height: 480, codec: 'avc1' })],
        { withFtyp: false },
      );
      assertMp4Container(bytes);
      assert.strictEqual(extractMp4VideoEncoding(bytes)?.width, 640);
    });
  });

  module('WebM', function () {
    test('reads dimensions, codec, and duration from the EBML tree', function (assert) {
      let encoding = extractWebmEncoding(
        buildWebm({
          timecodeScale: 1_000_000,
          durationTicks: 10_000, // ticks of 1 ms
          video: { codec: 'V_VP9', pixelWidth: 1920, pixelHeight: 1080 },
        }),
      );
      assert.strictEqual(encoding?.container, 'WebM');
      assert.strictEqual(encoding?.videoCodec, 'VP9');
      assert.strictEqual(encoding?.width, 1920);
      assert.strictEqual(encoding?.height, 1080);
      assert.strictEqual(encoding?.durationSeconds, 10);
    });

    test('scales duration by the timecode scale the segment declares', function (assert) {
      // A microsecond scale means the same tick count is a thousandth as long.
      let encoding = extractWebmEncoding(
        buildWebm({
          timecodeScale: 1_000,
          durationTicks: 10_000,
          video: { codec: 'V_VP8', pixelWidth: 640, pixelHeight: 480 },
        }),
      );
      assert.strictEqual(encoding?.durationSeconds, 0.01);
    });

    test('defaults the timecode scale when the segment omits it', function (assert) {
      let encoding = extractWebmEncoding(
        buildWebm({
          durationTicks: 5_000,
          video: { codec: 'V_VP8', pixelWidth: 640, pixelHeight: 480 },
        }),
      );
      assert.strictEqual(
        encoding?.durationSeconds,
        5,
        'the spec default is one millisecond per tick',
      );
    });

    test('display dimensions win over the pixel grid for anamorphic content', function (assert) {
      let encoding = extractWebmEncoding(
        buildWebm({
          video: {
            codec: 'V_VP9',
            pixelWidth: 720,
            pixelHeight: 480,
            displayWidth: 854,
            displayHeight: 480,
          },
        }),
      );
      assert.strictEqual(encoding?.width, 854);
      assert.strictEqual(encoding?.height, 480);
    });

    test('derives frame rate from the default frame duration', function (assert) {
      // 41,666,667 ns per frame is 24 fps.
      let encoding = extractWebmEncoding(
        buildWebm({
          video: {
            codec: 'V_AV1',
            pixelWidth: 1920,
            pixelHeight: 1080,
            defaultDurationNs: 41_666_667,
          },
        }),
      );
      assert.strictEqual(encoding?.frameRate, 24);
    });

    test('reports an audio track alongside the video', function (assert) {
      let encoding = extractWebmEncoding(
        buildWebm({
          video: { codec: 'V_VP9', pixelWidth: 640, pixelHeight: 480 },
          audio: { codec: 'A_OPUS' },
        }),
      );
      assert.strictEqual(encoding?.audioCodec, 'Opus');
      assert.true(encoding?.hasAudio);
    });

    test('keeps an unrecognized codec id verbatim rather than dropping it', function (assert) {
      // Unlike a four-character code, a Matroska codec id is already a readable
      // string, so an unmapped one is still worth showing.
      let encoding = extractWebmEncoding(
        buildWebm({
          video: { codec: 'V_SOMETHING_NEW', pixelWidth: 64, pixelHeight: 64 },
        }),
      );
      assert.strictEqual(encoding?.videoCodec, 'V_SOMETHING_NEW');
    });

    test('never claims a rotation, which Matroska rarely states', function (assert) {
      let encoding = extractWebmEncoding(
        buildWebm({
          video: { codec: 'V_VP9', pixelWidth: 640, pixelHeight: 480 },
        }),
      );
      assert.strictEqual(
        encoding?.rotationDegrees,
        undefined,
        'unset rather than defaulted to zero, which would claim knowledge',
      );
    });

    test('a non-EBML buffer yields nothing rather than throwing', function (assert) {
      assert.strictEqual(
        extractWebmEncoding(new Uint8Array(128).fill(0x41)),
        undefined,
      );
    });

    test('a truncated tree yields nothing rather than throwing', function (assert) {
      let full = buildWebm({
        video: { codec: 'V_VP9', pixelWidth: 640, pixelHeight: 480 },
      });
      assert.strictEqual(extractWebmEncoding(full.subarray(0, 8)), undefined);
    });
  });

  module('attribute assembly', function () {
    test('applies rotation so the fields carry the presented shape', function (assert) {
      let attributes = videoAttributes({
        container: 'MP4',
        width: 1920,
        height: 1080,
        rotationDegrees: 90,
        durationSeconds: 12.5,
      });
      assert.strictEqual(attributes.width, 1080);
      assert.strictEqual(attributes.height, 1920);
      assert.strictEqual(attributes.duration, 12.5);
    });

    test('wraps the frame rate as a quantity', function (assert) {
      let attributes = videoAttributes({
        container: 'WebM',
        videoCodec: 'VP9',
        frameRate: 29.97,
      });
      assert.deepEqual(attributes.encoding?.frameRate, {
        value: 29.97,
        unit: 'fps',
      });
    });

    test('a container that revealed nothing adds no attributes', function (assert) {
      assert.deepEqual(videoAttributes(undefined), {});
    });
  });
});
