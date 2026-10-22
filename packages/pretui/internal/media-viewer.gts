// Pretui — the media asset vocabulary and the adapter registry, with the built-in adapters registered at load.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { AudioPlayer } from '../components/audio-player';
import { VideoPlayer } from '../components/video-player';
import type { MediaTrackSpec, TranscriptCue } from '../components/media-player';
import { ImageFrame } from '../components/image-frame';

// ── The asset vocabulary ─────────────────────────────────────────────────

/** Every kind the shell can name. `'unknown'` is a real answer, not an
 * error: it routes to the fallback, which says what it could not open. */
export type AssetKind = 'image' | 'video' | 'audio' | 'model' | 'unknown';

/** What a caller hands the viewer. Only `src` is required. */
export interface MediaAssetSpec {
  /** URL of the asset. Passed through untouched. */
  src: string;
  /** Display name. Also the accessible name of the viewer region. */
  name?: string;
  /** Force the kind, skipping detection. */
  kind?: AssetKind;
  /** MIME type, if the host knows it. Beats the extension. */
  mimeType?: string;
  /** Poster for video; also the grid thumbnail when `thumbnail` is absent. */
  poster?: string;
  /** Small preview image for grids. */
  thumbnail?: string;
  /** Alt text for image assets. An empty string marks it decorative. */
  alt?: string;
  /** Text tracks for time-based assets. */
  tracks?: readonly MediaTrackSpec[];
  /** Seekable transcript for time-based assets. */
  transcript?: readonly TranscriptCue[];
  /** Intrinsic width in pixels, used to reserve space before load. */
  width?: number;
  /** Intrinsic height in pixels, used to reserve space before load. */
  height?: number;
  /** Duration in seconds, for grid badges. */
  duration?: number;
  /** File size in bytes, for grid badges and the inspector. */
  bytes?: number;
  /** Free-form metadata; rendered as key/value rows where a surface has
   * room for it. */
  meta?: Readonly<Record<string, string>>;
}

/** A spec with the derived fields filled in. Adapters receive this, never
 * the raw spec, so no adapter re-derives a kind or an aspect ratio. */
export interface ResolvedMediaAsset extends MediaAssetSpec {
  kind: AssetKind;
  /** Always a usable display name — the file's basename when nothing else. */
  label: string;
  /** A CSS `aspect-ratio` value when width and height are both known. */
  aspectRatio?: string;
}

const EXT_KIND: Readonly<Record<string, AssetKind>> = {
  apng: 'image',
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  heic: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  svg: 'image',
  tif: 'image',
  tiff: 'image',
  webp: 'image',
  m4v: 'video',
  mkv: 'video',
  mov: 'video',
  mp4: 'video',
  ogv: 'video',
  webm: 'video',
  aac: 'audio',
  flac: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  oga: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wav: 'audio',
  weba: 'audio',
  fbx: 'model',
  glb: 'model',
  gltf: 'model',
  obj: 'model',
  usdz: 'model',
};

const MIME_KIND: Readonly<Record<string, AssetKind>> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  model: 'model',
};

/** The MIME type of a `data:` URL, or `''`. Worth handling explicitly: a
 * generated fixture has no extension at all, and half of this kit's media
 * examples are data URLs so they work with no network. */
function dataUrlMime(src: string): string {
  if (!src.startsWith('data:')) {
    return '';
  }
  const head = src.slice(5, 5 + 120);
  const stop = Math.min(
    head.includes(';') ? head.indexOf(';') : head.length,
    head.includes(',') ? head.indexOf(',') : head.length,
  );
  return head.slice(0, stop);
}

/** The lowercase extension of a URL, with query and fragment stripped. */
export function extensionOf(src: string): string {
  const cut = src.split('#')[0].split('?')[0];
  const slash = cut.lastIndexOf('/');
  const name = slash >= 0 ? cut.slice(slash + 1) : cut;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Explicit kind, then MIME type, then extension. Deterministic, no
 * network, no sniffing — a `HEAD` request would be a lie in a realm anyway,
 * where every asset is behind header auth. */
export function kindForAsset(asset: MediaAssetSpec): AssetKind {
  if (asset.kind) {
    return asset.kind;
  }
  const mime = asset.mimeType || dataUrlMime(asset.src);
  if (mime) {
    const top = mime.split('/')[0].trim().toLowerCase();
    const mapped = MIME_KIND[top];
    if (mapped) {
      return mapped;
    }
  }
  return EXT_KIND[extensionOf(asset.src)] ?? 'unknown';
}

/** The basename of a URL, for when the caller gave no name. */
export function basenameOf(src: string): string {
  if (src.startsWith('data:')) {
    return 'Untitled asset';
  }
  const cut = src.split('#')[0].split('?')[0];
  const slash = cut.lastIndexOf('/');
  const name = slash >= 0 ? cut.slice(slash + 1) : cut;
  if (name.length === 0) {
    return 'Untitled asset';
  }
  try {
    return decodeURIComponent(name);
  } catch {
    // a malformed escape such as `100%.png` names the file as written
    return name;
  }
}

const DATA_IMAGE = /^data:image\//i;

/** `src` as a link target, or undefined when its scheme could run code
 * (`javascript:`, `data:text/html`, …). http(s) and blob URLs link; with
 * `images`, so do `data:image/` URLs, which a gallery may legitimately hold. */
export function safeHref(
  src: string | undefined,
  { images = false }: { images?: boolean } = {},
): string | undefined {
  if (!src) {
    return undefined;
  }
  if (images && DATA_IMAGE.test(src.trim())) {
    return src;
  }
  try {
    let base = globalThis.location?.href ?? 'http://localhost/';
    let { protocol } = new URL(src, base);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'blob:'
      ? src
      : undefined;
  } catch {
    return undefined;
  }
}

/** Fill in kind, label and aspect ratio once, at the shell, so no adapter
 * and no grid tile ever repeats the work. */
export function resolveAsset(asset: MediaAssetSpec): ResolvedMediaAsset {
  const width = asset.width;
  const height = asset.height;
  const ratio =
    width && height && width > 0 && height > 0
      ? `${Math.round(width)} / ${Math.round(height)}`
      : undefined;
  return {
    ...asset,
    kind: kindForAsset(asset),
    label: asset.name ?? basenameOf(asset.src),
    aspectRatio: ratio,
  };
}

/** Bytes as a short human string. Binary units, because that is what a file
 * manager shows and an asset panel that disagrees with Finder is noise. */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value = value / 1024;
    unit = unit + 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// ── The adapter registry ─────────────────────────────────────────────────

/** What every adapter component is handed. */
export interface MediaAdapterSignature {
  Args: { asset: ResolvedMediaAsset };
  Element: HTMLElement;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- Glint's
   `ComponentLike` lives in `@glint/template`, which realm code cannot
   import, and a structural constructor type is not invocable in a strict
   template. `iconFor` in icon-registry.gts makes the same trade for the
   same reason. Adapters are checked at their definition site instead, by
   typing each one as TemplateOnlyComponent<MediaAdapterSignature>. */
export type MediaAdapterComponent = any;

export interface MediaAdapter {
  /** Stable id. Registering the same id twice replaces the first. Also
   * lands on the shell as `data-adapter`, which is how a test says which
   * viewer ran without reaching into its markup. */
  id: string;
  /** Human name, used by the fallback when it explains what it wanted. */
  label: string;
  /** Does this adapter want the asset? Checked in registration order,
   * newest first. */
  handles: (asset: ResolvedMediaAsset) => boolean;
  /** The component to render, invoked with `@asset`. */
  component: MediaAdapterComponent;
}

const ADAPTERS: MediaAdapter[] = [];

/** Register an adapter. The most recently registered adapter that claims an
 * asset wins, so a consumer overrides a built-in by registering after this
 * module loads — no patching, no fork. */
export function registerMediaAdapter(adapter: MediaAdapter): void {
  const existing = ADAPTERS.findIndex((a) => a.id === adapter.id);
  if (existing >= 0) {
    ADAPTERS.splice(existing, 1);
  }
  ADAPTERS.unshift(adapter);
}

/** Every registered adapter, newest first. */
export function mediaAdapters(): readonly MediaAdapter[] {
  return ADAPTERS;
}

/** The adapter that will run for this asset, if any. */
export function adapterFor(
  asset: ResolvedMediaAsset,
): MediaAdapter | undefined {
  return ADAPTERS.find((a) => a.handles(asset));
}

// ── The built-in adapters ────────────────────────────────────────────────

const VideoAdapter: TemplateOnlyComponent<MediaAdapterSignature> = <template>
  <VideoPlayer
    @src={{@asset.src}}
    @label={{@asset.label}}
    @poster={{@asset.poster}}
    @aspectRatio={{@asset.aspectRatio}}
    @tracks={{@asset.tracks}}
    @transcript={{@asset.transcript}}
    ...attributes
  />
</template>;

const AudioAdapter: TemplateOnlyComponent<MediaAdapterSignature> = <template>
  <AudioPlayer
    @src={{@asset.src}}
    @label={{@asset.label}}
    @title={{@asset.name}}
    @cover={{@asset.thumbnail}}
    @tracks={{@asset.tracks}}
    @transcript={{@asset.transcript}}
    ...attributes
  />
</template>;


// Registered newest-first, so the array reads video, audio, image after
// these three calls — the order is immaterial because the predicates are
// mutually exclusive, but the rule is worth knowing when you override one.
registerMediaAdapter({
  id: 'image',
  label: 'Image frame',
  handles: (asset) => asset.kind === 'image',
  component: ImageFrame,
});
registerMediaAdapter({
  id: 'audio',
  label: 'Audio player',
  handles: (asset) => asset.kind === 'audio',
  component: AudioAdapter,
});
registerMediaAdapter({
  id: 'video',
  label: 'Video player',
  handles: (asset) => asset.kind === 'video',
  component: VideoAdapter,
});
