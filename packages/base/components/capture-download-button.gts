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
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { not, or } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';

type ButtonKind = 'default' | 'primary' | 'secondary' | 'muted' | 'text-only';
type ButtonSize = 'extra-small' | 'small' | 'base' | 'tall' | 'touch';

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

export interface DownloadCaptureOptions {
  filename?: string;
  fetch?: typeof globalThis.fetch;
  save?: (blob: Blob, filename: string) => void;
}

export async function downloadCapture(
  url: string,
  options: DownloadCaptureOptions = {},
): Promise<string> {
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
  (options.save ?? saveBlob)(blob, filename);
  return filename;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    url?: string;
    filename?: string;
    kind?: ButtonKind;
    size?: ButtonSize;
  };
  Blocks: { default: [] };
}

// Usage in a card template:
//
//   <CaptureDownloadButton @url={{this.pdfUrl}}>Save PDF</CaptureDownloadButton>
//
// Renders disabled until `@url` resolves, shows the button's loading state
// while the capture is fetched (a first request renders on demand and can
// take seconds), and reports a failure inline.
export class CaptureDownloadButton extends GlimmerComponent<Signature> {
  @tracked isPending = false;
  @tracked errorMessage: string | undefined;

  @action
  async save() {
    if (!this.args.url || this.isPending) {
      return;
    }
    this.isPending = true;
    this.errorMessage = undefined;
    try {
      await downloadCapture(this.args.url, { filename: this.args.filename });
    } catch (e) {
      this.errorMessage =
        e instanceof CaptureDownloadError
          ? e.message
          : 'Could not download the document.';
    } finally {
      this.isPending = false;
    }
  }

  <template>
    <span class='capture-download' ...attributes>
      <Button
        @kind={{if @kind @kind 'secondary'}}
        @size={{@size}}
        @loading={{this.isPending}}
        @disabled={{or this.isPending (not @url)}}
        {{on 'click' this.save}}
        data-test-capture-download
      >
        {{#if (has-block)}}{{yield}}{{else}}Save{{/if}}
      </Button>
      {{#if this.errorMessage}}
        <span
          class='capture-download-error'
          role='alert'
          data-test-capture-download-error
        >{{this.errorMessage}}</span>
      {{/if}}
    </span>
    <style scoped>
      .capture-download {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .capture-download-error {
        font-size: var(--boxel-font-size-sm);
        color: var(--destructive);
      }
    </style>
  </template>
}

export default CaptureDownloadButton;
