import { rri, urlNamesFile } from '@cardstack/runtime-common';
import { MAX_TOOL_RESULT_MEDIA_FILE_BYTES } from '@cardstack/runtime-common/ai';

import type LoaderService from '../services/loader-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type { FileDef } from '@cardstack/base/file-api';

// How the assistant sees something visually: it captures a card instance or a
// workspace file through `POST /_capture`, which renders it as the user
// who asked, then uploads the image to the room so a tool result can attach
// it. A capture only reaches what lives in a workspace the user can read;
// anything else gets an error that names what the assistant should do instead.

export type ViewKind = 'card' | 'file';
export type ViewFormat = 'isolated' | 'embedded';

export interface ViewTarget {
  // The URL the capture endpoint is given: a card's id or `.json` URL, or a
  // file's own URL.
  url: string;
  realmURL: string;
  kind: ViewKind;
}

export interface ViewOptions {
  format?: ViewFormat;
  viewportWidth?: number;
  viewportHeight?: number;
  fullPage?: boolean;
}

export interface ViewedImage {
  sourceUrl: string;
  kind: ViewKind;
  format: ViewFormat;
  width: number | undefined;
  height: number | undefined;
  // Set when the image shows less than the capture did (a full-page capture
  // cut to its top); says what was left out.
  note: string | undefined;
  // The uploaded image, ready to attach to a tool result.
  file: FileDef;
}

interface Services {
  loaderService: LoaderService;
  matrixService: MatrixService;
  network: NetworkService;
  realm: RealmService;
  realmServer: RealmServerService;
}

// The viewport a capture uses unless the caller asks for another: wide enough
// for a card's isolated layout to read as it does on a laptop screen.
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

// Bounds on the image handed to the model. Providers refuse an image past
// roughly 8000px on an edge; the prompt omits a tool-result image larger than
// `MAX_TOOL_RESULT_MEDIA_FILE_BYTES` of raw bytes.
const MAX_IMAGE_EDGE = 4096;
const MAX_IMAGE_BYTES = MAX_TOOL_RESULT_MEDIA_FILE_BYTES;

// The time kept back after the capture answers, for fitting and uploading
// the image. A capture request is aborted at its deadline, so a view always
// leaves this much for the rest of its work.
export const UPLOAD_RESERVE_MS = 10_000;
// Least time worth retrying a 503 in: the retry is normally answered from the
// stored capture, so it needs only a short window past the server's hint.
const MIN_RETRY_WINDOW_MS = 2_000;

const LOCAL_SOURCE_PREFIX = 'boxel-local://';

export class VisualCaptureError extends Error {}

function notInWorkspace(reference: string): VisualCaptureError {
  return new VisualCaptureError(
    `Cannot capture ${reference}: it is not in a workspace the user can read, ` +
      'and only cards and files in a workspace can be captured. If the user ' +
      'attached it to the chat from their computer: an attached image is ' +
      'visible to you in the turn it was sent, and to look at it again you ' +
      'need them to attach it again or upload it into a workspace; any other ' +
      'attached file (an HTML page, for example) reaches you only as its ' +
      'source, so tell the user you cannot see how it renders, and ask them ' +
      'to attach a screenshot or to upload the file into a workspace so you ' +
      'can capture it yourself.',
  );
}

export async function resolveViewTarget(
  reference: string,
  {
    loaderService,
    network,
    realm,
  }: Pick<Services, 'loaderService' | 'network' | 'realm'>,
): Promise<ViewTarget> {
  let trimmed = reference?.trim();
  if (!trimmed) {
    throw new VisualCaptureError('A URL to view is required.');
  }
  if (
    trimmed.startsWith(LOCAL_SOURCE_PREFIX) ||
    trimmed.startsWith('mxc://') ||
    trimmed.startsWith('data:')
  ) {
    throw notInWorkspace(trimmed);
  }
  let url: URL;
  try {
    let vn = loaderService.loader.getVirtualNetwork();
    url = vn ? vn.toURL(trimmed) : new URL(trimmed);
  } catch {
    throw notInWorkspace(trimmed);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw notInWorkspace(trimmed);
  }
  let href = url.href;
  let realmURL = realm.realmOf(rri(href));
  if (!realmURL) {
    throw notInWorkspace(href);
  }
  if (!realm.canRead(realmURL)) {
    throw new VisualCaptureError(
      `Cannot capture ${href}: the user has no read access to its workspace ${realmURL}.`,
    );
  }
  // A card instance is named by its id or by its `.json` file, and a `.json`
  // is a card only when the realm serves it as one — a plain JSON file is a
  // file. Anything else with a registered file extension is a file, captured
  // through its FileDef.
  let kind: ViewKind;
  if (href.endsWith('.json')) {
    kind = (await servesAsCard(href, network)) ? 'card' : 'file';
  } else {
    kind = urlNamesFile(url) ? 'file' : 'card';
  }
  return { url: href, realmURL, kind };
}

async function servesAsCard(
  jsonURL: string,
  network: NetworkService,
): Promise<boolean> {
  try {
    let response = await network.authedFetch(jsonURL.replace(/\.json$/, ''), {
      headers: { Accept: 'application/vnd.card+json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function captureForAgent(
  target: ViewTarget,
  options: ViewOptions,
  services: Services,
  // `deadline` is when the capture must have answered; fitting and uploading
  // the image follow it. `signal` lets the caller abandon the view early.
  { deadline, signal }: { deadline: number; signal?: AbortSignal },
): Promise<ViewedImage> {
  let { loaderService, realm, realmServer, matrixService } = services;
  let format: ViewFormat = options.format ?? 'isolated';
  if (format !== 'isolated' && format !== 'embedded') {
    throw new VisualCaptureError(
      `Format must be "isolated" or "embedded" (got: ${format}).`,
    );
  }
  if ((options.viewportWidth == null) !== (options.viewportHeight == null)) {
    throw new VisualCaptureError(
      'viewportWidth and viewportHeight must be provided together.',
    );
  }
  let captureSpec = {
    viewport:
      options.viewportWidth != null && options.viewportHeight != null
        ? { width: options.viewportWidth, height: options.viewportHeight }
        : DEFAULT_VIEWPORT,
    ...(options.fullPage ? { fullPage: true } : {}),
  };

  // The capture endpoint verifies a realm session the same as a realm-server
  // one, so the target realm's token authorizes the request (see the
  // capture-card tool for why a missing token is minted only with a client).
  let token = realm.token(target.realmURL);
  if (!token && realmServer.hasClient) {
    await realm.login(target.realmURL);
    token = realm.token(target.realmURL);
  }
  if (!token) {
    throw new VisualCaptureError(
      `Cannot capture ${target.url}: no session for its workspace ${target.realmURL}.`,
    );
  }

  let vn = loaderService.loader.getVirtualNetwork()!;
  let endpoint = new URL('/_capture', realmServer.url).href;
  let body = JSON.stringify({
    data: {
      type: 'capture-card',
      attributes: {
        realmURL: target.realmURL,
        ...(target.kind === 'file'
          ? { fileURL: target.url }
          : { cardId: target.url }),
        format,
        includeBase64: true,
        captureSpec,
      },
    },
  });

  // A 503 means the capture is still rendering; the job keeps going and lands
  // its capture in the ledger, so a retry after the server's hint is answered
  // from there.
  let stillRendering = () =>
    new VisualCaptureError(
      `The capture of ${target.url} is still rendering; try viewing it again shortly.`,
    );
  let attrs: any;
  for (;;) {
    if (deadline <= Date.now()) {
      throw stillRendering();
    }
    let attempt = AbortSignal.any([
      AbortSignal.timeout(deadline - Date.now()),
      ...(signal ? [signal] : []),
    ]);
    let response: Response;
    try {
      response = await vn.fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: attempt,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new VisualCaptureError(`The view of ${target.url} was stopped.`);
      }
      if (attempt.aborted) {
        throw stillRendering();
      }
      throw error;
    }
    if (response.status === 503) {
      let retryAfterMs =
        Math.max(1, Number(response.headers.get('retry-after')) || 1) * 1000;
      if (deadline - Date.now() - retryAfterMs < MIN_RETRY_WINDOW_MS) {
        throw stillRendering();
      }
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }
    if (!response.ok) {
      let text = await response.text().catch(() => '');
      throw new VisualCaptureError(
        `Capturing ${target.url} failed (${response.status} ${response.statusText}): ${text}`,
      );
    }
    attrs = (await response.json())?.data?.attributes;
    break;
  }
  if (!attrs || attrs.status !== 'ready') {
    throw new VisualCaptureError(
      `Capturing ${target.url} did not produce an image: ${
        attrs?.error ?? 'no capture returned'
      }`,
    );
  }
  let base64: string | undefined = attrs.captures?.[0]?.base64 ?? attrs.base64;
  if (!base64) {
    throw new VisualCaptureError(
      `Capturing ${target.url} returned no image bytes.`,
    );
  }
  let image = await fitImage(
    base64ToBytes(base64),
    attrs.contentType ?? 'image/png',
  );
  if (signal?.aborted) {
    throw new VisualCaptureError(`The view of ${target.url} was stopped.`);
  }

  await matrixService.ready;
  let name = `${baseName(target.url)} (${format}).${extensionFor(
    image.contentType,
  )}`;
  let local = matrixService.fileAPI.createFileDef({
    sourceUrl: `${LOCAL_SOURCE_PREFIX}capture/${await shortHash(
      image.bytes,
    )}/${encodeURIComponent(name)}`,
    name,
    contentType: image.contentType,
  });
  await matrixService.prefetchLocalFileContent(
    local,
    image.bytes,
    image.contentType,
  );
  let [file] = await matrixService.uploadFiles([local]);
  return {
    sourceUrl: target.url,
    kind: target.kind,
    format,
    width: image.width ?? attrs.width ?? undefined,
    height: image.height ?? attrs.height ?? undefined,
    note: image.note,
    file: file as FileDef,
  };
}

// When the capture must answer for a view that has to be done by `doneBy`.
export function captureDeadline(doneBy: number): number {
  return doneBy - UPLOAD_RESERVE_MS;
}

// The capture as the model can take it: unchanged when it is within the edge
// and byte bounds, otherwise scaled down (and re-encoded as JPEG when PNG
// stays too heavy) until it is. A page much taller than it is wide keeps its
// width, scaled only to the edge bound, and is cut to its top instead of
// being shrunk to an unreadable strip.
async function fitImage(
  bytes: Uint8Array,
  contentType: string,
): Promise<{
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
  note?: string;
}> {
  let bitmap = await createImageBitmap(
    new Blob([bytes as BlobPart], { type: contentType }),
  );
  try {
    if (
      bytes.byteLength <= MAX_IMAGE_BYTES &&
      Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_EDGE
    ) {
      return { bytes, contentType };
    }
    let scale = Math.min(1, MAX_IMAGE_EDGE / bitmap.width);
    let sourceHeight = Math.min(bitmap.height, MAX_IMAGE_EDGE / scale);
    let note =
      sourceHeight < bitmap.height
        ? `Only the top ${Math.round(sourceHeight)}px of the ${bitmap.height}px-tall capture is shown.`
        : undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      let width = Math.max(1, Math.round(bitmap.width * scale));
      let height = Math.max(1, Math.round(sourceHeight * scale));
      let canvas = new OffscreenCanvas(width, height);
      canvas
        .getContext('2d')!
        .drawImage(
          bitmap,
          0,
          0,
          bitmap.width,
          sourceHeight,
          0,
          0,
          width,
          height,
        );
      let type = attempt === 0 ? 'image/png' : 'image/jpeg';
      let blob = await canvas.convertToBlob({ type, quality: 0.85 });
      if (blob.size <= MAX_IMAGE_BYTES) {
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          contentType: type,
          width,
          height,
          note,
        };
      }
      if (attempt > 0) {
        scale *= 0.75;
      }
    }
    throw new VisualCaptureError(
      'The capture is too large to show the model, even scaled down.',
    );
  } finally {
    bitmap.close();
  }
}

function base64ToBytes(base64: string): Uint8Array {
  let binary = atob(base64);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function shortHash(bytes: Uint8Array): Promise<string> {
  let digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function baseName(url: string): string {
  let path = new URL(url).pathname.replace(/\/$/, '');
  return decodeURIComponent(path.split('/').pop() || url);
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}
