import { inferContentType } from './infer-content-type.ts';

const textEncoder = new TextEncoder();

export interface FileSizeLimits {
  // Applies to every file that is not audio or video.
  default: number;
  audio: number;
  video: number;
}

// Which ceiling a file write is held to depends on what kind of file it is:
// media assets are legitimately much larger than source, images, and
// documents, so they get their own limits. The kind is read off the path's
// extension via the same content-type inference the realm serves the file
// with, so `.ts` resolves to TypeScript rather than the MPEG transport
// stream that a bare mime-types lookup would return.
export function fileSizeLimitFor(path: string, limits: FileSizeLimits): number {
  let contentType = inferContentType(path.split(/[?#]/)[0]);
  if (contentType.startsWith('audio/')) {
    return limits.audio;
  }
  if (contentType.startsWith('video/')) {
    return limits.video;
  }
  return limits.default;
}

export function validateWriteSize(
  content: string | Uint8Array,
  maxSizeBytes: number,
  type: 'card' | 'file',
): void {
  const actualSize =
    content instanceof Uint8Array
      ? content.length
      : textEncoder.encode(content).length;
  if (actualSize > maxSizeBytes) {
    throw new Error(
      `${type === 'card' ? 'Card' : 'File'} size (${actualSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
    );
  }
}
