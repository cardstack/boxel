import { md5 } from 'super-fast-md5';

const textEncoder = new TextEncoder();

// Content at or below this size is hashed whole. Above it, the hash samples
// the head and tail instead — see `computeContentHash`.
//
// Invariant: HEAD + TAIL === WHOLE_LIMIT. This is what makes the unhashed
// middle open at zero width exactly at the threshold and widen from there,
// instead of a file a byte over the limit suddenly carrying a large hole. It
// also means the sampled path never costs more than the whole path did at the
// threshold, so there is no cost cliff in either direction. Retuning any of
// the three has to preserve it.
export const CONTENT_HASH_WHOLE_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB
export const CONTENT_HASH_HEAD_BYTES = 4 * 1024 * 1024; // 4 MB
export const CONTENT_HASH_TAIL_BYTES = 1 * 1024 * 1024; // 1 MB

// Marks a hash as sampled rather than whole, and carries a version so the
// sampling shape can change later without a new value comparing equal to an
// old one. A whole-content hash is a bare md5 and never starts with this.
const SAMPLED_MARKER = 's1';

function toBytes(content: string | Uint8Array): Uint8Array {
  return content instanceof Uint8Array ? content : textEncoder.encode(content);
}

// A content fingerprint used to tell one file's bytes from another's. Its
// consumers do not tolerate a false equality equally, so each one states how it
// treats a sampled value:
//   - upload dedupe (`FileDefManager`): refuses sampled values outright — a
//     false match there would attach content the user never picked.
//   - source ETag (`totalEtagBase` in realm.ts): joins a sampled value with the
//     file's mtime, restoring a total identity before it can drive a 304.
//   - thumbnail freshness (`file-view-model`): accepts sampled values; a false
//     match is a cosmetically stale thumbnail.
//
// md5 is linear in content length and runs synchronously on the main thread,
// so hashing whole files makes a single large write a multi-hundred-millisecond
// stall. Above `CONTENT_HASH_WHOLE_LIMIT_BYTES` the fingerprint is sampled
// instead: the byte length plus a hash of the head and a hash of the tail, for
// a fixed cost no matter how large the file is. Two files collide only by
// matching on all three, which the whole-content hash of a same-length file
// with identical ends would not have distinguished cheaply either.
//
// Content at or below the limit is hashed whole, so the common case — source,
// cards, and images, each held under a ceiling at or below this limit — keeps
// exactly the md5 it has always had, and only files large enough to be
// expensive change shape.
export function computeContentHash(content: string | Uint8Array): string {
  // No fallback to hashing `content` directly on an encode failure: the only
  // way to reach that is an allocation failure encoding a string, and hashing
  // the string whole would be the unbounded synchronous stall this function
  // exists to bound — in the error path, and under a marker-less value that
  // would read as a whole-content identity.
  let bytes = toBytes(content);
  if (bytes.length <= CONTENT_HASH_WHOLE_LIMIT_BYTES) {
    return md5(bytes);
  }
  // subarray shares the underlying buffer without copying, and md5 honors a
  // view's offset and length rather than reading the whole buffer.
  let head = md5(bytes.subarray(0, CONTENT_HASH_HEAD_BYTES));
  let tail = md5(bytes.subarray(bytes.length - CONTENT_HASH_TAIL_BYTES));
  return `${SAMPLED_MARKER}:${bytes.length}:${head}:${tail}`;
}

// True when a fingerprint samples the content rather than covering all of it.
// Callers that present a hash to a person can use this to say so.
export function isSampledContentHash(contentHash: string): boolean {
  return contentHash.startsWith(`${SAMPLED_MARKER}:`);
}
