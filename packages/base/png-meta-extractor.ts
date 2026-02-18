import { FileContentMismatchError } from './file-api';

// PNG 8-byte magic signature
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Minimum bytes needed: 8 (signature) + 8 (IHDR chunk header) + 8 (width + height)
const MIN_BYTES = 24;

function validatePngSignature(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new FileContentMismatchError(
      'File is too small to be a valid PNG image',
    );
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new FileContentMismatchError(
        'File does not have a valid PNG signature',
      );
    }
  }
}

export function extractPngDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validatePngSignature(bytes);

  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'PNG file is too small to contain IHDR chunk',
    );
  }

  // Width is at bytes 16-19, height at 20-23 (big-endian uint32)
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = view.getUint32(16);
  let height = view.getUint32(20);

  return { width, height };
}
