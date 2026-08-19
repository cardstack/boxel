// Header-only STL sniffer. Reads just enough to (a) confirm the bytes really are
// STL geometry and (b) surface the cheap descriptive facts that live in the
// file's head — it never scans the facet body. Binary STL carries its facet
// count and an optional COLOR= tag in the fixed 84-byte header; ASCII STL
// carries its solid name on the first line. The physical bounding box is
// intentionally NOT computed here: it requires walking every facet, and the
// live client-side viewer already derives true (transform-correct) dimensions
// from the geometry it loads, so index-time never pays for the scan. Pure JS
// (DataView/TextDecoder), kept in a plain `.ts` module (mirroring
// `png-meta-extractor.ts`) so it is directly unit-testable. Returns `undefined`
// for anything that isn't STL; the calling FileDef turns that into a
// `FileContentMismatchError` so the extractor falls back to the base FileDef.

export interface StlMetadata {
  encoding: string;
  solidName?: string;
  binaryHeader?: string;
  // Present for binary STL (read straight from the header's uint32). Absent for
  // ASCII STL, where a count would require scanning the whole facet body.
  facetCount?: number;
  hasColorData: boolean;
}

// How many bytes off the top we decode to sniff an ASCII STL. The `solid` line
// and the first `facet normal` always sit at the very start, so a small prefix
// is enough to both validate and read the solid name.
const ASCII_SNIFF_BYTES = 4096;

// Turn the raw 80-byte binary header into a readable string: keep printable
// ASCII, collapse control/hi bytes to spaces, trim. Empty → undefined.
function decodeBinaryHeader(bytes: Uint8Array): string | undefined {
  return (
    new TextDecoder('latin1')
      .decode(bytes.subarray(0, 80))
      .split('')
      .map((character) => {
        let code = character.charCodeAt(0);
        return code < 32 || code > 126 ? ' ' : character;
      })
      .join('')
      .trim() || undefined
  );
}

export function parseStl(
  buf: ArrayBuffer,
): { stlMetadata: StlMetadata } | undefined {
  let bytes = new Uint8Array(buf);
  let view = new DataView(buf);

  // Binary detection first: a binary STL is exactly 84 + 50 × facetCount bytes
  // (some writers append trailing data, hence `<=`). This must precede the
  // ASCII check because a binary header can itself begin with the word "solid".
  let declaredBinaryFacets = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  let isBinary =
    declaredBinaryFacets > 0 && 84 + declaredBinaryFacets * 50 <= bytes.length;

  if (isBinary) {
    let binaryHeader = decodeBinaryHeader(bytes);
    return {
      stlMetadata: {
        encoding: 'binary',
        binaryHeader,
        facetCount: declaredBinaryFacets,
        // Materialise/other writers flag per-vertex color in the header; the
        // reliable, header-only signal is a COLOR= token. (The per-facet
        // attribute-byte heuristic needed a full scan and over-reported, so
        // it's dropped.)
        hasColorData: /COLOR=/i.test(binaryHeader ?? ''),
      },
    };
  }

  // ASCII STL: validate against a small prefix (the `solid` keyword plus the
  // first `facet normal`, which always appear at the top) and read the solid
  // name from the first line.
  let head = new TextDecoder().decode(
    bytes.subarray(0, Math.min(bytes.length, ASCII_SNIFF_BYTES)),
  );
  if (!/^\s*solid\b/i.test(head) || !/\bfacet\s+normal\b/i.test(head)) {
    return undefined;
  }
  let solidName =
    head.match(/^\s*solid(?:\s+([^\r\n]+))?/i)?.[1]?.trim() || undefined;
  return {
    stlMetadata: {
      encoding: 'ASCII',
      solidName,
      hasColorData: false,
    },
  };
}
