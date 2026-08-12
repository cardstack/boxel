// WebM (and Matroska) video, read out of the EBML tree.
//
// EBML is a tag-length-value format: every element is a variable-length id, a
// variable-length size, and a payload that is either more elements or a value.
// Nothing is at a fixed offset, so this walks rather than indexes — but the
// elements it wants (Info and Tracks, inside Segment) sit near the front, ahead
// of the Clusters that hold the actual frames, so a bounded head read reaches
// them without touching the media.
//
// Pure `DataView`/`TextDecoder`, no DOM.

import { FileContentMismatchError } from './file-api';
import { prunedVideoEncoding, type VideoEncoding } from './video-metadata';

// EBML element ids, as their full encoded form including the length marker.
const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TRACKS = 0x1654ae6b;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_VIDEO = 0xe0;
const ID_PIXEL_WIDTH = 0xb0;
const ID_PIXEL_HEIGHT = 0xba;
// Display dimensions, which differ from pixel dimensions on anamorphic content.
const ID_DISPLAY_WIDTH = 0x54b0;
const ID_DISPLAY_HEIGHT = 0x54ba;
const ID_DEFAULT_DURATION = 0x23e383;

const TRACK_TYPE_VIDEO = 1;
const TRACK_TYPE_AUDIO = 2;

// Matroska states codecs as strings rather than four-character codes.
const CODEC_NAMES: Record<string, string> = {
  V_VP8: 'VP8',
  V_VP9: 'VP9',
  V_AV1: 'AV1',
  'V_MPEG4/ISO/AVC': 'H.264 (AVC)',
  V_MPEGH_ISO_HEVC: 'H.265 (HEVC)',
  'V_MPEGH/ISO/HEVC': 'H.265 (HEVC)',
  A_OPUS: 'Opus',
  A_VORBIS: 'Vorbis',
  A_AAC: 'AAC',
  A_FLAC: 'FLAC',
  'A_PCM/INT/LIT': 'PCM',
};

// The default when a Segment states no TimecodeScale, per the Matroska spec:
// one millisecond expressed in nanoseconds.
const DEFAULT_TIMECODE_SCALE = 1_000_000;

// Guards the walk against a corrupt size field. A Tracks element holds a handful
// of entries, not thousands.
const MAX_ELEMENTS_PER_LEVEL = 4096;

interface Element {
  id: number;
  payloadStart: number;
  payloadEnd: number;
  next: number;
  // An element whose size is the "unknown" sentinel runs to the end of its
  // parent, which is how a live-streamed Segment is written.
  unknownSize: boolean;
}

// EBML numbers are length-prefixed by leading zero bits: the first set bit says
// how many bytes the number occupies.
function readVariableLength(
  bytes: Uint8Array,
  offset: number,
  end: number,
  // An id keeps its length marker; a size has it stripped.
  keepMarker: boolean,
): { value: number; length: number; isUnknown: boolean } | undefined {
  if (offset >= end) {
    return undefined;
  }
  let first = bytes[offset]!;
  if (first === 0) {
    return undefined;
  }
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || offset + length > end) {
    return undefined;
  }
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = keepMarker ? false : (first & (mask - 1)) === mask - 1;
  for (let index = 1; index < length; index++) {
    let byte = bytes[offset + index]!;
    // Beyond ~53 bits a JS number loses integer precision; sizes that large are
    // not something this walks anyway.
    value = value * 256 + byte;
    if (byte !== 0xff) {
      allOnes = false;
    }
  }
  return { value, length, isUnknown: allOnes };
}

function readElement(
  bytes: Uint8Array,
  offset: number,
  end: number,
): Element | undefined {
  let id = readVariableLength(bytes, offset, end, true);
  if (!id) {
    return undefined;
  }
  let size = readVariableLength(bytes, offset + id.length, end, false);
  if (!size) {
    return undefined;
  }
  let payloadStart = offset + id.length + size.length;
  let payloadEnd = size.isUnknown
    ? end
    : Math.min(payloadStart + size.value, end);
  return {
    id: id.value,
    payloadStart,
    payloadEnd,
    next: size.isUnknown ? end : payloadStart + size.value,
    unknownSize: size.isUnknown,
  };
}

function eachChild(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (element: Element) => void,
): void {
  let offset = start;
  for (let index = 0; index < MAX_ELEMENTS_PER_LEVEL && offset < end; index++) {
    let element = readElement(bytes, offset, end);
    if (!element || element.next <= offset) {
      return;
    }
    visit(element);
    offset = element.next;
  }
}

function readUint(
  bytes: Uint8Array,
  start: number,
  end: number,
): number | undefined {
  if (start >= end || end - start > 8) {
    return undefined;
  }
  let value = 0;
  for (let index = start; index < end; index++) {
    value = value * 256 + bytes[index]!;
  }
  return value;
}

// Matroska stores Duration as a float, in units of TimecodeScale.
function readFloat(
  view: DataView,
  start: number,
  end: number,
): number | undefined {
  let width = end - start;
  if (width === 4) {
    return view.getFloat32(start);
  }
  if (width === 8) {
    return view.getFloat64(start);
  }
  return undefined;
}

function readString(
  bytes: Uint8Array,
  start: number,
  end: number,
): string | undefined {
  if (start >= end) {
    return undefined;
  }
  let raw = bytes.subarray(start, end);
  let terminator = raw.indexOf(0);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(
    terminator === -1 ? raw : raw.subarray(0, terminator),
  );
  return text.trim() || undefined;
}

interface WebmTrack {
  type?: number;
  codec?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  // Nanoseconds per frame, which is how Matroska states a constant frame rate.
  defaultDurationNs?: number;
}

export function extractWebmEncoding(
  bytes: Uint8Array,
): VideoEncoding | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let head = readElement(bytes, 0, bytes.length);
  if (!head || head.id !== ID_EBML) {
    return undefined;
  }

  // The Segment follows the EBML header and holds everything else.
  let segment: Element | undefined;
  let offset = head.next;
  for (let index = 0; index < 8 && offset < bytes.length; index++) {
    let element = readElement(bytes, offset, bytes.length);
    if (!element || element.next <= offset) {
      break;
    }
    if (element.id === ID_SEGMENT) {
      segment = element;
      break;
    }
    offset = element.next;
  }
  if (!segment) {
    return undefined;
  }

  let timecodeScale = DEFAULT_TIMECODE_SCALE;
  let rawDuration: number | undefined;
  let tracks: WebmTrack[] = [];

  eachChild(bytes, segment.payloadStart, segment.payloadEnd, (child) => {
    if (child.id === ID_INFO) {
      eachChild(bytes, child.payloadStart, child.payloadEnd, (info) => {
        if (info.id === ID_TIMECODE_SCALE) {
          timecodeScale =
            readUint(bytes, info.payloadStart, info.payloadEnd) ??
            DEFAULT_TIMECODE_SCALE;
        } else if (info.id === ID_DURATION) {
          rawDuration = readFloat(view, info.payloadStart, info.payloadEnd);
        }
      });
    } else if (child.id === ID_TRACKS) {
      eachChild(bytes, child.payloadStart, child.payloadEnd, (entry) => {
        if (entry.id !== ID_TRACK_ENTRY) {
          return;
        }
        let track: WebmTrack = {};
        eachChild(bytes, entry.payloadStart, entry.payloadEnd, (field) => {
          if (field.id === ID_TRACK_TYPE) {
            track.type = readUint(bytes, field.payloadStart, field.payloadEnd);
          } else if (field.id === ID_CODEC_ID) {
            let raw = readString(bytes, field.payloadStart, field.payloadEnd);
            track.codec = raw ? (CODEC_NAMES[raw] ?? raw) : undefined;
          } else if (field.id === ID_DEFAULT_DURATION) {
            track.defaultDurationNs = readUint(
              bytes,
              field.payloadStart,
              field.payloadEnd,
            );
          } else if (field.id === ID_VIDEO) {
            eachChild(
              bytes,
              field.payloadStart,
              field.payloadEnd,
              (dimension) => {
                let value = readUint(
                  bytes,
                  dimension.payloadStart,
                  dimension.payloadEnd,
                );
                if (dimension.id === ID_PIXEL_WIDTH) {
                  track.pixelWidth = value;
                } else if (dimension.id === ID_PIXEL_HEIGHT) {
                  track.pixelHeight = value;
                } else if (dimension.id === ID_DISPLAY_WIDTH) {
                  track.displayWidth = value;
                } else if (dimension.id === ID_DISPLAY_HEIGHT) {
                  track.displayHeight = value;
                }
              },
            );
          }
        });
        tracks.push(track);
      });
    }
    // Clusters hold the frames; reaching one means the metadata is behind us.
  });

  let video = tracks.find((track) => track.type === TRACK_TYPE_VIDEO);
  let audio = tracks.find((track) => track.type === TRACK_TYPE_AUDIO);
  if (!video && !audio) {
    return undefined;
  }

  // Duration is in TimecodeScale units, which are nanoseconds by default.
  let durationSeconds =
    rawDuration === undefined
      ? undefined
      : Math.round(((rawDuration * timecodeScale) / 1_000_000_000) * 1000) /
        1000;

  // DefaultDuration is nanoseconds per frame, so its reciprocal is the rate.
  let frameRate =
    video?.defaultDurationNs && video.defaultDurationNs > 0
      ? Math.round((1_000_000_000 / video.defaultDurationNs) * 1000) / 1000
      : undefined;

  return prunedVideoEncoding({
    container: 'WebM',
    videoCodec: video?.codec,
    audioCodec: audio?.codec,
    // Display dimensions win where stated: anamorphic content stores a
    // different pixel grid than it is meant to be shown at.
    width: video?.displayWidth ?? video?.pixelWidth,
    height: video?.displayHeight ?? video?.pixelHeight,
    frameRate,
    durationSeconds,
    hasAudio: audio !== undefined,
    // Matroska expresses orientation through a projection element rather than a
    // matrix, and files in the wild rarely set it, so rotation is left unread
    // rather than defaulted to zero — which would claim knowledge.
  });
}

export function assertWebmContainer(bytes: Uint8Array): void {
  let head = readElement(bytes, 0, bytes.length);
  if (!head || head.id !== ID_EBML) {
    throw new FileContentMismatchError(
      'File does not begin with an EBML header',
    );
  }
}

// Exported for the Cluster id, which callers use to bound a head read: metadata
// precedes the first Cluster, so there is no reason to read past one.
export { ID_CLUSTER };
