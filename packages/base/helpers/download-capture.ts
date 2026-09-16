// Saves a realm capture (`{realm}_screenshot/…?type=pdf`, or a png/jpeg/webp
// capture) to the user's disk.
//
// A plain `<a href download>` cannot do this: the `download` attribute is
// ignored on a cross-origin URL, and a navigation carries no Authorization
// header, so a private realm answers 401 and the browser offers to save that
// error body as `.txt`. A `fetch()` from the page goes through the host's
// auth service worker (which injects the realm token and waits out a 503
// while a capture is still rendering), so the bytes arrive authenticated;
// they are then saved through a same-origin blob URL, where `download` works.
//
// `downloadCapture` is the imperative entry point; the `downloadCapture`
// modifier in `../modifiers/download-capture` wires it onto an existing
// `<a href>`.

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// The filename a capture should save as. A `Content-Disposition` filename
// wins when the response exposes one; otherwise the capture URL's last path
// segment (the source card's instance id) plus the `name=` slot when there is
// one, with the extension the content type implies.
export function captureFilenameFor(
  url: string,
  contentType: string | null,
  contentDisposition?: string | null,
): string {
  let fromHeader = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  if (fromHeader) {
    return fromHeader;
  }
  let base = 'capture';
  let slot: string | null = null;
  try {
    let parsed = new URL(url);
    let segments = parsed.pathname.split('/').filter((s) => s.length > 0);
    base = decodeURIComponent(segments[segments.length - 1] ?? base);
    slot = parsed.searchParams.get('name');
  } catch {
    // A relative or malformed URL still gets a usable name.
  }
  if (slot) {
    base = `${base}-${slot}`;
  }
  let safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  if (!safe) {
    safe = 'capture';
  }
  let extension =
    EXTENSION_BY_CONTENT_TYPE[contentType?.split(';')[0].trim() ?? ''];
  if (!extension || safe.toLowerCase().endsWith(`.${extension}`)) {
    return safe;
  }
  return `${safe}.${extension}`;
}

export function saveBlob(blob: Blob, filename: string): void {
  let objectURL = URL.createObjectURL(blob);
  let link = document.createElement('a');
  link.href = objectURL;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking synchronously races the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(objectURL), 0);
}

export class CaptureDownloadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// A refusal names its real reason in the body — a JSON error doc (an
// over-bounds document) or a short plain-text line (a realm that has not
// opted into on-demand captures, a missing token). Surface that before
// falling back to what the status alone can say.
async function messageFor(response: Response): Promise<string> {
  let body = await response.clone().text();
  try {
    let doc = JSON.parse(body);
    let detail = doc?.errors?.[0]?.message ?? doc?.errors?.[0]?.title;
    if (typeof detail === 'string' && detail) {
      return detail;
    }
  } catch {
    let text = body.trim();
    if (text && text.length <= 300 && !text.startsWith('<')) {
      return text;
    }
  }
  switch (response.status) {
    case 401:
    case 403:
      return 'You do not have access to this document.';
    case 404:
      return 'This document is not available.';
    case 503:
      return 'The document is still being prepared. Try again in a moment.';
  }
  return `Could not download the document (HTTP ${response.status}).`;
}

// A left click with no modifier key. Anything else — a middle click, a
// Cmd/Ctrl-click, Shift-click — is the user asking the browser for a new tab
// or window, which a download control leaves alone.
export function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export interface DownloadCaptureOptions {
  filename?: string;
  fetch?: typeof globalThis.fetch;
  save?: (blob: Blob, filename: string) => void;
}

// Fetches the capture with the realm session and returns its bytes plus the
// filename it should be known by.
export async function fetchCapture(
  url: string,
  options: Pick<DownloadCaptureOptions, 'filename' | 'fetch'> = {},
): Promise<{ blob: Blob; filename: string }> {
  let fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  // `same-origin` rather than `include`: the realm server answers with
  // `Access-Control-Allow-Origin: *`, which a credentialed cross-origin
  // request rejects. The service worker supplies the Authorization header.
  let response = await fetchImpl(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new CaptureDownloadError(await messageFor(response), response.status);
  }
  let blob = await response.blob();
  let filename =
    options.filename ??
    captureFilenameFor(
      url,
      response.headers.get('content-type'),
      response.headers.get('content-disposition'),
    );
  return { blob, filename };
}

export async function downloadCapture(
  url: string,
  options: DownloadCaptureOptions = {},
): Promise<string> {
  let { blob, filename } = await fetchCapture(url, options);
  (options.save ?? saveBlob)(blob, filename);
  return filename;
}

export interface OpenCaptureOptions {
  filename?: string;
  fetch?: typeof globalThis.fetch;
  // Opens the blank tab a click is allowed to open. Called synchronously,
  // before the fetch, so it still counts as the user's own click.
  open?: () => Window | null;
}

// Shows the capture in a new tab instead of saving it. The tab is opened
// synchronously, while the click is still the user's own gesture, then
// navigated to a same-origin blob URL once the bytes arrive. The browser's
// PDF viewer serves its own download button from that blob, so the save that
// fails on the realm URL (the viewer re-requests it outside the service
// worker and gets the 401) works here. The blob URL is kept alive for the
// life of this page; the viewing tab may hold it open for as long as it likes.
export async function openCapture(
  url: string,
  options: OpenCaptureOptions = {},
): Promise<string> {
  let tab = (options.open ?? (() => window.open('', '_blank')))();
  if (!tab) {
    throw new CaptureDownloadError(
      'The browser blocked the new tab. Allow pop-ups for this site and try again.',
      0,
    );
  }
  try {
    let { blob, filename } = await fetchCapture(url, options);
    tab.location.href = URL.createObjectURL(blob);
    return filename;
  } catch (e) {
    tab.close();
    throw e;
  }
}
