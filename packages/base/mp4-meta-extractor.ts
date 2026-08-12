// MP4 and MOV video, read out of the ISO BMFF box tree.
//
// The container is the same one M4A uses — `iso-bmff` holds the shared walking —
// so this only knows about the boxes a video track puts there: the track header
// for dimensions and rotation, the media header for duration, the sample
// description for the codec, and the time-to-sample table for a frame rate.
//
// Everything comes out of `moov`, which is small. The bulk of a video file is
// `mdat`, and nothing here ever needs to look at it.

import { FileContentMismatchError } from './file-api';
import {
  BOX_HEADER_BYTES,
  MOOV,
  MVHD,
  descend,
  findChildBox,
  parseMvhd,
  readBoxAt,
  typeAt,
} from './iso-bmff';
import { prunedVideoEncoding, type VideoEncoding } from './video-metadata';

// A file can hold any number of tracks; this walks them rather than assuming the
// first is the picture.
const MAX_TRACKS = 64;

// Sample-entry four-character codes, which are how the container names its
// codec. Only the ones a realm realistically holds are named; anything else
// leaves the codec unset rather than guessed at.
const VIDEO_SAMPLE_ENTRY_CODECS: Record<string, string> = {
  avc1: 'H.264 (AVC)',
  avc3: 'H.264 (AVC)',
  hvc1: 'H.265 (HEVC)',
  hev1: 'H.265 (HEVC)',
  av01: 'AV1',
  vp09: 'VP9',
  mp4v: 'MPEG-4 Visual',
  // QuickTime-era codecs, still common in MOV files off older cameras.
  jpeg: 'Motion JPEG',
  ap4h: 'Apple ProRes 4444',
  apch: 'Apple ProRes 422 HQ',
  apcn: 'Apple ProRes 422',
};

const AUDIO_SAMPLE_ENTRY_CODECS: Record<string, string> = {
  mp4a: 'AAC',
  alac: 'ALAC (Apple Lossless)',
  'ac-3': 'Dolby Digital',
  'ec-3': 'Dolby Digital Plus',
  Opus: 'Opus',
  twos: 'PCM',
  sowt: 'PCM',
};

// A handler box names what kind of media a track carries.
const HANDLER_VIDEO = 'vide';
const HANDLER_AUDIO = 'soun';

interface TrackFacts {
  handler?: string;
  width?: number;
  height?: number;
  rotationDegrees?: number;
  codec?: string;
  durationSeconds?: number;
  frameRate?: number;
}

// The 3x3 display matrix in a track header, stored as 16.16 fixed point except
// for the last column. Only the rotation it encodes is of interest, and only the
// four right angles occur in practice — anything else is a shear or a flip that
// no player of ours would honor anyway.
function rotationFromMatrix(
  view: DataView,
  offset: number,
  end: number,
): number | undefined {
  if (offset + 36 > end) {
    return undefined;
  }
  // a and b are the first row; that pair alone determines the right angle.
  let a = view.getInt32(offset) / 65536;
  let b = view.getInt32(offset + 4) / 65536;
  if (a === 1 && b === 0) {
    return 0;
  }
  if (a === 0 && b === 1) {
    return 90;
  }
  if (a === -1 && b === 0) {
    return 180;
  }
  if (a === 0 && b === -1) {
    return 270;
  }
  return undefined;
}

// tkhd: version/flags, then times and an id, a reserved run, the layer and
// volume, the display matrix, and finally width and height as 16.16 fixed point.
function parseTkhd(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): { width?: number; height?: number; rotationDegrees?: number } {
  if (start + 4 > end) {
    return {};
  }
  let version = bytes[start]!;
  // The v1 layout widens the creation, modification, and duration fields.
  let afterTimes = version === 1 ? start + 4 + 32 : start + 4 + 20;
  // reserved(8) + layer(2) + alternate_group(2) + volume(2) + reserved(2)
  let matrixOffset = afterTimes + 16;
  let dimensionsOffset = matrixOffset + 36;
  if (dimensionsOffset + 8 > end) {
    return {};
  }
  let width = view.getUint32(dimensionsOffset) / 65536;
  let height = view.getUint32(dimensionsOffset + 4) / 65536;
  return {
    ...(width > 0 ? { width: Math.round(width) } : {}),
    ...(height > 0 ? { height: Math.round(height) } : {}),
    ...(() => {
      let rotation = rotationFromMatrix(view, matrixOffset, end);
      return rotation === undefined ? {} : { rotationDegrees: rotation };
    })(),
  };
}

// mdhd carries the track's own timescale and duration, which is what a frame
// rate has to be computed against — the movie timescale is a different unit.
function parseMdhd(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): { timescale: number; duration: number } | undefined {
  if (start + 4 > end) {
    return undefined;
  }
  let version = bytes[start]!;
  let cursor = start + 4;
  if (version === 1) {
    if (cursor + 28 > end) {
      return undefined;
    }
    let timescale = view.getUint32(cursor + 16);
    let duration =
      view.getUint32(cursor + 20) * 0x1_0000_0000 + view.getUint32(cursor + 24);
    return timescale > 0 ? { timescale, duration } : undefined;
  }
  if (cursor + 16 > end) {
    return undefined;
  }
  let timescale = view.getUint32(cursor + 8);
  let duration = view.getUint32(cursor + 12);
  return timescale > 0 ? { timescale, duration } : undefined;
}

// stts maps runs of samples to their durations. Summing the run counts gives the
// frame count, which against the media duration gives the real average frame
// rate — including for the variable-rate files phones produce, where any single
// sample's duration would be misleading.
function frameCountFromStts(
  view: DataView,
  start: number,
  end: number,
): number | undefined {
  // version/flags(4) + entry_count(4)
  if (start + 8 > end) {
    return undefined;
  }
  let entryCount = view.getUint32(start + 4);
  let cursor = start + 8;
  let frames = 0;
  for (let entry = 0; entry < entryCount; entry++) {
    if (cursor + 8 > end) {
      return frames > 0 ? frames : undefined;
    }
    frames += view.getUint32(cursor);
    cursor += 8;
  }
  return frames > 0 ? frames : undefined;
}

function readTrack(
  bytes: Uint8Array,
  view: DataView,
  trackStart: number,
  trackEnd: number,
): TrackFacts {
  let facts: TrackFacts = {};

  let hdlr = descend(bytes, view, trackStart, trackEnd, ['mdia', 'hdlr']);
  if (hdlr) {
    // hdlr: version/flags(4) + pre_defined(4) + handler_type(4)
    if (hdlr.payloadOffset + 12 <= hdlr.payloadEnd) {
      facts.handler = typeAt(bytes, hdlr.payloadOffset + 8);
    }
  }

  let tkhd = descend(bytes, view, trackStart, trackEnd, ['tkhd']);
  if (tkhd) {
    Object.assign(
      facts,
      parseTkhd(bytes, view, tkhd.payloadOffset, tkhd.payloadEnd),
    );
  }

  let mdhd = descend(bytes, view, trackStart, trackEnd, ['mdia', 'mdhd']);
  let media = mdhd
    ? parseMdhd(bytes, view, mdhd.payloadOffset, mdhd.payloadEnd)
    : undefined;
  if (media) {
    facts.durationSeconds = media.duration / media.timescale;
  }

  let stsd = descend(bytes, view, trackStart, trackEnd, [
    'mdia',
    'minf',
    'stbl',
    'stsd',
  ]);
  if (stsd) {
    // stsd is a full box: version/flags(4) + entry_count(4) precede the entries.
    try {
      let entry = readBoxAt(
        bytes,
        view,
        stsd.payloadOffset + 8,
        stsd.payloadEnd,
      );
      if (entry) {
        facts.codec =
          facts.handler === HANDLER_AUDIO
            ? AUDIO_SAMPLE_ENTRY_CODECS[entry.type]
            : VIDEO_SAMPLE_ENTRY_CODECS[entry.type];
      }
    } catch {
      // A malformed sample description costs the codec name, nothing else.
    }
  }

  let stts = descend(bytes, view, trackStart, trackEnd, [
    'mdia',
    'minf',
    'stbl',
    'stts',
  ]);
  if (stts && media && facts.durationSeconds && facts.durationSeconds > 0) {
    let frames = frameCountFromStts(view, stts.payloadOffset, stts.payloadEnd);
    if (frames !== undefined) {
      facts.frameRate =
        Math.round((frames / facts.durationSeconds) * 1000) / 1000;
    }
  }

  return facts;
}

// Read every track in a `moov` box. Callers pass either a whole file or the lone
// `moov` the streaming walk retained — both work, because the box search starts
// from offset zero either way.
export function extractMp4VideoEncoding(
  bytes: Uint8Array,
  container = 'MP4',
): VideoEncoding | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let moov: ReturnType<typeof findChildBox>;
  try {
    moov = findChildBox(bytes, view, 0, bytes.length, MOOV);
  } catch {
    return undefined;
  }
  if (!moov) {
    return undefined;
  }

  let video: TrackFacts | undefined;
  let audio: TrackFacts | undefined;
  let offset = moov.payloadOffset;
  for (let index = 0; index < MAX_TRACKS && offset < moov.payloadEnd; index++) {
    let box: ReturnType<typeof readBoxAt>;
    try {
      box = readBoxAt(bytes, view, offset, moov.payloadEnd);
    } catch {
      break;
    }
    if (!box) {
      break;
    }
    if (box.type === 'trak') {
      let facts = readTrack(bytes, view, box.payloadOffset, box.payloadEnd);
      // A file can carry several of each; the first of a kind is the one a
      // player picks by default.
      if (facts.handler === HANDLER_VIDEO && !video) {
        video = facts;
      } else if (facts.handler === HANDLER_AUDIO && !audio) {
        audio = facts;
      }
    }
    offset = box.nextBoxOffset;
  }

  if (!video && !audio) {
    return undefined;
  }

  // Overall duration comes from mvhd, which spans every track — a video whose
  // audio runs slightly longer should report the longer figure.
  let durationSeconds: number | undefined;
  let mvhd = findChildBox(
    bytes,
    view,
    moov.payloadOffset,
    moov.payloadEnd,
    MVHD,
  );
  if (mvhd) {
    try {
      let { timescale, duration } = parseMvhd(bytes, view, mvhd);
      if (timescale > 0) {
        durationSeconds = duration / timescale;
      }
    } catch {
      // Fall through to the track's own duration.
    }
  }
  durationSeconds ??= video?.durationSeconds ?? audio?.durationSeconds;

  return prunedVideoEncoding({
    container,
    videoCodec: video?.codec,
    audioCodec: audio?.codec,
    width: video?.width,
    height: video?.height,
    frameRate: video?.frameRate,
    rotationDegrees: video?.rotationDegrees,
    durationSeconds:
      durationSeconds === undefined
        ? undefined
        : Math.round(durationSeconds * 1000) / 1000,
    hasAudio: audio !== undefined,
  });
}

// Reject anything that isn't an ISO BMFF container at all, so the extractor can
// fall back to the base FileDef rather than stamping a video type on it.
export function assertMp4Container(bytes: Uint8Array): void {
  if (bytes.length < BOX_HEADER_BYTES + 4) {
    throw new FileContentMismatchError(
      'File is too small to be a valid MP4 container',
    );
  }
  // The first box of an MP4 or MOV is `ftyp`; older QuickTime files can lead
  // with `moov` or `mdat` instead.
  let first = typeAt(bytes, 4);
  if (first !== 'ftyp' && first !== 'moov' && first !== 'mdat') {
    throw new FileContentMismatchError(
      `File does not begin with an ISO BMFF box (found "${first}")`,
    );
  }
}
