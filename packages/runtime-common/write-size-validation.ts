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
//
// The media limits are a floor over the general one, never a cap: they exist
// to give media more room, so raising the general limit past them lifts media
// with it rather than singling media out for a smaller ceiling.
//
// Callers pass either a realm-local path or a full href. Query and fragment
// are trimmed so an href's `?`/`#` can't swallow the extension — a literal
// `?` or `#` in a filename arrives percent-encoded on every path that reaches
// here, since `RealmPaths.local` decodes with `decodeURI`, which leaves
// `%3F`/`%23` escaped.
export function fileSizeLimitFor(path: string, limits: FileSizeLimits): number {
  let contentType = inferContentType(path.split(/[?#]/)[0]);
  if (contentType.startsWith('audio/')) {
    return Math.max(limits.default, limits.audio);
  }
  if (contentType.startsWith('video/')) {
    return Math.max(limits.default, limits.video);
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
  validateByteLength(actualSize, maxSizeBytes, type);
}

// For callers that know a payload's byte length without holding its bytes —
// a picked file reports `size` before it is read — so the same limit can be
// enforced, and worded identically, without materializing the content.
export function validateByteLength(
  actualSize: number,
  maxSizeBytes: number,
  type: 'card' | 'file',
): void {
  if (actualSize > maxSizeBytes) {
    throw new Error(
      `${type === 'card' ? 'Card' : 'File'} size (${actualSize} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
    );
  }
}
