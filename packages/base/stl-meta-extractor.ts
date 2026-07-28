import { FileContentMismatchError } from './file-api';

// Binary STL layout: an 80-byte header, a little-endian uint32 triangle count,
// then 50 bytes per triangle (12 floats for the normal + 3 vertices = 48 bytes,
// plus a 2-byte attribute field). So the whole file is exactly
// `84 + 50 * triangleCount` bytes.
const BINARY_HEADER_BYTES = 84; // 80-byte header + 4-byte triangle count
const BYTES_PER_TRIANGLE = 50;

// Enough of the head to read the binary triangle count and to see the ASCII
// `solid` token past any leading whitespace.
export const STL_SNIFF_BYTES = BINARY_HEADER_BYTES;

export type StlFormat = 'binary' | 'ascii';

// ASCII STL always opens with the token `solid` (after optional leading
// whitespace). A binary header can *also* begin with the bytes "solid", so the
// prefix check alone can't prove ASCII — the binary size identity below is the
// authoritative discriminator and is tried first.
const ASCII_SOLID_RE = /^\s*solid\b/i;

// Classify an STL as binary or ASCII from its first bytes plus its total size.
//
// `bytes` need only cover the first `STL_SNIFF_BYTES` — the caller bounds the
// read so an arbitrarily large mesh never enters the extract window.
// `contentSize` is the file's exact byte length (from the base FileDef extract).
//
// Throws `FileContentMismatchError` when the bytes are neither a size-consistent
// binary STL nor an ASCII `solid …` document, so a mislabeled or truncated file
// falls back to a bare `FileDef` rather than erroring the index row.
export function extractStlFormat(
  bytes: Uint8Array,
  contentSize: number,
): { format: StlFormat } {
  if (bytes.length >= BINARY_HEADER_BYTES) {
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let triangleCount = view.getUint32(80, /* littleEndian */ true);
    if (
      BINARY_HEADER_BYTES + BYTES_PER_TRIANGLE * triangleCount ===
      contentSize
    ) {
      return { format: 'binary' };
    }
  }

  let head = new TextDecoder().decode(bytes.subarray(0, BINARY_HEADER_BYTES));
  if (ASCII_SOLID_RE.test(head)) {
    return { format: 'ascii' };
  }

  throw new FileContentMismatchError(
    'File is not a valid STL: binary size does not match the header triangle count and the content has no ASCII "solid" header',
  );
}
