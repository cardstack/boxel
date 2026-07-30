import { FileContentMismatchError } from './file-api';

// Binary STL layout: an 80-byte header, a little-endian uint32 triangle count,
// then 50 bytes per triangle (12 floats for the normal + 3 vertices = 48 bytes,
// plus a 2-byte attribute field). So the whole file is exactly
// `84 + 50 * triangleCount` bytes.
const BINARY_HEADER_BYTES = 84; // 80-byte header + 4-byte triangle count
const BYTES_PER_TRIANGLE = 50;

// Read enough of the head to (a) read the binary triangle count at offset 80 and
// (b) capture the ASCII `solid <name>` line past any leading whitespace. STL
// solid names are short in practice; 256 bytes is generous and still a bounded,
// index-path-cheap read.
export const STL_SNIFF_BYTES = 256;

export type StlFormat = 'binary' | 'ascii';

// The cheap, header-only facts. Everything here is derivable without walking the
// mesh, so it is safe to compute on the indexing hot path. Expensive,
// full-mesh-parse facts (bounding box, per-facet counts, colour) are computed
// lazily in the 3D viewer instead — never here.
export interface StlMetadata {
  format: StlFormat;
  // Only known cheaply for binary STL (the header's uint32). ASCII requires a
  // full-file `facet` scan, so it is left undefined and filled by the viewer.
  triangleCount?: number;
  // ASCII STL only: the `solid <name>` label. Binary STL has no structured name
  // (its 80-byte header is freeform), so it is left undefined.
  solidName?: string;
}

// ASCII STL always opens with the token `solid` (after optional leading
// whitespace). A binary header can *also* begin with the bytes "solid", so the
// prefix check alone can't prove ASCII — the binary size identity below is the
// authoritative discriminator and is tried first.
const ASCII_SOLID_RE = /^\s*solid\b/i;
// Capture the solid name on the same line as the opening `solid` token.
const ASCII_SOLID_NAME_RE = /^\s*solid[ \t]+([^\r\n]+)/i;

// Classify an STL as binary or ASCII from its first bytes plus its total size,
// and pull the cheap header facts.
//
// `bytes` need only cover the first `STL_SNIFF_BYTES` — the caller bounds the
// read so an arbitrarily large mesh never enters the extract window.
// `contentSize` is the file's exact byte length (from the base FileDef extract).
//
// Throws `FileContentMismatchError` when the bytes are neither a size-consistent
// binary STL nor an ASCII `solid …` document, so a mislabeled or truncated file
// falls back to a bare `FileDef` rather than erroring the index row.
export function extractStlMetadata(
  bytes: Uint8Array,
  contentSize: number,
): StlMetadata {
  if (bytes.length >= BINARY_HEADER_BYTES) {
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let triangleCount = view.getUint32(80, /* littleEndian */ true);
    if (
      BINARY_HEADER_BYTES + BYTES_PER_TRIANGLE * triangleCount ===
      contentSize
    ) {
      return { format: 'binary', triangleCount };
    }
  }

  let head = new TextDecoder().decode(bytes.subarray(0, STL_SNIFF_BYTES));
  if (ASCII_SOLID_RE.test(head)) {
    let solidName = ASCII_SOLID_NAME_RE.exec(head)?.[1]?.trim() || undefined;
    return { format: 'ascii', solidName };
  }

  throw new FileContentMismatchError(
    'File is not a valid STL: binary size does not match the header triangle count and the content has no ASCII "solid" header',
  );
}
