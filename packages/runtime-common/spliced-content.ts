import type { LocalPath } from './paths.ts';

// ============================================================================
// A file's content, described rather than held.
//
// Some files are large enough that reading one is the cost to avoid: a card
// whose `containsMany` field is an event log holds as many items as it has
// ever recorded, and adding one more to it should not mean holding the other
// hundred thousand. So a change to such a file is expressed as a
// `SplicedSource` — a list of segments, each either a byte range of the file
// as it stands or a short run of new text — and the writer streams the ranges
// through rather than materializing them. Nothing here holds more than the new
// text: the ranges are numbers.
//
// A description composes: splicing into one yields another, which is how two
// changes to the same file in one batch both land instead of the second
// replacing the first.
//
// The destination of such a write is also its source, so an adapter writing
// one cannot read and write the path at once — `RealmAdapter.writeSpliced` is
// where that is resolved, and it is the reason this is a description a writer
// is handed rather than a stream a caller opens.
// ============================================================================

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// The spliced result
// ---------------------------------------------------------------------------

// A byte range of the stored file, `[start, end)`.
export interface FileSegment {
  kind: 'file';
  start: number;
  end: number;
}

export interface TextSegment {
  kind: 'text';
  bytes: Uint8Array;
}

export type SpliceSegment = FileSegment | TextSegment;

// One file's post-edit content, described rather than materialized. A caller
// streams it (`streamSpliced`) or splices into it again — an append that
// follows another append to the same card in the same batch is the second
// case, and composing the two is what makes both changes land instead of the
// second replacing the first.
export interface SplicedSource {
  // The stored file every `file` segment reads from.
  path: LocalPath;
  segments: SpliceSegment[];
  // The byte length of the result, which is what a size ceiling is applied to
  // and what a content fingerprint is computed against. Arithmetic over the
  // segments: nothing is read to know it.
  size: number;
}

// An insertion, at an offset into the content being edited — the stored file
// for a first splice, the previous result for one composed on top of it.
export interface SpliceEdit {
  at: number;
  text: string;
}

export function isSplicedSource(value: unknown): value is SplicedSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as SplicedSource).segments)
  );
}

// The whole file, unedited: the starting point a first splice edits.
export function wholeFile(path: LocalPath, size: number): SplicedSource {
  return {
    path,
    segments: size > 0 ? [{ kind: 'file', start: 0, end: size }] : [],
    size,
  };
}

// Content already in hand, as a source to splice into. What an append stages
// from when an earlier entry in the batch produced this card's bytes whole —
// the string is already held, so reading it costs nothing and refusing to
// compose over it would cost the earlier entry's change.
export function wholeText(path: LocalPath, text: string): SplicedSource {
  let bytes = encoder.encode(text);
  return {
    path,
    segments: bytes.length > 0 ? [{ kind: 'text', bytes }] : [],
    size: bytes.length,
  };
}

// Apply insertions to a described content, yielding the described result.
//
// Offsets address the content as the caller sees it — which for a composed
// splice is the previous result, text runs included — so a caller splices into
// what it scanned without holding a second coordinate system. Two edits at one
// offset land in the order they were given, which is what lets "open this
// container and close it again" be described as a pair of insertions at one
// point rather than as an interaction to reason about.
export function splice(
  source: SplicedSource,
  edits: SpliceEdit[],
): SplicedSource {
  if (edits.length === 0) {
    return source;
  }
  let ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => a.edit.at - b.edit.at || a.index - b.index)
    .map(({ edit }) => edit);
  let segments: SpliceSegment[] = [];
  let cursor = 0;
  let consumed = 0;
  let added = 0;

  let emitEditsAt = (offset: number) => {
    while (cursor < ordered.length && ordered[cursor].at === offset) {
      let bytes = encoder.encode(ordered[cursor].text);
      segments.push({ kind: 'text', bytes });
      added += bytes.length;
      cursor++;
    }
  };
  let pushSlice = (segment: SpliceSegment, from: number, to: number) => {
    if (to <= from) {
      return;
    }
    segments.push(
      segment.kind === 'text'
        ? { kind: 'text', bytes: segment.bytes.subarray(from, to) }
        : {
            kind: 'file',
            start: segment.start + from,
            end: segment.start + to,
          },
    );
  };

  emitEditsAt(0);
  for (let segment of source.segments) {
    let length =
      segment.kind === 'text'
        ? segment.bytes.length
        : segment.end - segment.start;
    let cut = 0;
    while (
      cursor < ordered.length &&
      ordered[cursor].at > consumed &&
      ordered[cursor].at < consumed + length
    ) {
      let local = ordered[cursor].at - consumed;
      pushSlice(segment, cut, local);
      cut = local;
      emitEditsAt(consumed + local);
    }
    pushSlice(segment, cut, length);
    consumed += length;
    emitEditsAt(consumed);
  }
  // An edit past the end of the content. A caller that measured the content it
  // scanned cannot produce one, so this covers a caller that did not.
  while (cursor < ordered.length) {
    let bytes = encoder.encode(ordered[cursor].text);
    segments.push({ kind: 'text', bytes });
    added += bytes.length;
    cursor++;
  }
  return { path: source.path, segments, size: source.size + added };
}

// The described content, as bytes. `readRange` reads `[start, end)` of the
// stored file — a bounded read per segment, so the peak here is one chunk
// rather than one file.
export async function* streamSpliced(
  source: SplicedSource,
  readRange: (start: number, end: number) => AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  for (let segment of source.segments) {
    if (segment.kind === 'text') {
      yield segment.bytes;
      continue;
    }
    if (segment.end <= segment.start) {
      continue;
    }
    for await (let chunk of readRange(segment.start, segment.end)) {
      yield chunk;
    }
  }
}
