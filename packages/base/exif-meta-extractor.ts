// Portable EXIF reader. Pure `DataView`/`TextDecoder` — no DOM, no host APIs —
// so the same function runs in the prerenderer's extract pass, in the host app,
// and in a future server-side extraction worker without change.
//
// The unit of work is a TIFF block, not a JPEG: EXIF is a TIFF structure that
// several containers embed verbatim (JPEG in an APP1 segment, PNG in an `eXIf`
// chunk, WebP in an `EXIF` RIFF chunk, HEIF/AVIF in an item property). Only
// `extractExifFromJpeg` knows about JPEG framing; `parseExifTiffBlock` is the
// piece the other containers reuse as they land.
//
// Absent EXIF is not an error — most PNGs and every generated image lack it —
// so a missing or unreadable block returns `undefined` rather than throwing.
// Only the container's own signature check (in the `*-meta-extractor` that owns
// the format) should reject a file.

export interface ExifCapture {
  make?: string;
  cameraModel?: string;
  lensModel?: string;
  focalLength?: { value: number; unit: string; displayText?: string };
  aperture?: { value: number; unit?: string; displayText?: string };
  exposureTime?: { value: number; unit: string; displayText?: string };
  iso?: number;
  flash?: { code: string; scheme: string };
  orientation?: { code: string; scheme: string };
  capturedAt?: string;
  software?: string;
}

export interface ExifLocation {
  latitude?: number;
  longitude?: number;
  altitude?: { value: number; unit: string };
  source?: { code: string; scheme: string };
}

export interface ExifMetadata {
  capture?: ExifCapture;
  location?: ExifLocation;
  // A slug from the shared `color-space` vocabulary, not EXIF's raw number.
  // The container's own header is the better authority on how pixels are
  // encoded, so this is offered as a fallback for color space alone and is
  // merged into the family's single `colorProfile` field rather than forming a
  // second, competing one.
  colorSpace?: string;
}

// TIFF field types, by their numeric code. Only the ones EXIF actually uses for
// the tags below are named; the size table covers the rest so an unexpected
// type still advances the cursor correctly instead of desynchronizing the walk.
const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SLONG = 9;
const TYPE_SRATIONAL = 10;

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

// IFD0 (the primary image directory)
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_SOFTWARE = 0x0131;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;

// Exif sub-IFD
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_ISO_SPEED_RATINGS = 0x8827;
const TAG_PHOTOGRAPHIC_SENSITIVITY = 0x8833;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_FLASH = 0x9209;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_COLOR_SPACE = 0xa001;
const TAG_LENS_MODEL = 0xa434;

// GPS sub-IFD
const TAG_GPS_LATITUDE_REF = 0x0001;
const TAG_GPS_LATITUDE = 0x0002;
const TAG_GPS_LONGITUDE_REF = 0x0003;
const TAG_GPS_LONGITUDE = 0x0004;
const TAG_GPS_ALTITUDE_REF = 0x0005;
const TAG_GPS_ALTITUDE = 0x0006;

// A directory with more entries than this is corrupt or hostile, not a photo.
// Real IFD0/Exif directories run well under a hundred entries.
const MAX_IFD_ENTRIES = 512;

// EXIF strings are nominally ASCII; in practice makers write Latin-1 and
// occasionally UTF-8. Latin-1 never throws and leaves ASCII untouched, so it's
// the safe decode for short identifier strings.
const LATIN1 = new TextDecoder('latin1');

const TIFF_MAGIC = 0x002a;
const BYTE_ORDER_LITTLE = 0x4949; // 'II'
const BYTE_ORDER_BIG = 0x4d4d; // 'MM'

// One parsed 12-byte directory entry, with its payload still unread: `count`
// and `type` are what decide how to interpret `valueOffset`.
interface IfdEntry {
  type: number;
  count: number;
  // Either the value itself (when it fits in four bytes) or an offset from the
  // start of the TIFF block. Resolved by `payloadOffset`.
  valueOffset: number;
  // Absolute offset of the entry's own 4-byte value field, needed because a
  // value that fits inline lives there rather than at `valueOffset`.
  inlineOffset: number;
}

// A bounds-checked cursor over one TIFF block. Every read returns `undefined`
// rather than throwing when it would run past the end, so a truncated block
// degrades to partial metadata instead of losing the whole extract.
class TiffReader {
  #view: DataView;
  #length: number;
  #littleEndian: boolean;
  // Offsets inside a TIFF block are relative to the block's own start, which
  // is not the start of the file.
  #base: number;

  constructor(bytes: Uint8Array, base: number, littleEndian: boolean) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#length = bytes.byteLength;
    this.#littleEndian = littleEndian;
    this.#base = base;
  }

  #inBounds(absolute: number, size: number): boolean {
    return absolute >= 0 && absolute + size <= this.#length;
  }

  absolute(relative: number): number {
    return this.#base + relative;
  }

  uint16(absolute: number): number | undefined {
    return this.#inBounds(absolute, 2)
      ? this.#view.getUint16(absolute, this.#littleEndian)
      : undefined;
  }

  uint32(absolute: number): number | undefined {
    return this.#inBounds(absolute, 4)
      ? this.#view.getUint32(absolute, this.#littleEndian)
      : undefined;
  }

  int32(absolute: number): number | undefined {
    return this.#inBounds(absolute, 4)
      ? this.#view.getInt32(absolute, this.#littleEndian)
      : undefined;
  }

  uint8(absolute: number): number | undefined {
    return this.#inBounds(absolute, 1)
      ? this.#view.getUint8(absolute)
      : undefined;
  }

  ascii(absolute: number, length: number): string | undefined {
    if (!this.#inBounds(absolute, length)) {
      return undefined;
    }
    let bytes = new Uint8Array(
      this.#view.buffer,
      this.#view.byteOffset + absolute,
      length,
    );
    // EXIF ASCII fields are NUL-terminated and often NUL- or space-padded to a
    // fixed width, so trim to the first NUL before decoding.
    let end = bytes.indexOf(0);
    let text = LATIN1.decode(end === -1 ? bytes : bytes.subarray(0, end));
    let trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  // Walk a directory into a tag→entry map. Unknown tags are kept: the cost is
  // a map entry, and it means adding a tag later needs no re-walk.
  readIfd(relativeOffset: number): Map<number, IfdEntry> | undefined {
    let directory = this.absolute(relativeOffset);
    let count = this.uint16(directory);
    if (count === undefined || count === 0 || count > MAX_IFD_ENTRIES) {
      return undefined;
    }
    let entries = new Map<number, IfdEntry>();
    for (let index = 0; index < count; index++) {
      let entryOffset = directory + 2 + index * 12;
      let tag = this.uint16(entryOffset);
      let type = this.uint16(entryOffset + 2);
      let valueCount = this.uint32(entryOffset + 4);
      let valueOffset = this.uint32(entryOffset + 8);
      if (
        tag === undefined ||
        type === undefined ||
        valueCount === undefined ||
        valueOffset === undefined
      ) {
        break;
      }
      entries.set(tag, {
        type,
        count: valueCount,
        valueOffset,
        inlineOffset: entryOffset + 8,
      });
    }
    return entries.size > 0 ? entries : undefined;
  }

  // Where an entry's payload actually starts. A payload of four bytes or fewer
  // is stored in the entry itself; anything larger is stored elsewhere in the
  // block and the entry holds a relative offset to it.
  #payloadOffset(entry: IfdEntry): number {
    let size = (TYPE_SIZES[entry.type] ?? 1) * entry.count;
    return size <= 4 ? entry.inlineOffset : this.absolute(entry.valueOffset);
  }

  string(entry: IfdEntry | undefined): string | undefined {
    if (!entry || entry.type !== TYPE_ASCII || entry.count === 0) {
      return undefined;
    }
    return this.ascii(this.#payloadOffset(entry), entry.count);
  }

  integer(entry: IfdEntry | undefined): number | undefined {
    if (!entry || entry.count === 0) {
      return undefined;
    }
    let offset = this.#payloadOffset(entry);
    switch (entry.type) {
      case TYPE_BYTE:
        return this.uint8(offset);
      case TYPE_SHORT:
        return this.uint16(offset);
      case TYPE_LONG:
        return this.uint32(offset);
      case TYPE_SLONG:
        return this.int32(offset);
      default:
        return undefined;
    }
  }

  // A TIFF rational is a numerator/denominator pair of 4-byte integers.
  #rationalAt(offset: number, signed: boolean): number | undefined {
    let numerator = signed ? this.int32(offset) : this.uint32(offset);
    let denominator = signed ? this.int32(offset + 4) : this.uint32(offset + 4);
    if (numerator === undefined || !denominator) {
      return undefined;
    }
    let value = numerator / denominator;
    return Number.isFinite(value) ? value : undefined;
  }

  rational(entry: IfdEntry | undefined): number | undefined {
    if (
      !entry ||
      entry.count === 0 ||
      (entry.type !== TYPE_RATIONAL && entry.type !== TYPE_SRATIONAL)
    ) {
      return undefined;
    }
    return this.#rationalAt(
      this.#payloadOffset(entry),
      entry.type === TYPE_SRATIONAL,
    );
  }

  rationals(entry: IfdEntry | undefined, wanted: number): number[] | undefined {
    if (
      !entry ||
      entry.count < wanted ||
      (entry.type !== TYPE_RATIONAL && entry.type !== TYPE_SRATIONAL)
    ) {
      return undefined;
    }
    let start = this.#payloadOffset(entry);
    let signed = entry.type === TYPE_SRATIONAL;
    let values: number[] = [];
    for (let index = 0; index < wanted; index++) {
      let value = this.#rationalAt(start + index * 8, signed);
      if (value === undefined) {
        return undefined;
      }
      values.push(value);
    }
    return values;
  }
}

// EXIF writes `YYYY:MM:DD HH:MM:SS`, which no `Date` parser accepts. Convert to
// ISO 8601 so the value round-trips through DateTimeField's `parseISO`.
//
// The timestamp carries no zone unless a matching `OffsetTime*` tag is present.
// When it isn't, the naive form is emitted deliberately: it is the wall-clock
// time the camera recorded, and inventing UTC would silently shift every photo
// by the reader's own offset.
function exifTimestampToIso(
  value: string | undefined,
  utcOffset?: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
  let match = value.match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) {
    return undefined;
  }
  let [, year, month, day, hour, minute, second] = match;
  let base = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  let offset = utcOffset?.trim();
  return offset && /^([+-]\d{2}:\d{2}|Z)$/.test(offset)
    ? `${base}${offset}`
    : base;
}

// Shutter speeds are read as fractions, not decimals — "1/250 s" is the number
// a photographer recognizes, "0.004 s" is not.
function exposureDisplay(seconds: number): string {
  if (seconds >= 1) {
    return `${Math.round(seconds * 100) / 100} s`;
  }
  let denominator = Math.round(1 / seconds);
  return denominator > 0 ? `1/${denominator} s` : `${seconds} s`;
}

// Degrees/minutes/seconds triple plus a hemisphere letter into signed decimal
// degrees. Anything outside the valid range is dropped rather than clamped: an
// out-of-range coordinate is a parse failure, not a place.
function gpsToDecimal(
  parts: number[] | undefined,
  reference: string | undefined,
  limit: number,
): number | undefined {
  if (!parts || parts.length < 3) {
    return undefined;
  }
  let [degrees, minutes, seconds] = parts as [number, number, number];
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(decimal) || Math.abs(decimal) > limit) {
    return undefined;
  }
  let negative = /^[SW]/i.test(reference ?? '');
  // Round at ~1 cm of precision; further digits are noise from the DMS divide.
  let signed = negative ? -decimal : decimal;
  return Math.round(signed * 1e7) / 1e7;
}

// Drop a branch whose every value came back undefined, so an image with no
// EXIF at all produces no attributes rather than a nest of empty objects.
function pruned<T extends object>(candidate: T): T | undefined {
  let entries = Object.entries(candidate).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function readCapture(
  reader: TiffReader,
  ifd0: Map<number, IfdEntry> | undefined,
  exifIfd: Map<number, IfdEntry> | undefined,
): ExifCapture | undefined {
  let focalLength = reader.rational(exifIfd?.get(TAG_FOCAL_LENGTH));
  let aperture = reader.rational(exifIfd?.get(TAG_F_NUMBER));
  let exposure = reader.rational(exifIfd?.get(TAG_EXPOSURE_TIME));
  let orientation = reader.integer(ifd0?.get(TAG_ORIENTATION));
  let flash = reader.integer(exifIfd?.get(TAG_FLASH));
  // `ISOSpeedRatings` was renamed `PhotographicSensitivity` in EXIF 2.3; files
  // in the wild carry either, so accept both.
  let iso =
    reader.integer(exifIfd?.get(TAG_ISO_SPEED_RATINGS)) ??
    reader.integer(exifIfd?.get(TAG_PHOTOGRAPHIC_SENSITIVITY));
  let capturedAt = exifTimestampToIso(
    reader.string(exifIfd?.get(TAG_DATETIME_ORIGINAL)) ??
      reader.string(ifd0?.get(TAG_DATETIME)),
    reader.string(exifIfd?.get(TAG_OFFSET_TIME_ORIGINAL)),
  );

  return pruned<ExifCapture>({
    make: reader.string(ifd0?.get(TAG_MAKE)),
    cameraModel: reader.string(ifd0?.get(TAG_MODEL)),
    lensModel: reader.string(exifIfd?.get(TAG_LENS_MODEL)),
    focalLength:
      focalLength === undefined
        ? undefined
        : {
            value: Math.round(focalLength * 100) / 100,
            unit: 'mm',
          },
    aperture:
      aperture === undefined
        ? undefined
        : {
            value: Math.round(aperture * 100) / 100,
            displayText: `ƒ/${Math.round(aperture * 100) / 100}`,
          },
    exposureTime:
      exposure === undefined || exposure <= 0
        ? undefined
        : {
            value: exposure,
            unit: 's',
            displayText: exposureDisplay(exposure),
          },
    iso,
    flash:
      flash === undefined
        ? undefined
        : { code: String(flash), scheme: 'exif-flash' },
    orientation:
      orientation === undefined
        ? undefined
        : { code: String(orientation), scheme: 'exif-orientation' },
    capturedAt,
    software: reader.string(ifd0?.get(TAG_SOFTWARE)),
  });
}

function readLocation(
  reader: TiffReader,
  gpsIfd: Map<number, IfdEntry> | undefined,
): ExifLocation | undefined {
  if (!gpsIfd) {
    return undefined;
  }
  let latitude = gpsToDecimal(
    reader.rationals(gpsIfd.get(TAG_GPS_LATITUDE), 3),
    reader.string(gpsIfd.get(TAG_GPS_LATITUDE_REF)),
    90,
  );
  let longitude = gpsToDecimal(
    reader.rationals(gpsIfd.get(TAG_GPS_LONGITUDE), 3),
    reader.string(gpsIfd.get(TAG_GPS_LONGITUDE_REF)),
    180,
  );
  let altitude = reader.rational(gpsIfd.get(TAG_GPS_ALTITUDE));
  // `GPSAltitudeRef` of 1 means the altitude is measured *below* sea level, so
  // the stored magnitude has to be negated to mean anything.
  let belowSeaLevel = reader.integer(gpsIfd.get(TAG_GPS_ALTITUDE_REF)) === 1;

  // A coordinate needs both halves to be a place. Dropping a lone latitude
  // avoids persisting a point on the prime meridian that the camera never saw.
  if (latitude === undefined || longitude === undefined) {
    return pruned<ExifLocation>({
      altitude:
        altitude === undefined
          ? undefined
          : {
              value:
                Math.round((belowSeaLevel ? -altitude : altitude) * 100) / 100,
              unit: 'm',
            },
    });
  }

  return {
    latitude,
    longitude,
    ...(altitude === undefined
      ? {}
      : {
          altitude: {
            value:
              Math.round((belowSeaLevel ? -altitude : altitude) * 100) / 100,
            unit: 'm',
          },
        }),
    source: { code: 'exif-gps', scheme: 'geo-source' },
  };
}

// EXIF only ever names three color spaces: sRGB, Adobe RGB (as the
// unregistered-but-universal 2), and "uncalibrated" for everything else —
// which is what a wide-gamut file gets, with the real profile living in an
// attached ICC chunk. Mapped onto the shared vocabulary so the persisted value
// doesn't depend on which container the tag arrived in.
const EXIF_COLOR_SPACE_SLUGS: Record<number, string> = {
  1: 'srgb',
  2: 'adobe-rgb',
  65535: 'uncalibrated',
};

function readColorSpace(
  reader: TiffReader,
  exifIfd: Map<number, IfdEntry> | undefined,
): string | undefined {
  let colorSpace = reader.integer(exifIfd?.get(TAG_COLOR_SPACE));
  return colorSpace === undefined
    ? undefined
    : EXIF_COLOR_SPACE_SLUGS[colorSpace];
}

// Parse a TIFF/EXIF block that begins at `tiffStart` within `bytes`. Callers
// pass the offset of the byte-order marker, i.e. past any container-specific
// prefix such as JPEG's `Exif\0\0`.
export function parseExifTiffBlock(
  bytes: Uint8Array,
  tiffStart: number,
): ExifMetadata | undefined {
  if (tiffStart < 0 || tiffStart + 8 > bytes.byteLength) {
    return undefined;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteOrder = view.getUint16(tiffStart);
  if (byteOrder !== BYTE_ORDER_LITTLE && byteOrder !== BYTE_ORDER_BIG) {
    return undefined;
  }
  let littleEndian = byteOrder === BYTE_ORDER_LITTLE;
  if (view.getUint16(tiffStart + 2, littleEndian) !== TIFF_MAGIC) {
    return undefined;
  }
  let ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);

  let reader = new TiffReader(bytes, tiffStart, littleEndian);
  let ifd0 = reader.readIfd(ifd0Offset);
  // The Exif and GPS directories are reached through pointer tags in IFD0. A
  // file may carry either, both, or neither.
  let exifPointer = reader.integer(ifd0?.get(TAG_EXIF_IFD_POINTER));
  let gpsPointer = reader.integer(ifd0?.get(TAG_GPS_IFD_POINTER));
  let exifIfd =
    exifPointer === undefined ? undefined : reader.readIfd(exifPointer);
  let gpsIfd =
    gpsPointer === undefined ? undefined : reader.readIfd(gpsPointer);

  return pruned<ExifMetadata>({
    capture: readCapture(reader, ifd0, exifIfd),
    location: readLocation(reader, gpsIfd),
    colorSpace: readColorSpace(reader, exifIfd),
  });
}

// `Exif\0\0`, the six-byte identifier that distinguishes the EXIF APP1 segment
// from the XMP one (which shares the same marker).
const EXIF_APP1_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

const MARKER_SOI = 0xd8;
const MARKER_EOI = 0xd9;
const MARKER_SOS = 0xda;
const MARKER_APP1 = 0xe1;

function hasExifIdentifier(bytes: Uint8Array, offset: number): boolean {
  if (offset + EXIF_APP1_IDENTIFIER.length > bytes.byteLength) {
    return false;
  }
  return EXIF_APP1_IDENTIFIER.every(
    (expected, index) => bytes[offset + index] === expected,
  );
}

// Find and parse the EXIF APP1 segment of a JPEG. Returns `undefined` when the
// file carries none, which is the common case for generated images.
export function extractExifFromJpeg(
  bytes: Uint8Array,
): ExifMetadata | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== MARKER_SOI) {
    return undefined;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      // Marker structure has desynchronized. Dimension extraction treats this
      // as a malformed file; here it only means no EXIF is reachable.
      return undefined;
    }
    // Fill bytes: a run of 0xFF before the marker code is legal padding.
    while (offset + 1 < bytes.byteLength && bytes[offset + 1] === 0xff) {
      offset++;
    }
    let marker = bytes[offset + 1]!;
    offset += 2;

    // Entropy-coded data begins at SOS; no further metadata segments follow.
    if (marker === MARKER_SOS || marker === MARKER_EOI) {
      return undefined;
    }
    // Standalone markers (SOI, RSTn) carry no length field.
    if (marker === MARKER_SOI || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.byteLength) {
      return undefined;
    }
    let segmentLength = view.getUint16(offset);
    // The length field counts itself, so anything under two bytes is corrupt
    // and would make the walk spin in place.
    if (segmentLength < 2) {
      return undefined;
    }
    if (marker === MARKER_APP1 && hasExifIdentifier(bytes, offset + 2)) {
      // The TIFF block starts immediately after the identifier, and every
      // offset inside it is relative to that point.
      return parseExifTiffBlock(
        bytes,
        offset + 2 + EXIF_APP1_IDENTIFIER.length,
      );
    }
    offset += segmentLength;
  }
  return undefined;
}
