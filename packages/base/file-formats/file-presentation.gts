// Presentation helpers shared by all four format shells, so an icon, a byte
// count, or a date reads identically in atom, fitted, embedded, and isolated.
import { modifier } from 'ember-modifier';

import FileIcon from '@cardstack/boxel-icons/file';

import {
  decodedLastSegmentOfIdentifier,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import type { ComponentLike } from '@glint/template';
import { now } from '../helpers/clock';

// Structurally the same as card-api's `CardOrFieldTypeIcon`, restated here so
// the shells need nothing from card-api — not even a type. card-api imports the
// format templates, so the dependency only runs the other way.
export type FileIconComponent = ComponentLike<{ Element: SVGSVGElement }>;

// The glyph comes from the file's own class, which already declares
// `static icon` — `AudioDef` names the music glyph, `PngDef` the PNG one. Two
// reasons the shells read it from there rather than keeping a family→glyph map:
// a family that adds itself doesn't have to also edit a shared registry, and
// each glyph's module stays out of card-api's dependency graph, which every
// card in every realm inherits. `FileDef`'s own generic icon is the fallback
// for a file whose family hasn't landed a subclass yet.
export function fileIconFor(
  source?: { icon?: FileIconComponent } | null,
): FileIconComponent {
  return source?.icon ?? FileIcon;
}

// Whether a bounded frame should letterbox an image rather than center-crop
// it. A vector is as likely a diagram as a picture, and a square crop of a
// panorama or a skyscraper is meaningless. One rule, because two renderers
// present the same picture — the fitted stage and the fitted shell's
// list-view thumbnail rail — and they must letterbox it identically.
export function letterboxImage(
  previewKind?: string | null,
  aspectRatio?: number | null,
): boolean {
  if (previewKind === 'svg') {
    return true;
  }
  return aspectRatio != null && (aspectRatio >= 2.5 || aspectRatio <= 0.4);
}

// Preserve the source's authored shape until honoring it would make the player
// unusably short or tall; extreme cinema and portrait sources matte instead.
export function boundedVideoFrameAspectRatio(value?: number | null): number {
  let ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 16 / 9;
  }
  return Math.max(4 / 5, Math.min(16 / 9, ratio));
}

// Embedded content owns its own interaction; the host chrome owns navigation.
// Without this, pressing a native control also opens the enclosing card.
export const containEmbeddedInteraction = modifier((element: HTMLElement) => {
  let stop = (event: Event) => event.stopPropagation();
  let events = [
    'click',
    'dblclick',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
  ];
  for (let eventName of events) {
    element.addEventListener(eventName, stop);
  }
  return () => {
    for (let eventName of events) {
      element.removeEventListener(eventName, stop);
    }
  };
});

export function humanSize(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) {
    return '';
  }
  if (bytes === 0) {
    return '0 bytes';
  }
  let units = ['bytes', 'KB', 'MB', 'GB'];
  let i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  let value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

// The filename a download should be saved as, or `undefined` when the file has
// no name — the distinction is load-bearing, since `download=""` and an absent
// `download` attribute are not the same to a browser. Shared so the isolated
// shell's header link and the generic fallback pane can't drift on it.
export function downloadNameFor(
  model?: { name?: string } | null,
): string | undefined {
  return model?.name || undefined;
}

// Reads a realm file's bytes with the caller's session, for every view that
// loads a file through `fetch` rather than an element's own `src`. `same-origin`
// rather than `include`: the realm answers with `Access-Control-Allow-Origin: *`,
// which a credentialed cross-origin request rejects; the auth service worker
// carries the session instead. The request asks for the stored source: under
// the default `Accept: */*` the realm answers a `.gts`, `.ts` or `.js` path with
// its transpiled module, not the file as written. A response that isn't OK
// throws, so a caller only ever reads a body that is the file.
export async function fetchRealmFile(
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  let response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: SupportedMimeType.CardSource },
    signal,
  });
  if (!response.ok) {
    throw new Error(`File fetch failed with HTTP ${response.status}`);
  }
  return response;
}

export type DownloadState = 'idle' | 'pending' | 'failed';

// What a Download link reads in each state. The state is in the label, not
// only its styling, so it reaches touch, keyboard and screen-reader users;
// the links announce a change of label through `aria-live`.
export function downloadLabelFor(state: DownloadState): string {
  switch (state) {
    case 'pending':
      return 'Downloading…';
    case 'failed':
      return 'Retry download';
    default:
      return 'Download';
  }
}

// The `data-download-state` a Download link carries for styling; an idle link
// carries none.
export function downloadStateAttr(state: DownloadState): string | undefined {
  return state === 'idle' ? undefined : state;
}

// Saves a file link's bytes rather than letting the browser follow its `href`.
// A realm URL followed as a download navigation doesn't yield the file: the
// navigation's `Accept: text/html` gets the host app shell, the request carries
// no Authorization header so a private realm answers 401, and a realm on
// another origin than the host has its `download` attribute ignored. The bytes
// come from `fetchRealmFile`, the same authenticated read the previews use, and
// are saved through a `blob:` URL under the link's `download` name. The anchor
// keeps its `href`, so modified clicks (new tab, new window) and copy-link
// still work natively. The whole body is read before the save starts, so the
// modifier reports each download's state through `onStateChange` — `pending`
// while the bytes arrive, `failed` when they don't, `idle` once saved — and
// the view that owns the link renders it.
export const downloadViaFetch = modifier(
  (
    element: HTMLAnchorElement,
    _positional: [],
    { onStateChange }: { onStateChange?: (state: DownloadState) => void },
  ) => {
    // Leaving the view abandons a download still in flight, so its save never
    // lands on whatever page is showing by the time the bytes arrive.
    let controller = new AbortController();
    let inFlight = false;
    let onClick = async (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      if (inFlight || !element.href) {
        return;
      }
      inFlight = true;
      onStateChange?.('pending');
      try {
        let response = await fetchRealmFile(element.href, controller.signal);
        let blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }
        let objectURL = URL.createObjectURL(blob);
        let save = document.createElement('a');
        save.href = objectURL;
        // A blob: URL has no meaningful name of its own, so a nameless file
        // falls back to the last segment of its URL rather than a random id.
        save.download =
          element.getAttribute('download') ||
          decodedLastSegmentOfIdentifier(element.href);
        save.hidden = true;
        document.body.append(save);
        save.click();
        save.remove();
        // The browser reads the blob when the download starts, not
        // synchronously on click, so the URL stays valid for a while after.
        setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
        onStateChange?.('idle');
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error(`Could not download ${element.href}`, error);
        onStateChange?.('failed');
      } finally {
        inFlight = false;
      }
    };
    element.addEventListener('click', onClick);
    return () => {
      controller.abort();
      element.removeEventListener('click', onClick);
    };
  },
);

// Coerce a timestamp to a Date. A bare number is epoch time, but the server
// stamps a file's `lastModified` / `resourceCreatedAt` in epoch *seconds* — a
// value `new Date` would otherwise read as milliseconds and render as 1970 —
// so seconds are promoted to ms below the year-2001 ms floor. Mirrors
// `workspace.gts`'s `toMs`.
function toDate(value?: Date | string | number | null): Date | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  return new Date(value);
}

export function shortDate(value?: Date | string | number | null): string {
  let d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) {
    return '';
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function relativeDate(value?: Date | string | number | null): string {
  let d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) {
    return '';
  }
  let days = Math.floor((now() - d.getTime()) / 86400000);
  if (days < 0) {
    return shortDate(d);
  }
  if (days === 0) {
    return 'today';
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)}mo ago`;
  }
  return `${Math.floor(days / 365)}y ago`;
}

export function formatClock(totalSeconds?: number | null): string {
  if (totalSeconds == null || !Number.isFinite(Number(totalSeconds))) {
    return '';
  }
  let seconds = Math.max(0, Math.round(Number(totalSeconds)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
