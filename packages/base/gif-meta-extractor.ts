import { FileContentMismatchError } from './file-api';

// GIF files start with either "GIF87a" or "GIF89a" (6 bytes)
const GIF87A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

// Minimum bytes needed: 6 (signature) + 4 (width + height)
const MIN_BYTES = 10;

function validateGifSignature(bytes: Uint8Array): void {
  if (bytes.length < 6) {
    throw new FileContentMismatchError(
      'File is too small to be a valid GIF image',
    );
  }

  let isGif87a = GIF87A_SIGNATURE.every((b, i) => bytes[i] === b);
  let isGif89a = GIF89A_SIGNATURE.every((b, i) => bytes[i] === b);

  if (!isGif87a && !isGif89a) {
    throw new FileContentMismatchError(
      'File does not have a valid GIF signature',
    );
  }
}

export function extractGifDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validateGifSignature(bytes);

  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'GIF file is too small to contain image dimensions',
    );
  }

  // Width is at bytes 6-7, height at 8-9 (little-endian uint16)
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = view.getUint16(6, true);
  let height = view.getUint16(8, true);

  return { width, height };
}
