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
import type * as Mp3Module from '@cardstack/base/mp3-meta-extractor';
import type * as OggModule from '@cardstack/base/ogg-meta-extractor';
import type * as VorbisModule from '@cardstack/base/vorbis-comment-parser';
import type * as WavModule from '@cardstack/base/wav-meta-extractor';

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
    // STREAMINFO header: type 0, not last when a comment block follows.
    hasComments ? 0x00 : 0x80,
    0x00,
    0x00,
    0x22,
    ...block,
  ];
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
  for (let [id, payload] of frames) {
    body.push(
      ...ascii(id),
      ...(majorVersion >= 4
        ? syncsafe(payload.length)
        : uint32be(payload.length)),
      0,
      0, // frame flags
      ...payload,
    );
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
  let extractFlacEncoding: typeof FlacModule.extractFlacEncoding;
  let extractFlacTags: typeof FlacModule.extractFlacTags;
  let extractOggEncoding: typeof OggModule.extractOggEncoding;
  let extractOggTags: typeof OggModule.extractOggTags;
  let extractMp3Encoding: typeof Mp3Module.extractMp3Encoding;
  let parseId3v2Tags: typeof Id3Module.parseId3v2Tags;
  let parseVorbisComments: typeof VorbisModule.parseVorbisComments;
  let analyzeDecodedAudio: typeof AudioWaveformModule.analyzeDecodedAudio;
  let audioAttributes: typeof AudioFileDefModule.audioAttributes;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractWavEncoding, extractWavTags } = await loader.import<
      typeof WavModule
    >('@cardstack/base/wav-meta-extractor'));
    ({ extractFlacEncoding, extractFlacTags } = await loader.import<
      typeof FlacModule
    >('@cardstack/base/flac-meta-extractor'));
    ({ extractOggEncoding, extractOggTags } = await loader.import<
      typeof OggModule
    >('@cardstack/base/ogg-meta-extractor'));
    ({ extractMp3Encoding } = await loader.import<typeof Mp3Module>(
      '@cardstack/base/mp3-meta-extractor',
    ));
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
});
