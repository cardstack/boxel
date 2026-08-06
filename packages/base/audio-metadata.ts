// The shapes every audio format's reader returns, so `MediaEncodingField` and
// `MediaTagsField` can be populated identically from an MP3 frame header, a WAV
// `fmt ` chunk, a FLAC STREAMINFO block, an Ogg identification header, or an
// MP4 sample entry.
//
// Each format's reader lives in that format's `*-meta-extractor` module beside
// the duration reader that already walks the same structures. This module holds
// only the vocabulary they agree on.
//
// Every property is optional and absence is meaningful: MP3 has no bit-depth
// concept at all, so `bitDepth` stays unset rather than being filled with a
// plausible 16 the file never carried.

// A slug from the shared `channel-mode` vocabulary. Wrapped into a CodedValue by
// the caller, so readers stay free of any knowledge of how the field is modeled.
export type ChannelMode =
  | 'mono'
  | 'stereo'
  | 'joint-stereo'
  | 'dual-mono'
  | 'surround';

export interface AudioEncoding {
  container?: string;
  audioCodec?: string;
  sampleRateHz?: number;
  // Bits per second for the whole stream where the container states it, or for
  // the sampled frame where that's all there is — `isVariableBitrate` is what
  // tells those apart.
  bitrateBps?: number;
  isVariableBitrate?: boolean;
  bitDepth?: number;
  channels?: number;
  channelMode?: ChannelMode;
}

// A slug from the shared `tag-scheme` vocabulary, naming which convention
// supplied the values below.
export type TagScheme = 'id3v2' | 'riff-info' | 'mp4-atoms' | 'vorbis-comment';

export interface MediaTags {
  scheme?: TagScheme;
  trackTitle?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  composer?: string;
  year?: number;
  // Kept as authored ("4/12") rather than split: the total is part of what the
  // file said, and coercing to a number would discard it.
  track?: string;
  disc?: string;
  genre?: string;
  comment?: string;
}

function pruned<T extends object>(candidate: T): T | undefined {
  let entries = Object.entries(candidate).filter(
    ([, value]) => value !== undefined && value !== '',
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

// Drop keys a format couldn't determine, so a reader that learned nothing adds
// no attribute at all rather than an empty object in the index row.
export function prunedEncoding(
  candidate: AudioEncoding,
): AudioEncoding | undefined {
  return pruned(candidate);
}

// As above, and additionally drops a tag block that carries only its `scheme`:
// knowing a file has an empty ID3v2 tag is not worth an index row.
export function prunedTags(candidate: MediaTags): MediaTags | undefined {
  let result = pruned(candidate);
  if (!result) {
    return undefined;
  }
  let keys = Object.keys(result);
  if (keys.length === 1 && keys[0] === 'scheme') {
    return undefined;
  }
  return result;
}

// A year can arrive as a bare "1997", a full "1997-06-03" date, or an ISO
// timestamp depending on the convention. Take the leading four digits and only
// when they land in a range a recording could plausibly carry — a "year" of 3
// or 20997 is a parse failure, not a date.
export function parseTagYear(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  let match = value.trim().match(/^(\d{4})/);
  if (!match) {
    return undefined;
  }
  let year = Number(match[1]);
  return year >= 1000 && year <= 9999 ? year : undefined;
}

// MPEG and MP4 state a channel count; only some formats also say how the
// channels relate. Where they don't, infer the obvious cases and leave anything
// richer unset rather than guessing at a surround layout.
export function channelModeForCount(
  channels: number | undefined,
): ChannelMode | undefined {
  if (channels === 1) {
    return 'mono';
  }
  if (channels === 2) {
    return 'stereo';
  }
  return channels !== undefined && channels > 2 ? 'surround' : undefined;
}
