import { md5 } from 'super-fast-md5';

const textEncoder = new TextEncoder();

// Content at or below this size is hashed whole. Above it, the hash samples
// the head and tail instead — see `computeContentHash`.
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

// A content fingerprint used to tell one file's bytes from another's: it keys
// the upload dedupe cache, decides whether a thumbnail still matches the file
// it was rendered from, and serves as a source ETag.
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
// cards, images, anything the source cache ETags — keeps exactly the md5 it
// has always had, and only files large enough to be expensive change shape.
export function computeContentHash(content: string | Uint8Array): string {
  let bytes: Uint8Array;
  try {
    bytes = toBytes(content);
  } catch {
    try {
      return md5(String(content));
    } catch {
      throw new Error('Failed to compute content hash');
    }
  }
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
