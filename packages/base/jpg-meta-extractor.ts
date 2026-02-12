import { FileContentMismatchError } from './file-api';

// JPEG files start with SOI marker: FF D8
const JPEG_SOI = new Uint8Array([0xff, 0xd8]);

// Minimum bytes: 2 (SOI) + 2 (marker) + 2 (length) + 5 (precision + height + width)
const MIN_BYTES = 11;

// SOF markers that contain image dimensions
const SOF_MARKERS = new Set([
  0xc0, // SOF0 — Baseline DCT
  0xc1, // SOF1 — Extended Sequential DCT
  0xc2, // SOF2 — Progressive DCT
  0xc3, // SOF3 — Lossless (Sequential)
  0xc5, // SOF5 — Differential Sequential DCT
  0xc6, // SOF6 — Differential Progressive DCT
  0xc7, // SOF7 — Differential Lossless (Sequential)
  0xc9, // SOF9 — Extended Sequential DCT (Arithmetic)
  0xca, // SOF10 — Progressive DCT (Arithmetic)
  0xcb, // SOF11 — Lossless (Sequential) (Arithmetic)
  0xcd, // SOF13 — Differential Sequential DCT (Arithmetic)
  0xce, // SOF14 — Differential Progressive DCT (Arithmetic)
  0xcf, // SOF15 — Differential Lossless (Arithmetic)
]);

function validateJpegSignature(bytes: Uint8Array): void {
  if (bytes.length < JPEG_SOI.length) {
    throw new FileContentMismatchError(
      'File is too small to be a valid JPEG image',
    );
  }
  if (bytes[0] !== JPEG_SOI[0] || bytes[1] !== JPEG_SOI[1]) {
    throw new FileContentMismatchError(
      'File does not have a valid JPEG signature',
    );
  }
}

export function extractJpgDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validateJpegSignature(bytes);

  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'JPEG file is too small to contain frame dimensions',
    );
  }

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Scan for SOF marker starting after SOI (offset 2)
  let offset = 2;
  while (offset < bytes.length - 1) {
    // Each marker starts with 0xFF
    if (bytes[offset] !== 0xff) {
      throw new FileContentMismatchError(
        'JPEG file has invalid marker structure',
      );
    }

    // Skip padding 0xFF bytes
    while (offset < bytes.length - 1 && bytes[offset + 1] === 0xff) {
      offset++;
    }

    let marker = bytes[offset + 1]!;
    offset += 2;

    // SOS (Start of Scan) — no more markers with length fields follow
    if (marker === 0xda) {
      break;
    }

    // Markers without a length field (standalone markers)
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    // Read segment length (includes the 2 length bytes but not the marker)
    if (offset + 2 > bytes.length) {
      break;
    }
    let segmentLength = view.getUint16(offset);

    if (SOF_MARKERS.has(marker)) {
      // SOF segment layout after length:
      //   1 byte  — precision
      //   2 bytes — height (big-endian)
      //   2 bytes — width  (big-endian)
      if (offset + 2 + 5 > bytes.length) {
        throw new FileContentMismatchError(
          'JPEG SOF segment is truncated',
        );
      }
      let height = view.getUint16(offset + 2 + 1);
      let width = view.getUint16(offset + 2 + 3);
      return { width, height };
    }

    // Skip to next marker
    offset += segmentLength;
  }

  throw new FileContentMismatchError(
    'JPEG file does not contain a SOF marker with image dimensions',
  );
}
