// Byte-level tests for the image metadata readers. These parsers run inside the
// index pass against whatever bytes a realm happens to hold, so the contract
// they have to keep is as much about malformed input as about well-formed input:
// a truncated or hostile file must degrade to "no metadata" rather than throw
// out of the extract, and an absent optional structure must not be invented.
//
// Fixtures are assembled here rather than committed as binaries so each test
// names the exact bytes it depends on.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as AvifModule from '@cardstack/base/avif-meta-extractor';
import type * as ExifModule from '@cardstack/base/exif-meta-extractor';
import type * as GifModule from '@cardstack/base/gif-meta-extractor';
import type * as ImageFileDefModule from '@cardstack/base/image-file-def';
import type * as JpgModule from '@cardstack/base/jpg-meta-extractor';
import type * as PngModule from '@cardstack/base/png-meta-extractor';
import type * as WebpModule from '@cardstack/base/webp-meta-extractor';

// TIFF field type codes, as the EXIF fixtures below declare them.
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

interface EntrySpec {
  tag: number;
  type: number;
  // A string for ASCII fields; for RATIONAL, a flat numerator/denominator run.
  values: number[] | string;
}

interface ExifFixture {
  littleEndian?: boolean;
  ifd0?: EntrySpec[];
  exif?: EntrySpec[];
  gps?: EntrySpec[];
}

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;

function payloadFor(
  spec: EntrySpec,
  littleEndian: boolean,
): { bytes: Uint8Array; count: number } {
  if (typeof spec.values === 'string') {
    // EXIF ASCII fields are NUL-terminated, and the terminator counts.
    let text = spec.values;
    let bytes = new Uint8Array(text.length + 1);
    for (let index = 0; index < text.length; index++) {
      bytes[index] = text.charCodeAt(index) & 0xff;
    }
    return { bytes, count: bytes.length };
  }
  let values = spec.values;
  if (spec.type === SHORT) {
    let bytes = new Uint8Array(values.length * 2);
    let view = new DataView(bytes.buffer);
    values.forEach((value, index) =>
      view.setUint16(index * 2, value, littleEndian),
    );
    return { bytes, count: values.length };
  }
  if (spec.type === LONG) {
    let bytes = new Uint8Array(values.length * 4);
    let view = new DataView(bytes.buffer);
    values.forEach((value, index) =>
      view.setUint32(index * 4, value, littleEndian),
    );
    return { bytes, count: values.length };
  }
  if (spec.type === RATIONAL) {
    let bytes = new Uint8Array(values.length * 4);
    let view = new DataView(bytes.buffer);
    values.forEach((value, index) =>
      view.setUint32(index * 4, value, littleEndian),
    );
    // A rational is a numerator/denominator pair, so the count is half the
    // number of 32-bit words written.
    return { bytes, count: values.length / 2 };
  }
  throw new Error(`unsupported fixture field type ${spec.type}`);
}

// Build a TIFF/EXIF block: header, IFD0, the optional Exif and GPS sub-IFDs,
// then a heap holding every payload too large to sit inline in its entry.
function buildTiffBlock(fixture: ExifFixture): Uint8Array {
  let littleEndian = fixture.littleEndian ?? true;
  let ifd0 = [...(fixture.ifd0 ?? [])];
  let hasExif = (fixture.exif?.length ?? 0) > 0;
  let hasGps = (fixture.gps?.length ?? 0) > 0;

  let directorySize = (count: number) => 2 + count * 12 + 4;
  let ifd0Count = ifd0.length + (hasExif ? 1 : 0) + (hasGps ? 1 : 0);
  let ifd0Offset = 8;
  let exifOffset = ifd0Offset + directorySize(ifd0Count);
  let gpsOffset =
    exifOffset + (hasExif ? directorySize(fixture.exif!.length) : 0);
  let heapOffset =
    gpsOffset + (hasGps ? directorySize(fixture.gps!.length) : 0);

  // The pointer tags are ordinary IFD0 entries; adding them here is what makes
  // `ifd0Count` above correct.
  if (hasExif) {
    ifd0.push({ tag: TAG_EXIF_IFD_POINTER, type: LONG, values: [exifOffset] });
  }
  if (hasGps) {
    ifd0.push({ tag: TAG_GPS_IFD_POINTER, type: LONG, values: [gpsOffset] });
  }

  let heap: number[] = [];
  let writeDirectory = (target: number[], entries: EntrySpec[]) => {
    let bytes = new Uint8Array(directorySize(entries.length));
    let view = new DataView(bytes.buffer);
    view.setUint16(0, entries.length, littleEndian);
    entries.forEach((spec, index) => {
      let { bytes: payload, count } = payloadFor(spec, littleEndian);
      let entryStart = 2 + index * 12;
      view.setUint16(entryStart, spec.tag, littleEndian);
      view.setUint16(entryStart + 2, spec.type, littleEndian);
      view.setUint32(entryStart + 4, count, littleEndian);
      if (payload.length <= 4) {
        // Small payloads live in the entry's own value field.
        bytes.set(payload, entryStart + 8);
      } else {
        view.setUint32(entryStart + 8, heapOffset + heap.length, littleEndian);
        heap.push(...payload);
      }
    });
    // Terminating next-directory pointer of 0.
    view.setUint32(2 + entries.length * 12, 0, littleEndian);
    target.push(...bytes);
  };

  // Written in the same order the offsets above assume, so each out-of-line
  // payload lands where its entry says it does.
  let directories: number[] = [];
  writeDirectory(directories, ifd0);
  if (hasExif) {
    writeDirectory(directories, fixture.exif!);
  }
  if (hasGps) {
    writeDirectory(directories, fixture.gps!);
  }

  let header = new Uint8Array(8);
  let headerView = new DataView(header.buffer);
  headerView.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
  headerView.setUint16(2, 0x002a, littleEndian);
  headerView.setUint32(4, ifd0Offset, littleEndian);

  return new Uint8Array([...header, ...directories, ...heap]);
}

// A JPEG carrying the given APP1 segments and one SOF0 frame header, so the
// dimension reader and the EXIF reader both have something to find.
function buildJpeg(
  app1Segments: { identifier: string; body: Uint8Array }[],
  frame: { precision?: number; components?: number } = {},
): Uint8Array {
  let out: number[] = [0xff, 0xd8];
  for (let segment of app1Segments) {
    let identifier = [...segment.identifier].map((c) => c.charCodeAt(0));
    let length = 2 + identifier.length + segment.body.length;
    out.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff);
    out.push(...identifier, ...segment.body);
  }
  let components = frame.components ?? 3;
  // SOF0 payload: precision, height, width, component count, then three bytes
  // of sampling/quantization spec per component.
  let sofLength = 8 + components * 3;
  out.push(0xff, 0xc0, (sofLength >> 8) & 0xff, sofLength & 0xff);
  out.push(frame.precision ?? 8);
  out.push(0x00, 0x40); // height 64
  out.push(0x00, 0x20); // width 32
  out.push(components);
  for (let index = 0; index < components; index++) {
    out.push(index + 1, 0x11, 0x00);
  }
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

function jpegWithExif(fixture: ExifFixture): Uint8Array {
  return buildJpeg([
    { identifier: 'Exif\u0000\u0000', body: buildTiffBlock(fixture) },
  ]);
}

// PNG signature plus an IHDR chunk with the given encoding bytes. Only the
// bytes the color reader looks at need to be right.
function buildPng(bitDepth: number, colorType: number): Uint8Array {
  let out = [137, 80, 78, 71, 13, 10, 26, 10];
  out.push(0x00, 0x00, 0x00, 0x0d); // IHDR length
  out.push(0x49, 0x48, 0x44, 0x52); // "IHDR"
  out.push(0x00, 0x00, 0x00, 0x08); // width 8
  out.push(0x00, 0x00, 0x00, 0x08); // height 8
  out.push(bitDepth, colorType, 0, 0, 0);
  out.push(0x00, 0x00, 0x00, 0x00); // CRC placeholder
  return new Uint8Array(out);
}

function buildGif(
  hasGlobalColorTable: boolean,
  colorTableSizeExponent: number,
): Uint8Array {
  let out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
  out.push(0x08, 0x00, 0x08, 0x00); // 8 × 8
  out.push(
    (hasGlobalColorTable ? 0x80 : 0x00) | (colorTableSizeExponent & 0x07),
  );
  out.push(0x00, 0x00); // background color index, pixel aspect ratio
  return new Uint8Array(out);
}

// A RIFF/WEBP container whose first chunk is the given flavor. `payload` is
// written at offset 20, where every flavor keeps the bits the reader wants.
function buildWebp(fourCC: string, payload: number[]): Uint8Array {
  let out = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
  out.push(0x00, 0x00, 0x00, 0x00); // file size (unread)
  out.push(0x57, 0x45, 0x42, 0x50); // "WEBP"
  out.push(...[...fourCC].map((c) => c.charCodeAt(0)));
  out.push(0x00, 0x00, 0x00, 0x00); // chunk size (unread)
  out.push(...payload);
  while (out.length < 30) {
    out.push(0x00);
  }
  return new Uint8Array(out);
}

function box(type: string, body: number[]): number[] {
  let size = 8 + body.length;
  return [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...body,
  ];
}

// An AVIF box tree carrying the three item properties the color reader reads.
function buildAvif(properties: {
  pixi?: number[];
  colr?: number[];
  auxC?: string;
}): Uint8Array {
  let ftyp = box('ftyp', [
    ...[...'avif'].map((c) => c.charCodeAt(0)),
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  let ispe = box('ispe', [
    0,
    0,
    0,
    0, // version + flags
    0,
    0,
    0,
    32, // width
    0,
    0,
    0,
    32, // height
  ]);
  let ipcoBody = [...ispe];
  if (properties.pixi) {
    ipcoBody.push(
      ...box('pixi', [0, 0, 0, 0, properties.pixi.length, ...properties.pixi]),
    );
  }
  if (properties.colr) {
    ipcoBody.push(...box('colr', properties.colr));
  }
  if (properties.auxC) {
    ipcoBody.push(
      ...box('auxC', [
        0,
        0,
        0,
        0,
        ...[...properties.auxC].map((c) => c.charCodeAt(0)),
        0,
      ]),
    );
  }
  let ipco = box('ipco', ipcoBody);
  let iprp = box('iprp', ipco);
  // meta is a full box: its 4 bytes of version/flags precede its children.
  let meta = box('meta', [0, 0, 0, 0, ...iprp]);
  return new Uint8Array([...ftyp, ...meta]);
}

module('Unit | image metadata extractors', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractExifFromJpeg: typeof ExifModule.extractExifFromJpeg;
  let parseExifTiffBlock: typeof ExifModule.parseExifTiffBlock;
  let extractPngColorProfile: typeof PngModule.extractPngColorProfile;
  let extractJpgColorProfile: typeof JpgModule.extractJpgColorProfile;
  let extractGifColorProfile: typeof GifModule.extractGifColorProfile;
  let extractWebpColorProfile: typeof WebpModule.extractWebpColorProfile;
  let extractAvifColorProfile: typeof AvifModule.extractAvifColorProfile;
  let rasterImageAttributes: typeof ImageFileDefModule.rasterImageAttributes;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractExifFromJpeg, parseExifTiffBlock } = await loader.import<
      typeof ExifModule
    >('@cardstack/base/exif-meta-extractor'));
    ({ extractPngColorProfile } = await loader.import<typeof PngModule>(
      '@cardstack/base/png-meta-extractor',
    ));
    ({ extractJpgColorProfile } = await loader.import<typeof JpgModule>(
      '@cardstack/base/jpg-meta-extractor',
    ));
    ({ extractGifColorProfile } = await loader.import<typeof GifModule>(
      '@cardstack/base/gif-meta-extractor',
    ));
    ({ extractWebpColorProfile } = await loader.import<typeof WebpModule>(
      '@cardstack/base/webp-meta-extractor',
    ));
    ({ extractAvifColorProfile } = await loader.import<typeof AvifModule>(
      '@cardstack/base/avif-meta-extractor',
    ));
    ({ rasterImageAttributes } = await loader.import<typeof ImageFileDefModule>(
      '@cardstack/base/image-file-def',
    ));
  });

  module('EXIF', function () {
    test('reads the camera, lens, and exposure a photograph was taken with', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          ifd0: [
            { tag: 0x010f, type: ASCII, values: 'Canon' },
            { tag: 0x0110, type: ASCII, values: 'Canon EOS R5' },
            { tag: 0x0131, type: ASCII, values: 'Darkroom 4.2' },
            { tag: 0x0112, type: SHORT, values: [6] },
          ],
          exif: [
            { tag: 0xa434, type: ASCII, values: 'RF 50mm F1.2 L USM' },
            { tag: 0x920a, type: RATIONAL, values: [50, 1] },
            { tag: 0x829d, type: RATIONAL, values: [14, 10] },
            { tag: 0x829a, type: RATIONAL, values: [1, 250] },
            { tag: 0x8827, type: SHORT, values: [400] },
            { tag: 0x9209, type: SHORT, values: [25] },
          ],
        }),
      );

      assert.strictEqual(exif?.capture?.make, 'Canon');
      assert.strictEqual(exif?.capture?.cameraModel, 'Canon EOS R5');
      assert.strictEqual(exif?.capture?.lensModel, 'RF 50mm F1.2 L USM');
      assert.strictEqual(exif?.capture?.software, 'Darkroom 4.2');
      assert.strictEqual(exif?.capture?.iso, 400);
      assert.deepEqual(exif?.capture?.focalLength, { value: 50, unit: 'mm' });
      assert.deepEqual(exif?.capture?.aperture, {
        value: 1.4,
        displayText: 'ƒ/1.4',
      });
      assert.strictEqual(
        exif?.capture?.exposureTime?.displayText,
        '1/250 s',
        'a sub-second shutter speed reads as the fraction a photographer recognizes',
      );
      assert.deepEqual(exif?.capture?.flash, {
        code: '25',
        scheme: 'exif-flash',
      });
      assert.deepEqual(exif?.capture?.orientation, {
        code: '6',
        scheme: 'exif-orientation',
      });
    });

    test('a shutter speed of a second or longer reads as a decimal, not a fraction', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          exif: [{ tag: 0x829a, type: RATIONAL, values: [4, 1] }],
        }),
      );
      assert.strictEqual(exif?.capture?.exposureTime?.displayText, '4 s');
    });

    test('converts an EXIF timestamp to ISO 8601 and honors a recorded UTC offset', function (assert) {
      let naive = extractExifFromJpeg(
        jpegWithExif({
          exif: [{ tag: 0x9003, type: ASCII, values: '2024:03:15 14:22:08' }],
        }),
      );
      assert.strictEqual(
        naive?.capture?.capturedAt,
        '2024-03-15T14:22:08',
        'without an offset tag the wall-clock time is preserved rather than shifted to UTC',
      );

      let zoned = extractExifFromJpeg(
        jpegWithExif({
          exif: [
            { tag: 0x9003, type: ASCII, values: '2024:03:15 14:22:08' },
            { tag: 0x9011, type: ASCII, values: '-04:00' },
          ],
        }),
      );
      assert.strictEqual(
        zoned?.capture?.capturedAt,
        '2024-03-15T14:22:08-04:00',
      );
    });

    test('falls back to IFD0 DateTime when the original-capture tag is absent', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          ifd0: [{ tag: 0x0132, type: ASCII, values: '2019:11:02 08:00:00' }],
        }),
      );
      assert.strictEqual(exif?.capture?.capturedAt, '2019-11-02T08:00:00');
    });

    test('accepts either ISO-speed tag, since EXIF 2.3 renamed it', function (assert) {
      let renamed = extractExifFromJpeg(
        jpegWithExif({ exif: [{ tag: 0x8833, type: LONG, values: [3200] }] }),
      );
      assert.strictEqual(renamed?.capture?.iso, 3200);
    });

    test('a malformed timestamp is dropped rather than persisted unparsed', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          exif: [{ tag: 0x9003, type: ASCII, values: 'not a date' }],
        }),
      );
      assert.strictEqual(exif?.capture?.capturedAt, undefined);
    });

    test('converts GPS coordinates to signed decimal degrees', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          gps: [
            { tag: 0x0001, type: ASCII, values: 'N' },
            { tag: 0x0002, type: RATIONAL, values: [40, 1, 44, 1, 5454, 100] },
            { tag: 0x0003, type: ASCII, values: 'W' },
            { tag: 0x0004, type: RATIONAL, values: [73, 1, 59, 1, 852, 100] },
            { tag: 0x0006, type: RATIONAL, values: [1024, 10] },
          ],
        }),
      );

      assert.strictEqual(exif?.location?.latitude, 40.7484833);
      assert.strictEqual(
        exif?.location?.longitude,
        -73.9857,
        'a western hemisphere reference makes the longitude negative',
      );
      assert.deepEqual(exif?.location?.altitude, { value: 102.4, unit: 'm' });
      assert.deepEqual(exif?.location?.source, {
        code: 'exif-gps',
        scheme: 'geo-source',
      });
    });

    test('a below-sea-level altitude reference negates the stored magnitude', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          gps: [
            { tag: 0x0005, type: SHORT, values: [1] },
            { tag: 0x0006, type: RATIONAL, values: [430, 10] },
          ],
        }),
      );
      assert.deepEqual(exif?.location?.altitude, { value: -43, unit: 'm' });
    });

    test('drops a coordinate missing its other half instead of placing it on the prime meridian', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          gps: [
            { tag: 0x0001, type: ASCII, values: 'N' },
            { tag: 0x0002, type: RATIONAL, values: [40, 1, 44, 1, 0, 1] },
          ],
        }),
      );
      assert.strictEqual(exif?.location?.latitude, undefined);
      assert.strictEqual(exif?.location?.longitude, undefined);
    });

    test('drops an out-of-range coordinate rather than clamping it', function (assert) {
      let exif = extractExifFromJpeg(
        jpegWithExif({
          gps: [
            { tag: 0x0001, type: ASCII, values: 'N' },
            { tag: 0x0002, type: RATIONAL, values: [200, 1, 0, 1, 0, 1] },
            { tag: 0x0003, type: ASCII, values: 'E' },
            { tag: 0x0004, type: RATIONAL, values: [10, 1, 0, 1, 0, 1] },
          ],
        }),
      );
      assert.strictEqual(exif?.location?.latitude, undefined);
    });

    test('reads big-endian EXIF identically to little-endian', function (assert) {
      let fixture: ExifFixture = {
        ifd0: [{ tag: 0x0110, type: ASCII, values: 'X-T4' }],
        exif: [{ tag: 0x920a, type: RATIONAL, values: [23, 1] }],
      };
      let little = extractExifFromJpeg(
        jpegWithExif({ ...fixture, littleEndian: true }),
      );
      let big = extractExifFromJpeg(
        jpegWithExif({ ...fixture, littleEndian: false }),
      );
      assert.deepEqual(big, little, 'byte order does not change the result');
      assert.strictEqual(big?.capture?.cameraModel, 'X-T4');
    });

    test('normalizes the EXIF color-space code onto the shared vocabulary', function (assert) {
      let srgb = extractExifFromJpeg(
        jpegWithExif({ exif: [{ tag: 0xa001, type: SHORT, values: [1] }] }),
      );
      assert.strictEqual(srgb?.colorSpace, 'srgb');

      let uncalibrated = extractExifFromJpeg(
        jpegWithExif({ exif: [{ tag: 0xa001, type: SHORT, values: [65535] }] }),
      );
      assert.strictEqual(uncalibrated?.colorSpace, 'uncalibrated');

      let unknownCode = extractExifFromJpeg(
        jpegWithExif({ exif: [{ tag: 0xa001, type: SHORT, values: [42] }] }),
      );
      assert.strictEqual(
        unknownCode?.colorSpace,
        undefined,
        'a code with no vocabulary entry is left unset rather than guessed at',
      );
    });

    test('a JPEG with no EXIF yields no metadata rather than empty branches', function (assert) {
      assert.strictEqual(extractExifFromJpeg(buildJpeg([])), undefined);
    });

    test('skips an APP1 segment that is XMP rather than EXIF', function (assert) {
      let xmpOnly = buildJpeg([
        {
          identifier: 'http://ns.adobe.com/xap/1.0/\u0000',
          body: new Uint8Array([0x3c, 0x78, 0x3a, 0x78]),
        },
      ]);
      assert.strictEqual(extractExifFromJpeg(xmpOnly), undefined);
    });

    test('finds the EXIF segment when an XMP segment precedes it', function (assert) {
      let bytes = buildJpeg([
        {
          identifier: 'http://ns.adobe.com/xap/1.0/\u0000',
          body: new Uint8Array([0x3c, 0x78]),
        },
        {
          identifier: 'Exif\u0000\u0000',
          body: buildTiffBlock({
            ifd0: [{ tag: 0x010f, type: ASCII, values: 'Nikon' }],
          }),
        },
      ]);
      assert.strictEqual(extractExifFromJpeg(bytes)?.capture?.make, 'Nikon');
    });

    test('a truncated EXIF block degrades to partial metadata without throwing', function (assert) {
      let block = buildTiffBlock({
        ifd0: [{ tag: 0x010f, type: ASCII, values: 'Panasonic' }],
        exif: [{ tag: 0x920a, type: RATIONAL, values: [12, 1] }],
      });
      // The heap holds `Panasonic` (10 bytes) followed by the focal-length
      // rational (8 bytes). Cutting six bytes leaves every directory intact and
      // the string reachable, while the rational's payload runs off the end —
      // which is the shape a partially-fetched file actually has.
      let exif = parseExifTiffBlock(block.subarray(0, block.length - 6), 0);

      assert.strictEqual(
        exif?.capture?.make,
        'Panasonic',
        'a payload still inside the buffer is read',
      );
      assert.strictEqual(
        exif?.capture?.focalLength,
        undefined,
        'a payload past the end is omitted rather than read from adjacent bytes',
      );
    });

    test('a garbage TIFF block is rejected without throwing', function (assert) {
      assert.strictEqual(
        parseExifTiffBlock(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 0),
        undefined,
        'an invalid byte-order marker is not EXIF',
      );
      assert.strictEqual(
        parseExifTiffBlock(new Uint8Array([0x49, 0x49]), 0),
        undefined,
        'a block too short to hold a header is rejected on bounds',
      );
      assert.strictEqual(
        parseExifTiffBlock(new Uint8Array(64), 200),
        undefined,
        'an out-of-range start offset is rejected rather than read',
      );
    });

    test('an implausible directory entry count is refused', function (assert) {
      let bytes = buildTiffBlock({
        ifd0: [{ tag: 0x010f, type: ASCII, values: 'Sony' }],
      });
      // Overwrite IFD0's entry count with a value no real directory carries.
      new DataView(bytes.buffer).setUint16(8, 40000, true);
      assert.strictEqual(parseExifTiffBlock(bytes, 0), undefined);
    });
  });

  module('PNG color profile', function () {
    test('reads bit depth, channels, and alpha from each legal color type', function (assert) {
      assert.deepEqual(extractPngColorProfile(buildPng(8, 0)), {
        colorSpace: 'grayscale',
        bitDepth: 8,
        channels: 1,
        hasAlpha: false,
      });
      // Color type 2 is truecolor: IHDR proves three channels but not their
      // colorimetry, so no `colorSpace` is claimed.
      assert.deepEqual(extractPngColorProfile(buildPng(8, 2)), {
        bitDepth: 8,
        channels: 3,
        hasAlpha: false,
      });
      assert.deepEqual(extractPngColorProfile(buildPng(4, 3)), {
        colorSpace: 'indexed',
        bitDepth: 4,
        channels: 3,
        hasAlpha: false,
      });
      assert.deepEqual(extractPngColorProfile(buildPng(16, 4)), {
        colorSpace: 'grayscale-alpha',
        bitDepth: 16,
        channels: 2,
        hasAlpha: true,
      });
      // Color type 6 is truecolor + alpha: again four channels, no colorimetry.
      assert.deepEqual(extractPngColorProfile(buildPng(8, 6)), {
        bitDepth: 8,
        channels: 4,
        hasAlpha: true,
      });
    });

    test('drops an illegal bit depth and an undefined color type', function (assert) {
      let profile = extractPngColorProfile(buildPng(7, 5));
      assert.strictEqual(
        profile,
        undefined,
        'neither 7-bit samples nor color type 5 exist in PNG, so nothing is reported',
      );
    });

    test('a buffer too short to hold IHDR reports nothing', function (assert) {
      assert.strictEqual(
        extractPngColorProfile(buildPng(8, 6).subarray(0, 24)),
        undefined,
      );
    });
  });

  module('JPEG color profile', function () {
    test('maps the frame component count onto a color model', function (assert) {
      // One component is unambiguously grayscale.
      assert.deepEqual(
        extractJpgColorProfile(buildJpeg([], { components: 1 })),
        { colorSpace: 'grayscale', bitDepth: 8, channels: 1, hasAlpha: false },
      );
      // Three components are RGB or YCbCr and four are CMYK or YCCK; the count
      // alone can't tell which, so `colorSpace` is left unset while `channels`
      // still records the count.
      assert.deepEqual(
        extractJpgColorProfile(buildJpeg([], { components: 3 })),
        { bitDepth: 8, channels: 3, hasAlpha: false },
      );
      assert.deepEqual(
        extractJpgColorProfile(buildJpeg([], { components: 4 })),
        { bitDepth: 8, channels: 4, hasAlpha: false },
      );
    });

    test('reports a 12-bit extended-mode frame precision', function (assert) {
      assert.strictEqual(
        extractJpgColorProfile(buildJpeg([], { precision: 12 }))?.bitDepth,
        12,
      );
    });

    test('a file with no frame header reports nothing instead of throwing', function (assert) {
      assert.strictEqual(
        extractJpgColorProfile(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
        undefined,
      );
    });
  });

  module('GIF color profile', function () {
    test('derives bit depth from the global color table size', function (assert) {
      assert.deepEqual(extractGifColorProfile(buildGif(true, 7)), {
        colorSpace: 'indexed',
        bitDepth: 8,
        channels: 3,
      });
      assert.deepEqual(extractGifColorProfile(buildGif(true, 3)), {
        colorSpace: 'indexed',
        bitDepth: 4,
        channels: 3,
      });
    });

    test('omits bit depth when there is no global color table', function (assert) {
      assert.deepEqual(extractGifColorProfile(buildGif(false, 0)), {
        colorSpace: 'indexed',
        channels: 3,
      });
    });

    test('never claims to know whether a GIF is transparent', function (assert) {
      // Transparency is declared in a Graphic Control Extension well past this
      // header, so reporting `false` here would be a guess dressed as a fact.
      assert.strictEqual(
        extractGifColorProfile(buildGif(true, 7))?.hasAlpha,
        undefined,
      );
    });
  });

  module('WebP color profile', function () {
    test('lossy WebP has no alpha channel', function (assert) {
      let profile = extractWebpColorProfile(buildWebp('VP8 ', []));
      assert.false(profile?.hasAlpha);
      assert.strictEqual(profile?.channels, 3);
    });

    test('reads the lossless alpha bit out of the VP8L header word', function (assert) {
      // The 32-bit little-endian word at offset 21 packs width, height, then
      // the alpha flag at bit 28.
      let withAlpha = new Uint8Array(4);
      new DataView(withAlpha.buffer).setUint32(0, 1 << 28, true);
      assert.true(
        extractWebpColorProfile(buildWebp('VP8L', [0x2f, ...withAlpha]))
          ?.hasAlpha,
      );

      let withoutAlpha = new Uint8Array(4);
      new DataView(withoutAlpha.buffer).setUint32(0, 0, true);
      assert.false(
        extractWebpColorProfile(buildWebp('VP8L', [0x2f, ...withoutAlpha]))
          ?.hasAlpha,
      );
    });

    test('reads the extended-format alpha and ICC flags', function (assert) {
      let alphaAndIcc = extractWebpColorProfile(buildWebp('VP8X', [0x30]));
      assert.true(alphaAndIcc?.hasAlpha);
      assert.strictEqual(alphaAndIcc?.channels, 4);
      assert.strictEqual(alphaAndIcc?.iccProfile, 'embedded');

      let plain = extractWebpColorProfile(buildWebp('VP8X', [0x00]));
      assert.false(plain?.hasAlpha);
      assert.strictEqual(plain?.iccProfile, undefined);
    });

    test('an unrecognized first chunk reports nothing', function (assert) {
      assert.strictEqual(
        extractWebpColorProfile(buildWebp('ANIM', [0x00])),
        undefined,
      );
    });
  });

  module('AVIF color profile', function () {
    test('reads bit depth and channel count from the pixi property', function (assert) {
      let profile = extractAvifColorProfile(buildAvif({ pixi: [10, 10, 10] }));
      assert.strictEqual(profile?.bitDepth, 10);
      assert.strictEqual(profile?.channels, 3);
    });

    test('maps CICP colour primaries onto the shared vocabulary', function (assert) {
      let p3 = extractAvifColorProfile(
        // colr payload: 'nclx', then primaries, transfer, matrix, range.
        buildAvif({ colr: [0x6e, 0x63, 0x6c, 0x78, 0, 12, 0, 13, 0, 1, 0x80] }),
      );
      assert.strictEqual(p3?.colorSpace, 'display-p3');

      let rec709 = extractAvifColorProfile(
        buildAvif({ colr: [0x6e, 0x63, 0x6c, 0x78, 0, 1, 0, 13, 0, 1, 0x80] }),
      );
      assert.strictEqual(rec709?.colorSpace, 'srgb');
    });

    test('records an embedded ICC profile without naming it', function (assert) {
      let profile = extractAvifColorProfile(
        buildAvif({ colr: [0x70, 0x72, 0x6f, 0x66, 0, 0, 0, 0] }),
      );
      assert.strictEqual(profile?.iccProfile, 'embedded');
    });

    test('detects alpha from an auxiliary-image property', function (assert) {
      let profile = extractAvifColorProfile(
        buildAvif({
          pixi: [8, 8, 8],
          auxC: 'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha',
        }),
      );
      assert.true(profile?.hasAlpha);
    });

    test('treats a non-alpha auxiliary image as no alpha evidence', function (assert) {
      let profile = extractAvifColorProfile(
        buildAvif({
          pixi: [8, 8, 8],
          auxC: 'urn:mpeg:mpegB:cicp:systems:auxiliary:depth',
        }),
      );
      assert.strictEqual(profile?.hasAlpha, undefined);
    });

    test('a single-channel image with no colr box reads as grayscale', function (assert) {
      assert.strictEqual(
        extractAvifColorProfile(buildAvif({ pixi: [12] }))?.colorSpace,
        'grayscale',
      );
    });

    test('an unreachable box tree reports nothing', function (assert) {
      assert.strictEqual(
        extractAvifColorProfile(new Uint8Array(24)),
        undefined,
      );
    });
  });

  module('attribute assembly', function () {
    test('the container header outranks the EXIF color-space tag', function (assert) {
      let attributes = rasterImageAttributes(
        { colorSpace: 'srgb' },
        { colorSpace: 'display-p3', bitDepth: 10 },
      );
      assert.deepEqual(attributes.colorProfile, {
        bitDepth: 10,
        colorSpace: { code: 'display-p3', scheme: 'color-space' },
      });
    });

    test('the EXIF tag supplies a color space the header did not', function (assert) {
      let attributes = rasterImageAttributes(
        { colorSpace: 'adobe-rgb' },
        { bitDepth: 8, channels: 3 },
      );
      assert.deepEqual(attributes.colorProfile, {
        bitDepth: 8,
        channels: 3,
        colorSpace: { code: 'adobe-rgb', scheme: 'color-space' },
      });
    });

    test('a color space is enough on its own to produce the field', function (assert) {
      let attributes = rasterImageAttributes({ colorSpace: 'srgb' }, undefined);
      assert.deepEqual(attributes.colorProfile, {
        colorSpace: { code: 'srgb', scheme: 'color-space' },
      });
    });

    test('an image that revealed nothing adds no attributes at all', function (assert) {
      assert.deepEqual(
        rasterImageAttributes(undefined, undefined),
        {},
        'no empty exif or colorProfile object reaches the index row',
      );
    });

    test('the EXIF color-space tag never becomes part of the exif attribute', function (assert) {
      let attributes = rasterImageAttributes(
        { capture: { make: 'Leica' }, colorSpace: 'srgb' },
        undefined,
      );
      assert.deepEqual(attributes.exif, { capture: { make: 'Leica' } });
    });

    test('a false alpha flag survives assembly rather than being pruned as empty', function (assert) {
      let attributes = rasterImageAttributes(undefined, { hasAlpha: false });
      assert.deepEqual(
        attributes.colorProfile,
        { hasAlpha: false },
        'knowing a format has no alpha channel is a fact worth persisting',
      );
    });
  });
});
