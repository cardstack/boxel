// Byte-level tests for the audio encoding and tag readers, and for the waveform
// reduction.
//
// Same contract as the image readers: these run during indexing against whatever
// a realm holds, so a truncated or hostile file must degrade to "no metadata"
// rather than throw out of the extract, and a fact the container never stated
// must not be invented.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as AudioFileDefModule from '@cardstack/base/audio-file-def';
import type * as AudioWaveformModule from '@cardstack/base/audio-waveform';
import type * as FlacModule from '@cardstack/base/flac-meta-extractor';
import type * as Id3Module from '@cardstack/base/id3v2-parser';
import type * as MidiModule from '@cardstack/base/midi-meta-extractor';
import type * as Mp3Module from '@cardstack/base/mp3-meta-extractor';
import type * as OggModule from '@cardstack/base/ogg-meta-extractor';
import type * as StreamingEnvelopeModule from '@cardstack/base/streaming-envelope';
import type * as VorbisModule from '@cardstack/base/vorbis-comment-parser';
import type * as WavModule from '@cardstack/base/wav-meta-extractor';

// Hand a reader a stream that yields small chunks, so a frame or sample lands
// across chunk boundaries — the case a buffered reader never exercises.
function chunkedStream(
  bytes: Uint8Array,
  chunkSize: number,
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      let end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

function uint32le(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function uint32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function uint16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

// ---- WAV ----

function riffChunk(id: string, body: number[]): number[] {
  // RIFF chunks are word-aligned, so an odd-sized body carries a pad byte.
  let pad = body.length % 2 === 1 ? [0] : [];
  return [...ascii(id), ...uint32le(body.length), ...body, ...pad];
}

function buildWav(
  fmt: {
    formatCode?: number;
    channels?: number;
    sampleRate?: number;
    bitsPerSample?: number;
  } = {},
  infoEntries: [string, string][] = [],
): Uint8Array {
  let channels = fmt.channels ?? 2;
  let sampleRate = fmt.sampleRate ?? 44100;
  let bitsPerSample = fmt.bitsPerSample ?? 16;
  let byteRate = (sampleRate * channels * bitsPerSample) / 8;
  let blockAlign = (channels * bitsPerSample) / 8;
  let fmtBody = [
    ...uint16le(fmt.formatCode ?? 1),
    ...uint16le(channels),
    ...uint32le(sampleRate),
    ...uint32le(byteRate),
    ...uint16le(blockAlign),
    ...uint16le(bitsPerSample),
  ];
  let chunks = [...riffChunk('fmt ', fmtBody)];
  if (infoEntries.length > 0) {
    let infoBody = [...ascii('INFO')];
    for (let [id, value] of infoEntries) {
      // LIST-INFO values are NUL-terminated Latin-1.
      infoBody.push(...riffChunk(id, [...ascii(value), 0]));
    }
    chunks.push(...riffChunk('LIST', infoBody));
  }
  chunks.push(...riffChunk('data', new Array(64).fill(0)));
  let payload = [...ascii('WAVE'), ...chunks];
  return new Uint8Array([
    ...ascii('RIFF'),
    ...uint32le(payload.length),
    ...payload,
  ]);
}

// ---- FLAC ----

function buildFlac(
  streamInfo: {
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
  } = {},
  comments?: [string, string][],
  seekPoints = 0,
): Uint8Array {
  let sampleRate = streamInfo.sampleRate ?? 44100;
  let channels = streamInfo.channels ?? 2;
  let bitsPerSample = streamInfo.bitsPerSample ?? 16;
  let totalSamples = 44100;

  // STREAMINFO: 10 bytes of block sizes and frame sizes, then the packed field.
  let block = new Array(34).fill(0);
  // Packed across bytes 10..17: 20 bits sample rate, 3 bits channels-1,
  // 5 bits bitsPerSample-1, 36 bits total samples.
  block[10] = (sampleRate >>> 12) & 0xff;
  block[11] = (sampleRate >>> 4) & 0xff;
  block[12] =
    ((sampleRate & 0x0f) << 4) |
    (((channels - 1) & 0x07) << 1) |
    (((bitsPerSample - 1) >>> 4) & 0x01);
  block[13] =
    (((bitsPerSample - 1) & 0x0f) << 4) | ((totalSamples >>> 32) & 0x0f);
  block[14] = (totalSamples >>> 24) & 0xff;
  block[15] = (totalSamples >>> 16) & 0xff;
  block[16] = (totalSamples >>> 8) & 0xff;
  block[17] = totalSamples & 0xff;

  let hasComments = comments !== undefined;
  let out = [
    ...ascii('fLaC'),
    // STREAMINFO header: type 0, not last when another block follows.
    hasComments ? 0x00 : 0x80,
    0x00,
    0x00,
    0x22,
    ...block,
  ];
  if (seekPoints > 0) {
    // A SEEKTABLE (type 3) of 18 bytes per point, which most rippers write and
    // which sits ahead of the comment block.
    let length = seekPoints * 18;
    out.push(
      0x03,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
      ...new Array(length).fill(0),
    );
  }
  if (comments) {
    let body = vorbisCommentBody(comments);
    out.push(
      0x84, // last block, type 4 (VORBIS_COMMENT)
      (body.length >>> 16) & 0xff,
      (body.length >>> 8) & 0xff,
      body.length & 0xff,
      ...body,
    );
  }
  return new Uint8Array(out);
}

function vorbisCommentBody(entries: [string, string][]): number[] {
  let vendor = ascii('test-vendor');
  let out = [
    ...uint32le(vendor.length),
    ...vendor,
    ...uint32le(entries.length),
  ];
  for (let [key, value] of entries) {
    let entry = ascii(`${key}=${value}`);
    out.push(...uint32le(entry.length), ...entry);
  }
  return out;
}

// ---- Ogg ----

function buildOggPage(payload: number[]): number[] {
  // A 27-byte page header plus a one-byte segment table describing one segment.
  return [
    ...ascii('OggS'),
    0, // version
    2, // header type: first page of logical stream
    ...new Array(8).fill(0), // granule position
    ...uint32le(1), // serial
    ...uint32le(0), // page sequence
    ...uint32le(0), // checksum (unread)
    1, // one segment
    Math.min(payload.length, 255),
    ...payload,
  ];
}

function buildOggVorbis(
  channels = 2,
  sampleRate = 44100,
  nominalBitrate = 128000,
  comments?: [string, string][],
): Uint8Array {
  let id = [
    0x01,
    ...ascii('vorbis'),
    ...uint32le(0), // version
    channels,
    ...uint32le(sampleRate),
    ...uint32le(0), // max bitrate
    ...uint32le(nominalBitrate),
    ...uint32le(0), // min bitrate
    0x00, // blocksizes
    0x01, // framing
  ];
  let out = buildOggPage(id);
  if (comments) {
    out.push(
      ...buildOggPage([
        0x03,
        ...ascii('vorbis'),
        ...vorbisCommentBody(comments),
      ]),
    );
  }
  return new Uint8Array(out);
}

function buildOggOpus(channels = 2, comments?: [string, string][]): Uint8Array {
  let id = [
    ...ascii('OpusHead'),
    1, // version
    channels,
    ...uint16le(312), // pre-skip
    ...uint32le(48000), // input sample rate
    ...uint16le(0), // output gain
    0, // channel mapping family
  ];
  let out = buildOggPage(id);
  if (comments) {
    out.push(
      ...buildOggPage([...ascii('OpusTags'), ...vorbisCommentBody(comments)]),
    );
  }
  return new Uint8Array(out);
}

// ---- ID3v2 ----

function syncsafe(value: number): number[] {
  return [
    (value >>> 21) & 0x7f,
    (value >>> 14) & 0x7f,
    (value >>> 7) & 0x7f,
    value & 0x7f,
  ];
}

// A v2.3 tag (plain big-endian frame sizes), the common case in the wild.
function buildId3v2(
  frames: [string, number[]][],
  majorVersion = 3,
): Uint8Array {
  let body: number[] = [];
  // Appended rather than spread: a frame carrying artwork runs to hundreds of
  // thousands of bytes, and `push(...payload)` exceeds the argument limit.
  let append = (values: number[]) => {
    for (let value of values) {
      body.push(value);
    }
  };
  for (let [id, payload] of frames) {
    append(ascii(id));
    append(
      majorVersion >= 4 ? syncsafe(payload.length) : uint32be(payload.length),
    );
    append([0, 0]); // frame flags
    append(payload);
  }
  // Trailing padding, which the walk must treat as the end of the frames.
  body.push(0, 0, 0, 0);
  return new Uint8Array([
    ...ascii('ID3'),
    majorVersion,
    0, // revision
    0, // flags
    ...syncsafe(body.length),
    ...body,
  ]);
}

// A Latin-1 text frame: encoding byte 0, then NUL-terminated text.
function latin1Frame(text: string): number[] {
  return [0, ...ascii(text), 0];
}

// ---- MP3 ----

// A single MPEG-1 Layer III frame header: 44.1 kHz, 128 kbps, joint stereo.
function buildMp3Frame(options: { withXing?: boolean } = {}): number[] {
  let header = [
    0xff,
    0xfb, // MPEG-1, Layer III, no CRC
    0x90, // bitrate index 9 (128 kbps), sample rate index 0 (44100)
    0x40, // joint stereo
  ];
  let body: number[] = [];
  if (options.withXing) {
    // The duration reader scans a small window after the header for this tag.
    body.push(
      ...new Array(32).fill(0),
      ...ascii('Xing'),
      ...uint32be(0x0001), // flags: frame count present
      ...uint32be(1000), // total frames
    );
  }
  return [...header, ...body, ...new Array(64).fill(0)];
}

module('Unit | audio metadata extractors', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractWavEncoding: typeof WavModule.extractWavEncoding;
  let extractWavTags: typeof WavModule.extractWavTags;
  let extractWavFromStream: typeof WavModule.extractWavFromStream;
  let extractFlacEncoding: typeof FlacModule.extractFlacEncoding;
  let extractFlacTags: typeof FlacModule.extractFlacTags;
  let FLAC_METADATA_WINDOW_BYTES: number;
  let extractOggEncoding: typeof OggModule.extractOggEncoding;
  let extractOggTags: typeof OggModule.extractOggTags;
  let extractMp3Encoding: typeof Mp3Module.extractMp3Encoding;
  let extractMp3Envelope: typeof Mp3Module.extractMp3Envelope;
  let extractMp3EnvelopeFromStream: typeof Mp3Module.extractMp3EnvelopeFromStream;
  let StreamingEnvelope: typeof StreamingEnvelopeModule.StreamingEnvelope;
  let parseId3v2Tags: typeof Id3Module.parseId3v2Tags;
  let parseVorbisComments: typeof VorbisModule.parseVorbisComments;
  let analyzeDecodedAudio: typeof AudioWaveformModule.analyzeDecodedAudio;
  let audioAttributes: typeof AudioFileDefModule.audioAttributes;
  let extractMidiMetadata: typeof MidiModule.extractMidiMetadata;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractWavEncoding, extractWavTags, extractWavFromStream } =
      await loader.import<typeof WavModule>(
        '@cardstack/base/wav-meta-extractor',
      ));
    ({ extractFlacEncoding, extractFlacTags, FLAC_METADATA_WINDOW_BYTES } =
      await loader.import<typeof FlacModule>(
        '@cardstack/base/flac-meta-extractor',
      ));
    ({ extractOggEncoding, extractOggTags } = await loader.import<
      typeof OggModule
    >('@cardstack/base/ogg-meta-extractor'));
    ({ extractMp3Encoding, extractMp3Envelope, extractMp3EnvelopeFromStream } =
      await loader.import<typeof Mp3Module>(
        '@cardstack/base/mp3-meta-extractor',
      ));
    ({ StreamingEnvelope } = await loader.import<
      typeof StreamingEnvelopeModule
    >('@cardstack/base/streaming-envelope'));
    ({ parseId3v2Tags } = await loader.import<typeof Id3Module>(
      '@cardstack/base/id3v2-parser',
    ));
    ({ parseVorbisComments } = await loader.import<typeof VorbisModule>(
      '@cardstack/base/vorbis-comment-parser',
    ));
    ({ analyzeDecodedAudio } = await loader.import<typeof AudioWaveformModule>(
      '@cardstack/base/audio-waveform',
    ));
    ({ audioAttributes } = await loader.import<typeof AudioFileDefModule>(
      '@cardstack/base/audio-file-def',
    ));
    ({ extractMidiMetadata } = await loader.import<typeof MidiModule>(
      '@cardstack/base/midi-meta-extractor',
    ));
  });

  module('WAV', function () {
    test('reads the sample layout the fmt chunk states outright', function (assert) {
      let encoding = extractWavEncoding(
        buildWav({ channels: 2, sampleRate: 48000, bitsPerSample: 24 }),
      );
      assert.strictEqual(encoding?.container, 'WAV');
      assert.strictEqual(encoding?.audioCodec, 'PCM');
      assert.strictEqual(encoding?.sampleRateHz, 48000);
      assert.strictEqual(encoding?.bitDepth, 24);
      assert.strictEqual(encoding?.channels, 2);
      assert.strictEqual(encoding?.channelMode, 'stereo');
      assert.false(
        encoding?.isVariableBitrate,
        'PCM is constant-rate by definition',
      );
      // 48000 × 2 × 3 bytes × 8 bits
      assert.strictEqual(encoding?.bitrateBps, 48000 * 2 * 3 * 8);
    });

    test('names the float and companded format codes', function (assert) {
      assert.strictEqual(
        extractWavEncoding(buildWav({ formatCode: 3 }))?.audioCodec,
        'IEEE float',
      );
      assert.strictEqual(
        extractWavEncoding(buildWav({ formatCode: 7 }))?.audioCodec,
        'μ-law',
      );
    });

    test('leaves an unrecognized format code unnamed rather than guessing', function (assert) {
      let encoding = extractWavEncoding(buildWav({ formatCode: 0x1234 }));
      assert.strictEqual(encoding?.audioCodec, undefined);
      assert.strictEqual(
        encoding?.sampleRateHz,
        44100,
        'the layout still reads even when the codec does not',
      );
    });

    test('reads a mono file as mono', function (assert) {
      assert.strictEqual(
        extractWavEncoding(buildWav({ channels: 1 }))?.channelMode,
        'mono',
      );
    });

    test('reads LIST-INFO tags', function (assert) {
      let tags = extractWavTags(
        buildWav({}, [
          ['INAM', 'Field Recording'],
          ['IART', 'A Recordist'],
          ['ICRD', '2021-07-04'],
          ['IGNR', 'Ambient'],
        ]),
      );
      assert.strictEqual(tags?.trackTitle, 'Field Recording');
      assert.strictEqual(tags?.artist, 'A Recordist');
      assert.strictEqual(
        tags?.year,
        2021,
        'a full date yields just its leading year',
      );
      assert.strictEqual(tags?.genre, 'Ambient');
      assert.deepEqual(tags?.scheme, 'riff-info');
    });

    test('a WAV with no LIST chunk produces no tags at all', function (assert) {
      assert.strictEqual(
        extractWavTags(buildWav()),
        undefined,
        'a tag block carrying only its scheme is not worth an index row',
      );
    });

    test('a truncated file yields nothing rather than throwing', function (assert) {
      let short = buildWav().subarray(0, 20);
      assert.strictEqual(extractWavEncoding(short), undefined);
      assert.strictEqual(extractWavTags(short), undefined);
    });
  });

  module('FLAC', function () {
    test('reads the sample layout from STREAMINFO', function (assert) {
      let encoding = extractFlacEncoding(
        buildFlac({ sampleRate: 96000, channels: 2, bitsPerSample: 24 }),
      );
      assert.strictEqual(encoding?.container, 'FLAC');
      assert.strictEqual(encoding?.audioCodec, 'FLAC');
      assert.strictEqual(encoding?.sampleRateHz, 96000);
      assert.strictEqual(encoding?.bitDepth, 24);
      assert.strictEqual(encoding?.channels, 2);
      assert.true(
        encoding?.isVariableBitrate,
        'lossless compression has no constant rate to report',
      );
      assert.strictEqual(
        encoding?.bitrateBps,
        undefined,
        'FLAC never states a bitrate, so none is invented',
      );
    });

    test('reads a 16-bit mono stream', function (assert) {
      let encoding = extractFlacEncoding(
        buildFlac({ sampleRate: 22050, channels: 1, bitsPerSample: 16 }),
      );
      assert.strictEqual(encoding?.sampleRateHz, 22050);
      assert.strictEqual(encoding?.channels, 1);
      assert.strictEqual(encoding?.bitDepth, 16);
      assert.strictEqual(encoding?.channelMode, 'mono');
    });

    test('reads Vorbis comments from the metadata block', function (assert) {
      let tags = extractFlacTags(
        buildFlac({}, [
          ['TITLE', 'Nocturne'],
          ['ARTIST', 'A Pianist'],
          ['ALBUM', 'Night Pieces'],
          ['DATE', '1994'],
          ['TRACKNUMBER', '3'],
        ]),
      );
      assert.strictEqual(tags?.trackTitle, 'Nocturne');
      assert.strictEqual(tags?.artist, 'A Pianist');
      assert.strictEqual(tags?.album, 'Night Pieces');
      assert.strictEqual(tags?.year, 1994);
      assert.strictEqual(tags?.track, '3');
      assert.strictEqual(tags?.scheme, 'vorbis-comment');
    });

    test('finds tags behind a seek table, which the old window truncated', function (assert) {
      // A 1000-point SEEKTABLE puts the comment block ~18 KB into the file. The
      // read window used to be 256 bytes, so tags on any ripper-written file
      // silently came back empty — a short window yields no tags rather than an
      // error, which is what made it invisible.
      let bytes = buildFlac(
        {},
        [
          ['TITLE', 'Behind A Seek Table'],
          ['ARTIST', 'A Pianist'],
        ],
        1000,
      );
      assert.true(
        bytes.length > 18_000,
        'the fixture really does push the comment block deep',
      );
      let windowed = bytes.subarray(0, FLAC_METADATA_WINDOW_BYTES);
      assert.strictEqual(
        extractFlacTags(windowed)?.trackTitle,
        'Behind A Seek Table',
        'the window reaches the comment block',
      );
      assert.strictEqual(
        extractFlacTags(bytes.subarray(0, 256)),
        undefined,
        'and the old 256-byte window demonstrably did not',
      );
    });

    test('a FLAC with no comment block produces no tags', function (assert) {
      assert.strictEqual(extractFlacTags(buildFlac()), undefined);
    });

    test('a non-FLAC buffer yields nothing rather than throwing', function (assert) {
      let notFlac = new Uint8Array(64).fill(0x41);
      assert.strictEqual(extractFlacEncoding(notFlac), undefined);
      assert.strictEqual(extractFlacTags(notFlac), undefined);
    });
  });

  module('Ogg', function () {
    test('reads the Vorbis identification header', function (assert) {
      let encoding = extractOggEncoding(buildOggVorbis(2, 44100, 160000));
      assert.strictEqual(encoding?.container, 'Ogg');
      assert.strictEqual(encoding?.audioCodec, 'Vorbis');
      assert.strictEqual(encoding?.sampleRateHz, 44100);
      assert.strictEqual(encoding?.bitrateBps, 160000);
      assert.strictEqual(encoding?.channels, 2);
    });

    test('an undeclared nominal bitrate is omitted, not reported as zero', function (assert) {
      assert.strictEqual(
        extractOggEncoding(buildOggVorbis(2, 44100, 0))?.bitrateBps,
        undefined,
      );
    });

    test('Opus reports the 48 kHz rate it actually decodes to', function (assert) {
      let encoding = extractOggEncoding(buildOggOpus(2));
      assert.strictEqual(encoding?.audioCodec, 'Opus');
      assert.strictEqual(
        encoding?.sampleRateHz,
        48000,
        'Opus always decodes to 48 kHz whatever it was captured at',
      );
      assert.strictEqual(encoding?.channels, 2);
    });

    test('reads Vorbis comments from a following page', function (assert) {
      let tags = extractOggTags(
        buildOggVorbis(2, 44100, 128000, [
          ['TITLE', 'Tape Loop'],
          ['ARTIST', 'A Composer'],
        ]),
      );
      assert.strictEqual(tags?.trackTitle, 'Tape Loop');
      assert.strictEqual(tags?.artist, 'A Composer');
    });

    test('reads OpusTags', function (assert) {
      let tags = extractOggTags(buildOggOpus(1, [['TITLE', 'Voice Memo']]));
      assert.strictEqual(tags?.trackTitle, 'Voice Memo');
    });

    test('a non-Ogg buffer yields nothing', function (assert) {
      assert.strictEqual(
        extractOggEncoding(new Uint8Array(64).fill(0x41)),
        undefined,
      );
    });
  });

  module('MP3', function () {
    test('reads the frame header and reports a constant rate as constant', function (assert) {
      let encoding = extractMp3Encoding(new Uint8Array(buildMp3Frame()));
      assert.strictEqual(encoding?.container, 'MPEG');
      assert.strictEqual(encoding?.audioCodec, 'MP3 (MPEG Layer III)');
      assert.strictEqual(encoding?.sampleRateHz, 44100);
      assert.strictEqual(encoding?.bitrateBps, 128000);
      assert.strictEqual(encoding?.channels, 2);
      assert.strictEqual(encoding?.channelMode, 'joint-stereo');
      assert.false(
        encoding?.isVariableBitrate,
        'no Xing header means the encoder wrote a constant rate',
      );
    });

    test('a Xing header marks the bitrate as variable', function (assert) {
      assert.true(
        extractMp3Encoding(new Uint8Array(buildMp3Frame({ withXing: true })))
          ?.isVariableBitrate,
      );
    });

    test('never reports a bit depth, which MP3 has no concept of', function (assert) {
      assert.strictEqual(
        extractMp3Encoding(new Uint8Array(buildMp3Frame()))?.bitDepth,
        undefined,
      );
    });

    test('finds the frame past a leading ID3v2 tag', function (assert) {
      let tag = buildId3v2([['TIT2', latin1Frame('Something')]]);
      let bytes = new Uint8Array([...tag, ...buildMp3Frame()]);
      assert.strictEqual(extractMp3Encoding(bytes)?.sampleRateHz, 44100);
    });

    test('a buffer with no frame sync yields nothing rather than throwing', function (assert) {
      assert.strictEqual(
        extractMp3Encoding(new Uint8Array(128).fill(0x41)),
        undefined,
      );
    });
  });

  module('ID3v2', function () {
    test('reads the common v2.3 text frames', function (assert) {
      let tags = parseId3v2Tags(
        buildId3v2([
          ['TIT2', latin1Frame('Blue Monday')],
          ['TPE1', latin1Frame('A Band')],
          ['TALB', latin1Frame('Power')],
          ['TRCK', latin1Frame('4/12')],
          ['TYER', latin1Frame('1983')],
          ['TCON', latin1Frame('Synthpop')],
        ]),
      );
      assert.strictEqual(tags?.trackTitle, 'Blue Monday');
      assert.strictEqual(tags?.artist, 'A Band');
      assert.strictEqual(tags?.album, 'Power');
      assert.strictEqual(
        tags?.track,
        '4/12',
        'a track number keeps its total rather than being coerced to a number',
      );
      assert.strictEqual(tags?.year, 1983);
      assert.strictEqual(tags?.genre, 'Synthpop');
      assert.strictEqual(tags?.scheme, 'id3v2');
    });

    test('accepts the v2.4 recording-date frame', function (assert) {
      let tags = parseId3v2Tags(
        buildId3v2([['TDRC', latin1Frame('2008-05-13')]], 4),
      );
      assert.strictEqual(tags?.year, 2008);
    });

    test('decodes a UTF-16 frame with a byte-order mark', function (assert) {
      // Encoding byte 1, BOM, then UTF-16LE code units, NUL-pair terminated.
      let text = 'Ünicode';
      let payload = [0x01, 0xff, 0xfe];
      for (let index = 0; index < text.length; index++) {
        let code = text.charCodeAt(index);
        payload.push(code & 0xff, (code >>> 8) & 0xff);
      }
      payload.push(0, 0);
      let tags = parseId3v2Tags(buildId3v2([['TIT2', payload]]));
      assert.strictEqual(
        tags?.trackTitle,
        text,
        'a UTF-16 tag reads in full rather than stopping at its first NUL byte',
      );
    });

    test('a COMM frame skips its language code and description', function (assert) {
      let payload = [
        0, // Latin-1
        ...ascii('eng'),
        ...ascii('short'),
        0, // description terminator
        ...ascii('the actual comment'),
        0,
      ];
      assert.strictEqual(
        parseId3v2Tags(buildId3v2([['COMM', payload]]))?.comment,
        'the actual comment',
      );
    });

    test('a file with no ID3v2 tag yields nothing', function (assert) {
      assert.strictEqual(
        parseId3v2Tags(new Uint8Array(buildMp3Frame())),
        undefined,
      );
    });

    test('an empty tag produces no attribute despite being well-formed', function (assert) {
      assert.strictEqual(parseId3v2Tags(buildId3v2([])), undefined);
    });
  });

  module('Vorbis comments', function () {
    test('is case-insensitive about field names', function (assert) {
      let body = new Uint8Array(
        vorbisCommentBody([
          ['title', 'lowercase key'],
          ['Artist', 'Mixed Case Key'],
        ]),
      );
      let parsed = parseVorbisComments(body, 0);
      assert.strictEqual(parsed?.tags?.trackTitle, 'lowercase key');
      assert.strictEqual(parsed?.tags?.artist, 'Mixed Case Key');
    });

    test('keeps the first of a repeated key rather than joining them', function (assert) {
      let body = new Uint8Array(
        vorbisCommentBody([
          ['ARTIST', 'First Artist'],
          ['ARTIST', 'Second Artist'],
        ]),
      );
      assert.strictEqual(
        parseVorbisComments(body, 0)?.tags?.artist,
        'First Artist',
        'joining two ARTIST values would invent a credit the file never stated',
      );
    });

    test('reports the vendor string', function (assert) {
      let body = new Uint8Array(vorbisCommentBody([['TITLE', 'x']]));
      assert.strictEqual(parseVorbisComments(body, 0)?.vendor, 'test-vendor');
    });

    test('ignores keys it has no field for', function (assert) {
      let body = new Uint8Array(
        vorbisCommentBody([['REPLAYGAIN_TRACK_GAIN', '-6.5 dB']]),
      );
      assert.strictEqual(
        parseVorbisComments(body, 0)?.tags,
        undefined,
        'application-specific keys do not become fields nobody declared',
      );
    });

    test('a truncated block yields nothing rather than throwing', function (assert) {
      let body = new Uint8Array(vorbisCommentBody([['TITLE', 'Truncated']]));
      assert.strictEqual(
        parseVorbisComments(body.subarray(0, 6), 0),
        undefined,
      );
    });

    test('an implausible entry count is refused', function (assert) {
      let body = new Uint8Array(vorbisCommentBody([['TITLE', 'x']]));
      // Overwrite the entry count that follows the vendor string.
      let vendorLength = new DataView(body.buffer).getUint32(0, true);
      new DataView(body.buffer).setUint32(4 + vendorLength, 100000, true);
      assert.strictEqual(parseVorbisComments(body, 0), undefined);
    });
  });

  module('waveform reduction', function () {
    // A decoded buffer standing in for Web Audio's, so the reduction is testable
    // without a real decoder.
    function fakeAudio(
      channels: Float32Array[],
      sampleRate = 44100,
    ): AudioWaveformModule.DecodedAudioLike {
      let length = channels[0]?.length ?? 0;
      return {
        duration: length / sampleRate,
        sampleRate,
        numberOfChannels: channels.length,
        length,
        getChannelData: (index: number) =>
          channels[index] ?? new Float32Array(),
      };
    }

    test('resamples across the whole signal, not just its opening', function (assert) {
      // Silence for the first nine tenths, full amplitude for the last tenth.
      // An envelope built from the opening would be entirely flat.
      let samples = new Float32Array(1000);
      samples.fill(0, 0, 900);
      samples.fill(1, 900, 1000);
      let result = analyzeDecodedAudio(fakeAudio([samples]), 10);
      let bars = JSON.parse(result.barsJson!) as number[];

      assert.strictEqual(bars.length, 10);
      assert.strictEqual(bars[0], 0, 'the silent opening reads as silent');
      assert.strictEqual(
        bars[9],
        1,
        'the loud ending is represented, so the envelope is the shape of the whole track',
      );
    });

    test('every channel contributes, so panned content is not misread', function (assert) {
      // Left silent, right loud. Reading only channel 0 would report silence.
      let left = new Float32Array(100);
      let right = new Float32Array(100).fill(1);
      let result = analyzeDecodedAudio(fakeAudio([left, right]), 4);
      let bars = JSON.parse(result.barsJson!) as number[];
      assert.true(
        bars.every((bar) => bar > 0),
        'a hard-panned track is not reported as silent',
      );
    });

    test('reports RMS per bar rather than peak, so quiet stays quiet', function (assert) {
      let quiet = new Float32Array(100).fill(0.1);
      let result = analyzeDecodedAudio(fakeAudio([quiet]), 4);
      let bars = JSON.parse(result.barsJson!) as number[];
      assert.true(
        bars.every((bar) => Math.abs(bar - 0.1) < 0.001),
        'a bar tracks loudness rather than saturating to the peak',
      );
    });

    test('reports the overall peak separately from the envelope', function (assert) {
      let samples = new Float32Array(100).fill(0.2);
      samples[50] = -0.95;
      let result = analyzeDecodedAudio(fakeAudio([samples]), 4);
      assert.strictEqual(
        result.peakAmplitude,
        0.95,
        'peak is a magnitude, so a negative sample still counts',
      );
      assert.true(result.rmsAmplitude! < 0.4, 'RMS is not dragged to the peak');
    });

    test('the bar count is fixed regardless of duration', function (assert) {
      let short = analyzeDecodedAudio(
        fakeAudio([new Float32Array(200).fill(0.5)]),
        32,
      );
      let long = analyzeDecodedAudio(
        fakeAudio([new Float32Array(200_000).fill(0.5)]),
        32,
      );
      assert.strictEqual(short.barCount, 32);
      assert.strictEqual(
        long.barCount,
        32,
        'a long recording costs no more stored payload than a short one',
      );
    });

    test('a buffer with fewer samples than bars still produces a bar each', function (assert) {
      let result = analyzeDecodedAudio(
        fakeAudio([new Float32Array(3).fill(0.5)]),
        8,
      );
      let bars = JSON.parse(result.barsJson!) as number[];
      assert.strictEqual(bars.length, 8, 'no window is left empty');
    });

    test('an empty buffer is reported as an empty envelope, not a failure', function (assert) {
      let result = analyzeDecodedAudio(fakeAudio([new Float32Array(0)]), 8);
      assert.strictEqual(result.decodeStatus, 'ok');
      assert.strictEqual(result.barsJson, '[]');
      assert.strictEqual(result.barCount, 0);
    });
  });

  module('attribute assembly', function () {
    test('wraps rates as quantities and schemes as coded values', function (assert) {
      let attributes = audioAttributes(
        {
          container: 'FLAC',
          audioCodec: 'FLAC',
          sampleRateHz: 44100,
          bitrateBps: 900000,
          bitDepth: 16,
          channels: 2,
          channelMode: 'stereo',
          isVariableBitrate: true,
        },
        { scheme: 'vorbis-comment', trackTitle: 'Nocturne' },
      );
      assert.deepEqual(attributes.encoding?.sampleRate, {
        value: 44100,
        unit: 'Hz',
      });
      assert.deepEqual(attributes.encoding?.bitrate, {
        value: 900000,
        unit: 'bps',
      });
      assert.deepEqual(attributes.encoding?.channelMode, {
        code: 'stereo',
        scheme: 'channel-mode',
      });
      assert.deepEqual(attributes.tags?.scheme, {
        code: 'vorbis-comment',
        scheme: 'tag-scheme',
      });
      assert.strictEqual(attributes.tags?.trackTitle, 'Nocturne');
    });

    test('a file that revealed nothing adds no attributes at all', function (assert) {
      assert.deepEqual(audioAttributes(undefined, undefined), {});
    });

    test('a skipped decode is still persisted, because it is not the same as absent', function (assert) {
      let attributes = audioAttributes(undefined, undefined, {
        decodeStatus: 'skipped',
        decodeError: 'too big',
      });
      assert.strictEqual(attributes.waveform?.decodeStatus, 'skipped');
    });

    test('a false variable-bitrate flag survives assembly', function (assert) {
      let attributes = audioAttributes({ isVariableBitrate: false }, undefined);
      assert.false(
        attributes.encoding?.isVariableBitrate,
        'knowing a stream is constant-rate is a fact worth persisting',
      );
    });
  });

  module('MIDI', function () {
    // ---- SMF fixtures ----

    // MIDI's variable-length quantity: seven bits per byte, high bit set on all
    // but the last.
    function vlq(value: number): number[] {
      let out = [value & 0x7f];
      let rest = value >>> 7;
      while (rest > 0) {
        out.unshift((rest & 0x7f) | 0x80);
        rest >>>= 7;
      }
      return out;
    }

    function trackChunk(events: number[]): number[] {
      // Every track must end with an end-of-track meta event.
      let body = [...events, 0x00, 0xff, 0x2f, 0x00];
      return [...ascii('MTrk'), ...uint32be(body.length), ...body];
    }

    function buildMidi(
      tracks: number[][],
      options: { format?: number; division?: number } = {},
    ): Uint8Array {
      let chunks = tracks.flatMap((events) => trackChunk(events));
      return new Uint8Array([
        ...ascii('MThd'),
        ...uint32be(6),
        ...uint16le(0).reverse(), // placeholder, overwritten below
        ...uint16le(0).reverse(),
        ...uint16le(0).reverse(),
        ...chunks,
      ]).map((byte, index) => {
        // Rewrite the three header fields big-endian.
        let format = options.format ?? 1;
        let division = options.division ?? 480;
        if (index === 8) return (format >>> 8) & 0xff;
        if (index === 9) return format & 0xff;
        if (index === 10) return (tracks.length >>> 8) & 0xff;
        if (index === 11) return tracks.length & 0xff;
        if (index === 12) return (division >>> 8) & 0xff;
        if (index === 13) return division & 0xff;
        return byte;
      });
    }

    // A note-on/note-off pair at the given tick offsets.
    function note(
      channel: number,
      pitch: number,
      velocity = 64,
      deltaOn = 0,
      deltaOff = 480,
    ): number[] {
      return [
        ...vlq(deltaOn),
        0x90 | channel,
        pitch,
        velocity,
        ...vlq(deltaOff),
        0x80 | channel,
        pitch,
        0,
      ];
    }

    function tempoEvent(bpm: number, delta = 0): number[] {
      let microseconds = Math.round(60_000_000 / bpm);
      return [
        ...vlq(delta),
        0xff,
        0x51,
        0x03,
        (microseconds >>> 16) & 0xff,
        (microseconds >>> 8) & 0xff,
        microseconds & 0xff,
      ];
    }

    test('reads the header and counts the notes that actually sound', function (assert) {
      let midi = extractMidiMetadata(
        buildMidi([[...note(0, 60), ...note(0, 64), ...note(0, 67)]], {
          format: 0,
          division: 480,
        }),
      );
      assert.strictEqual(midi.format, 0);
      assert.strictEqual(midi.ppq, 480);
      assert.strictEqual(midi.noteCount, 3);
      assert.strictEqual(midi.fileTrackCount, 1);
      assert.strictEqual(midi.trackCount, 1);
    });

    test('a note-on with zero velocity is a note-off, not a second note', function (assert) {
      // The conventional note-off encoding. Counting it would double every note.
      let events = [...vlq(0), 0x90, 60, 64, ...vlq(480), 0x90, 60, 0];
      assert.strictEqual(extractMidiMetadata(buildMidi([events])).noteCount, 1);
    });

    test('distinguishes tracks that sound from tracks the header declares', function (assert) {
      // A format 1 file conventionally opens with a conductor track carrying only
      // tempo and meter, which should not be counted as sounding.
      let midi = extractMidiMetadata(
        buildMidi([tempoEvent(120), [...note(0, 60)]]),
      );
      assert.strictEqual(midi.fileTrackCount, 2);
      assert.strictEqual(
        midi.trackCount,
        1,
        'the conductor track declares no notes so it does not count as sounding',
      );
    });

    test('derives duration by walking the tempo map, not by averaging', function (assert) {
      // One quarter note at 480 ppq and 120 BPM is exactly half a second.
      let midi = extractMidiMetadata(
        buildMidi([[...tempoEvent(120), ...note(0, 60, 64, 0, 480)]], {
          division: 480,
        }),
      );
      assert.strictEqual(midi.durationSeconds, 0.5);
    });

    test('a tempo change partway through changes the derived duration', function (assert) {
      // Half a second at 120 BPM, then a quarter note at 240 BPM (0.25 s).
      let events = [
        ...tempoEvent(120),
        ...note(0, 60, 64, 0, 480),
        ...tempoEvent(240),
        ...note(0, 62, 64, 0, 480),
      ];
      let midi = extractMidiMetadata(buildMidi([events], { division: 480 }));
      assert.strictEqual(
        midi.durationSeconds,
        0.75,
        'a piece that speeds up is not reported at its opening tempo',
      );
      assert.strictEqual(midi.tempoMap?.length, 2);
      assert.true(midi.tempoMap?.[0]?.startsWith('120 BPM'));
      assert.true(midi.tempoMap?.[1]?.startsWith('240 BPM'));
    });

    test('reads time and key signatures', function (assert) {
      let events = [
        ...vlq(0),
        0xff,
        0x58,
        0x04,
        6,
        3,
        24,
        8, // 6/8
        ...vlq(0),
        0xff,
        0x59,
        0x02,
        0xfd,
        1, // three flats, minor → C minor
        ...note(0, 60),
      ];
      let midi = extractMidiMetadata(buildMidi([events]));
      assert.deepEqual(midi.timeSignatures, ['6/8']);
      assert.deepEqual(
        midi.keySignatures,
        ['C minor'],
        'a signed accidental count and a minor flag name the key',
      );
    });

    test('reports the pitch range in note names', function (assert) {
      let midi = extractMidiMetadata(
        buildMidi([[...note(0, 60), ...note(0, 72)]]),
      );
      assert.strictEqual(
        midi.pitchRange,
        'C4–C5',
        'MIDI note 60 is middle C, conventionally written C4',
      );
    });

    test('percussion is flagged and kept out of the pitch range', function (assert) {
      // Channel 10 (index 9) is percussion, where a note number names a drum
      // rather than a pitch — folding it into the range would be meaningless.
      let midi = extractMidiMetadata(
        buildMidi([[...note(0, 60), ...note(9, 35), ...note(9, 81)]]),
      );
      assert.true(midi.hasPercussion);
      assert.strictEqual(midi.pitchRange, 'C4–C4');
    });

    test('collects program changes excluding the percussion channel', function (assert) {
      let events = [
        ...vlq(0),
        0xc0,
        40, // channel 1, violin
        ...vlq(0),
        0xc9,
        16, // channel 10, a drum kit rather than an instrument
        ...note(0, 60),
      ];
      let midi = extractMidiMetadata(buildMidi([events]));
      assert.deepEqual(midi.programs, [40]);
    });

    test('reports channels as the numbers a musician uses, counting from one', function (assert) {
      let midi = extractMidiMetadata(
        buildMidi([[...note(0, 60), ...note(3, 64)]]),
      );
      assert.deepEqual(midi.channels, [1, 4]);
    });

    test('follows running status, which real files rely on', function (assert) {
      // Three notes sharing one status byte — the compression every sequencer
      // emits. Mishandling it would lose all but the first.
      let events = [
        ...vlq(0),
        0x90,
        60,
        64, // explicit status
        ...vlq(10),
        62,
        64, // running status
        ...vlq(10),
        64,
        64, // running status
      ];
      assert.strictEqual(extractMidiMetadata(buildMidi([events])).noteCount, 3);
    });

    test('skips a SysEx event without desynchronizing the walk', function (assert) {
      let events = [
        ...vlq(0),
        0xf0,
        0x04,
        0x7e,
        0x7f,
        0x09,
        0x01, // a GM reset
        ...note(0, 60),
      ];
      assert.strictEqual(extractMidiMetadata(buildMidi([events])).noteCount, 1);
    });

    test('a SMPTE-timed file reads its notes but declares no ppq', function (assert) {
      // A negative division is timecode, where ticks do not convert to musical
      // time — so reporting a ppq would be meaningless.
      let midi = extractMidiMetadata(
        buildMidi([[...note(0, 60)]], { division: 0xe728 }),
      );
      assert.strictEqual(midi.ppq, undefined);
      assert.strictEqual(midi.durationSeconds, undefined);
      assert.strictEqual(midi.noteCount, 1);
    });

    test('a non-MIDI file is reported as a content mismatch', function (assert) {
      assert.throws(
        () => extractMidiMetadata(new Uint8Array(64).fill(0x41)),
        /MThd/,
        'the extractor falls back to the base FileDef rather than inventing metadata',
      );
    });

    test('a truncated track yields the events it did read', function (assert) {
      let full = buildMidi([[...note(0, 60), ...note(0, 64)]]);
      let truncated = full.subarray(0, full.length - 6);
      let midi = extractMidiMetadata(truncated);
      assert.true(
        midi.noteCount! >= 1,
        'a partial track still reports what was readable rather than throwing',
      );
    });
  });

  module('streaming envelope', function () {
    test('holds its bar count however many units arrive', function (assert) {
      // The point of the doubling accumulator: memory and output stay fixed even
      // though the total is unknown while pushing.
      for (let units of [4, 100, 10_000]) {
        let envelope = new StreamingEnvelope(16);
        for (let index = 0; index < units; index++) {
          envelope.push(0.25, 1);
        }
        assert.strictEqual(
          envelope.bars().length,
          16,
          `${units} units still reduce to 16 bars`,
        );
      }
    });

    test('places signal by position, not by arrival order', function (assert) {
      // Silence for the first three quarters, then full amplitude. A producer
      // that mis-tracked position would smear this across every bar.
      let envelope = new StreamingEnvelope(8);
      for (let index = 0; index < 3000; index++) {
        envelope.push(0, 1);
      }
      for (let index = 0; index < 1000; index++) {
        envelope.push(1, 1);
      }
      let bars = envelope.bars();
      assert.strictEqual(bars[0], 0, 'the silent opening reads as silent');
      assert.strictEqual(
        bars[7],
        1,
        'the loud ending reaches the final bar rather than being folded away',
      );
    });

    test('survives many folds without losing the shape', function (assert) {
      // Far more units than the fine-bucket capacity, forcing repeated folds.
      let envelope = new StreamingEnvelope(4);
      let total = 100_000;
      for (let index = 0; index < total; index++) {
        envelope.push(index < total / 2 ? 0 : 1, 1);
      }
      let bars = envelope.bars();
      assert.strictEqual(bars[0], 0);
      assert.strictEqual(bars[1], 0);
      assert.strictEqual(
        bars[3],
        1,
        'the second half is still loud after folding',
      );
    });

    test('reports the peak it was told about', function (assert) {
      let envelope = new StreamingEnvelope(4);
      envelope.push(0.01, 1, 0.1);
      envelope.push(0.81, 1, 0.9);
      envelope.push(0.04, 1, 0.2);
      assert.strictEqual(envelope.peak, 0.9);
    });

    test('an accumulator nothing was pushed to is empty, not zero-filled', function (assert) {
      let envelope = new StreamingEnvelope(8);
      assert.true(envelope.isEmpty);
      assert.deepEqual(envelope.bars(), []);
    });
  });

  module('MP3 envelope from side info', function () {
    // Build a frame whose side info carries a chosen global_gain in every
    // granule, so the envelope has a known shape without any real audio.
    function frameWithGain(gain: number): number[] {
      // MPEG-1 Layer III, 128 kbps, 44.1 kHz, joint stereo, no CRC.
      let header = [0xff, 0xfb, 0x90, 0x40];
      // 144 * 128000 / 44100 = 417 bytes, no padding.
      let length = 417;
      let body = new Array(length - 4).fill(0);
      // Stereo MPEG-1 side info: main_data_begin(9) + private(3) + scfsi(8) = 20
      // bits, then four 59-bit granule/channel blocks with global_gain 21 bits in.
      let base = 20;
      for (let block = 0; block < 4; block++) {
        let bitOffset = base + block * 59 + 21;
        for (let bit = 0; bit < 8; bit++) {
          let value = (gain >> (7 - bit)) & 1;
          let absolute = bitOffset + bit;
          let byteIndex = absolute >> 3;
          if (value) {
            body[byteIndex] |= 1 << (7 - (absolute & 7));
          }
        }
      }
      return [...header, ...body];
    }

    test('reads a gain out of every granule of every frame', function (assert) {
      // Four frames, two granules x two channels each.
      let bytes = new Uint8Array([
        ...frameWithGain(200),
        ...frameWithGain(200),
        ...frameWithGain(200),
        ...frameWithGain(200),
      ]);
      let envelope = extractMp3Envelope(bytes, 8);
      assert.strictEqual(
        envelope?.granuleCount,
        16,
        'four frames yield sixteen granule gains',
      );
      assert.strictEqual(envelope?.frameCount, 4);
      assert.strictEqual(envelope?.sampleRateHz, 44100);
    });

    test('a louder passage produces taller bars than a quieter one', function (assert) {
      // global_gain is logarithmic, so a higher value is a larger amplitude.
      let quiet = Array.from({ length: 8 }, () => frameWithGain(150)).flat();
      let loud = Array.from({ length: 8 }, () => frameWithGain(210)).flat();
      let envelope = extractMp3Envelope(new Uint8Array([...quiet, ...loud]), 4);
      let bars = envelope!.bars;
      assert.true(
        bars[0]! < bars[3]!,
        'the quiet opening reads lower than the loud ending',
      );
      assert.strictEqual(
        bars[3],
        1,
        'bars are normalized to the track peak, so the loudest reaches 1',
      );
    });

    test('derives a duration from granule count without needing a Xing header', function (assert) {
      // Each granule is 576 samples; 16 granules at 44.1 kHz is ~0.209 s.
      let bytes = new Uint8Array(
        Array.from({ length: 4 }, () => frameWithGain(180)).flat(),
      );
      let envelope = extractMp3Envelope(bytes, 8);
      assert.strictEqual(
        envelope?.durationSeconds,
        Math.round((16 * 576 * 1000) / 44100) / 1000,
      );
    });

    test('skips a leading ID3v2 tag', function (assert) {
      let tag = buildId3v2([['TIT2', latin1Frame('Tagged')]]);
      let bytes = new Uint8Array([
        ...tag,
        ...frameWithGain(190),
        ...frameWithGain(190),
      ]);
      assert.strictEqual(extractMp3Envelope(bytes, 4)?.granuleCount, 8);
    });

    test('resynchronizes past a corrupt frame rather than stopping', function (assert) {
      let bytes = new Uint8Array([
        ...frameWithGain(190),
        ...new Array(64).fill(0x41), // garbage between frames
        ...frameWithGain(190),
      ]);
      let envelope = extractMp3Envelope(bytes, 4);
      assert.strictEqual(
        envelope?.frameCount,
        2,
        'a single corrupt run does not cost the rest of the file',
      );
    });

    test('a file with no frames yields nothing rather than throwing', function (assert) {
      assert.strictEqual(
        extractMp3Envelope(new Uint8Array(256).fill(0x41), 8),
        undefined,
      );
    });

    test('the streaming scan agrees with the buffered one', async function (assert) {
      // The streaming walk keeps only a rolling few frames, so neither the
      // decoded audio nor the encoded file is ever fully resident. It has to
      // reach the same answer regardless of how the bytes are chunked, including
      // when a frame straddles a boundary.
      let bytes = new Uint8Array([
        ...Array.from({ length: 6 }, () => frameWithGain(150)).flat(),
        ...Array.from({ length: 6 }, () => frameWithGain(205)).flat(),
      ]);
      let buffered = extractMp3Envelope(bytes, 8);

      for (let chunkSize of [13, 417, 1000]) {
        let streamed = await extractMp3EnvelopeFromStream(
          chunkedStream(bytes, chunkSize),
          8,
        );
        assert.deepEqual(
          streamed?.bars,
          buffered?.bars,
          `chunks of ${chunkSize} bytes produce the same envelope`,
        );
        assert.strictEqual(streamed?.granuleCount, buffered?.granuleCount);
        assert.strictEqual(streamed?.frameCount, buffered?.frameCount);
      }
    });

    test('the streaming scan skips a large ID3v2 tag without buffering it', async function (assert) {
      // Artwork can make the tag megabytes; it is skipped by count rather than
      // accumulated.
      let artwork = new Array(200_000).fill(0x00);
      let tag = buildId3v2([['APIC', artwork]]);
      let bytes = new Uint8Array([
        ...tag,
        ...frameWithGain(190),
        ...frameWithGain(190),
      ]);
      let streamed = await extractMp3EnvelopeFromStream(
        chunkedStream(bytes, 4096),
        4,
      );
      assert.strictEqual(streamed?.granuleCount, 8);
    });
  });

  module('WAV single-pass streaming', function () {
    // A WAVE file with real 16-bit PCM, so the envelope is computed from actual
    // samples rather than a stand-in.
    function buildWavWithPcm(
      frames: number[][],
      options: {
        sampleRate?: number;
        channels?: number;
        infoEntries?: [string, string][];
        trailingInfo?: boolean;
      } = {},
    ): Uint8Array {
      let sampleRate = options.sampleRate ?? 8000;
      let channels = options.channels ?? 1;
      let bitsPerSample = 16;
      let byteRate = (sampleRate * channels * bitsPerSample) / 8;
      let fmtBody = [
        ...uint16le(1),
        ...uint16le(channels),
        ...uint32le(sampleRate),
        ...uint32le(byteRate),
        ...uint16le((channels * bitsPerSample) / 8),
        ...uint16le(bitsPerSample),
      ];
      let pcm: number[] = [];
      for (let frame of frames) {
        for (let sample of frame) {
          let clamped = Math.max(-1, Math.min(1, sample));
          let value = Math.round(clamped * 32767);
          pcm.push(...uint16le(value < 0 ? value + 65536 : value));
        }
      }
      let infoChunk: number[] = [];
      if (options.infoEntries?.length) {
        let infoBody = [...ascii('INFO')];
        for (let [id, value] of options.infoEntries) {
          infoBody.push(...riffChunk(id, [...ascii(value), 0]));
        }
        infoChunk = riffChunk('LIST', infoBody);
      }
      let chunks = [
        ...riffChunk('fmt ', fmtBody),
        ...(options.trailingInfo ? [] : infoChunk),
        ...riffChunk('data', pcm),
        ...(options.trailingInfo ? infoChunk : []),
      ];
      let payload = [...ascii('WAVE'), ...chunks];
      return new Uint8Array([
        ...ascii('RIFF'),
        ...uint32le(payload.length),
        ...payload,
      ]);
    }

    function silentThenLoud(total: number): number[][] {
      return Array.from({ length: total }, (_, index) => [
        index < total / 2 ? 0 : 1,
      ]);
    }

    test('derives duration, encoding, and envelope from one pass', async function (assert) {
      let bytes = buildWavWithPcm(silentThenLoud(8000), { sampleRate: 8000 });
      let result = await extractWavFromStream(bytes, 8);

      assert.strictEqual(
        result.duration,
        1,
        '8000 mono frames at 8 kHz is 1 s',
      );
      assert.strictEqual(result.encoding?.sampleRateHz, 8000);
      assert.strictEqual(result.encoding?.bitDepth, 16);
      assert.strictEqual(result.envelope?.bars.length, 8);
    });

    test('the envelope tracks the real signal', async function (assert) {
      let result = await extractWavFromStream(
        buildWavWithPcm(silentThenLoud(8000)),
        8,
      );
      let bars = result.envelope!.bars;
      assert.strictEqual(bars[0], 0, 'the silent half reads as silent');
      assert.true(bars[7]! > 0.99, 'the loud half reaches full scale');
    });

    test('peak and RMS are real amplitudes, needing no normalization', async function (assert) {
      // A constant half-scale signal: RMS and peak should both be ~0.5, unlike
      // MP3's side-info proxy where only relative height is meaningful.
      let frames = Array.from({ length: 4000 }, () => [0.5]);
      let result = await extractWavFromStream(buildWavWithPcm(frames), 8);
      assert.true(Math.abs(result.envelope!.peak - 0.5) < 0.001);
      assert.true(Math.abs(result.envelope!.rms - 0.5) < 0.001);
    });

    test('a frame split across stream chunks is not dropped or misread', async function (assert) {
      let bytes = buildWavWithPcm(silentThenLoud(4000), { channels: 2 });
      let whole = await extractWavFromStream(bytes, 8);
      // 7 is deliberately coprime with the 4-byte stereo frame, so almost every
      // chunk boundary falls inside a frame.
      let chunked = await extractWavFromStream(chunkedStream(bytes, 7), 8);

      assert.deepEqual(
        chunked.envelope?.bars,
        whole.envelope?.bars,
        'chunking the stream does not change the envelope',
      );
      assert.strictEqual(chunked.duration, whole.duration);
    });

    test('reads LIST-INFO written before the payload', async function (assert) {
      let result = await extractWavFromStream(
        buildWavWithPcm(silentThenLoud(800), {
          infoEntries: [['INAM', 'Leading Tag']],
        }),
        8,
      );
      assert.strictEqual(result.tags?.trackTitle, 'Leading Tag');
    });

    test('reads LIST-INFO written after the payload', async function (assert) {
      // Some encoders put the tag block at the end, past the audio.
      let result = await extractWavFromStream(
        buildWavWithPcm(silentThenLoud(800), {
          infoEntries: [['INAM', 'Trailing Tag']],
          trailingInfo: true,
        }),
        8,
      );
      assert.strictEqual(result.tags?.trackTitle, 'Trailing Tag');
    });

    test('stops folding PCM at the declared data size', async function (assert) {
      // Trailing bytes past `data` must not be read as samples, or a tag block
      // at the end would show up as a burst of noise in the envelope.
      let result = await extractWavFromStream(
        buildWavWithPcm(
          Array.from({ length: 800 }, () => [0]),
          { infoEntries: [['INAM', 'x']], trailingInfo: true },
        ),
        4,
      );
      assert.deepEqual(
        result.envelope?.bars,
        [0, 0, 0, 0],
        'a silent file stays silent despite trailing chunk bytes',
      );
    });

    test('a non-WAVE buffer yields no duration rather than throwing', async function (assert) {
      let result = await extractWavFromStream(
        new Uint8Array(256).fill(0x41),
        8,
      );
      assert.strictEqual(result.duration, undefined);
      assert.strictEqual(result.envelope, undefined);
    });
  });
});
