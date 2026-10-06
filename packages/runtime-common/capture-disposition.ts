// How a served capture presents itself to the browser that saves it: the
// `Content-Disposition` a `_capture/` response carries, and the two URL
// params that steer it. Both params shape the response headers only — they
// address nothing, so the serving route strips them before its capture-spec
// parse and they never enter a capture's identity or ledger key. A signed
// capture URL binds every non-token param, so a token minted for a URL that
// carries them verifies against exactly that URL.

// `download` asks for `attachment` disposition (save, don't display).
// Present with no value, or with `1`/`true`, it is on; `0`/`false` is off.
export const CAPTURE_DOWNLOAD_PARAM = 'download';
// `filename` names the saved file, overriding the declared or default name.
export const CAPTURE_FILENAME_PARAM = 'filename';

export const CAPTURE_DISPOSITION_PARAMS: readonly string[] = [
  CAPTURE_DOWNLOAD_PARAM,
  CAPTURE_FILENAME_PARAM,
];

// The longest filename stem (before the extension) a served capture carries.
// Generous for a human-readable name, and well inside every mainstream
// filesystem's 255-byte component limit once UTF-8 encoded.
export const CAPTURE_FILENAME_MAX_LENGTH = 120;

export interface CaptureDisposition {
  attachment: boolean;
  // The caller's requested name, unsanitized; `captureContentDisposition`
  // sanitizes whatever it is handed.
  filename?: string;
}

export type CaptureDispositionParse =
  | { disposition: CaptureDisposition }
  | { error: { field: string; message: string } };

// Reads and removes the disposition params from `searchParams`, so what
// remains is purely the capture's addressing. Each may be given once; a
// repeated param is refused rather than resolved by position.
export function takeCaptureDispositionParams(
  searchParams: URLSearchParams,
): CaptureDispositionParse {
  for (let key of CAPTURE_DISPOSITION_PARAMS) {
    if (searchParams.getAll(key).length > 1) {
      return {
        error: { field: key, message: `${key} may only be given once` },
      };
    }
  }
  let download = searchParams.get(CAPTURE_DOWNLOAD_PARAM);
  let filename = searchParams.get(CAPTURE_FILENAME_PARAM);
  for (let key of CAPTURE_DISPOSITION_PARAMS) {
    searchParams.delete(key);
  }
  let attachment = false;
  if (download !== null) {
    let value = download.trim().toLowerCase();
    if (value === '' || value === '1' || value === 'true') {
      attachment = true;
    } else if (value !== '0' && value !== 'false') {
      return {
        error: {
          field: CAPTURE_DOWNLOAD_PARAM,
          message: `${CAPTURE_DOWNLOAD_PARAM} must be "1", "true", "0", or "false"`,
        },
      };
    }
  }
  return {
    disposition: {
      attachment,
      ...(filename !== null ? { filename } : {}),
    },
  };
}

// The file extension a capture of `contentType` saves under, or undefined for
// a type a capture never serves.
export function captureFileExtension(contentType: string): string | undefined {
  switch (contentType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return undefined;
  }
}

// A requested filename reduced to one safe path component: control
// characters (CR/LF included) and path separators gone, whitespace collapsed,
// leading dots dropped, the stem capped at CAPTURE_FILENAME_MAX_LENGTH code
// points, and `.extension` ensured. Non-ASCII survives — the header carries it
// through `filename*`. Undefined when nothing usable remains.
export function sanitizeCaptureFilename(
  raw: string,
  extension: string,
): string | undefined {
  let suffix = `.${extension}`;
  let stem = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (stem.toLowerCase().endsWith(suffix)) {
    stem = stem.slice(0, -suffix.length).trimEnd();
  }
  stem = stem.replace(/^[.\s]+/, '');
  let codePoints = [...stem];
  if (codePoints.length > CAPTURE_FILENAME_MAX_LENGTH) {
    stem = codePoints.slice(0, CAPTURE_FILENAME_MAX_LENGTH).join('').trimEnd();
  }
  if (!stem) {
    return undefined;
  }
  return `${stem}${suffix}`;
}

// The `Content-Disposition` header value for a served capture (RFC 6266).
// `filename` is the quoted ASCII fallback every client reads: accents fold to
// their base letters, and anything else outside printable ASCII — or a quote,
// backslash, or percent sign, which clients disagree on inside a quoted
// string — becomes `_`. Whenever that fallback differs from the real name,
// `filename*` carries the exact UTF-8 name (RFC 8187), which every current
// browser prefers.
export function captureContentDisposition({
  attachment,
  filename,
}: {
  attachment: boolean;
  filename: string;
}): string {
  let type = attachment ? 'attachment' : 'inline';
  let fallback = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]|["\\%]/g, '_');
  let header = `${type}; filename="${fallback}"`;
  if (fallback !== filename) {
    header += `; filename*=UTF-8''${encodeRFC8187(filename)}`;
  }
  return header;
}

// RFC 8187 `value-chars`: `encodeURIComponent` leaves `'()*!` unescaped, and
// the first three are not attr-chars.
function encodeRFC8187(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// `url` with the disposition params set: `download=1` when `attachment`, and
// `filename` when one is given (an empty or whitespace-only name is left
// off). Any disposition params already on the URL are replaced.
export function captureDispositionURL(
  url: string,
  { attachment, filename }: { attachment: boolean; filename?: string | null },
): string {
  let target = new URL(url);
  for (let key of CAPTURE_DISPOSITION_PARAMS) {
    target.searchParams.delete(key);
  }
  if (attachment) {
    target.searchParams.set(CAPTURE_DOWNLOAD_PARAM, '1');
  }
  if (filename?.trim()) {
    target.searchParams.set(CAPTURE_FILENAME_PARAM, filename.trim());
  }
  return target.href;
}

// The filename a `Content-Disposition` header names: the RFC 8187
// `filename*` when present and decodable, else the quoted or bare
// `filename`. Undefined when the header names none.
export function filenameFromContentDisposition(
  header: string | null | undefined,
): string | undefined {
  if (!header) {
    return undefined;
  }
  let extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended && extended[1].trim().toUpperCase() === 'UTF-8') {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      // Fall through to the plain parameter.
    }
  }
  let quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) {
    return quoted[1].replace(/\\(.)/g, '$1');
  }
  let bare = /filename\s*=\s*([^;\s]+)/i.exec(header);
  return bare ? bare[1] : undefined;
}
