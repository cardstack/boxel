// Wrapper-free resource primitives. These separate resolving a FileDef into an
// HTTP resource from any card chrome around it, so a template author can use a
// file as an ingredient in an authored layout: each component emits exactly one
// native element and nothing else, and `FileResource` emits no DOM at all.
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { profileForFile, type FileTypeProfile } from './file-type-profile';

// A structural contract rather than `FileDef` itself, so callers can pass a
// plain object (a test fixture, a serialized file) as well as a real instance.
export interface FileResourceLike {
  id?: string | URL | null;
  url?: string | URL | null;
  sourceUrl?: string | URL | null;
  name?: string | null;
  contentType?: string | null;
}

interface ResourceArgs {
  file?: FileResourceLike | null;
  url?: string | URL | null;
  name?: string | null;
  contentType?: string | null;
}

export interface ResolvedFileResource {
  url: string;
  hasURL: boolean;
  name: string;
  contentType: string;
  profile: FileTypeProfile;
  backgroundImage: string;
  backgroundStyle: ReturnType<typeof htmlSafe>;
}

function stringValue(value?: string | URL | null): string {
  return value == null ? '' : String(value);
}

// One precedence order for every primitive: an explicit URL wins, then the
// FileDef's own `url`, then its id, then the source URL it was extracted from.
export function fileResourceURL(
  file?: FileResourceLike | null,
  explicitURL?: string | URL | null,
): string {
  return (
    stringValue(explicitURL) ||
    stringValue(file?.url) ||
    stringValue(file?.id) ||
    stringValue(file?.sourceUrl)
  );
}

// Keep an untrusted filename or URL inside a single quoted CSS token so it
// can't terminate the declaration it appears in.
function cssURL(url: string): string {
  if (!url) {
    return 'none';
  }
  let escaped = url
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, '');
  return `url("${escaped}")`;
}

function resourceFrom(args: ResourceArgs): ResolvedFileResource {
  let url = fileResourceURL(args.file, args.url);
  let name = stringValue(args.name) || stringValue(args.file?.name);
  let contentType =
    stringValue(args.contentType) || stringValue(args.file?.contentType);
  let profile = profileForFile({ name, contentType });
  let backgroundImage = cssURL(url);
  return {
    url,
    hasURL: Boolean(url),
    name,
    contentType,
    profile,
    backgroundImage,
    backgroundStyle: htmlSafe(`background-image: ${backgroundImage};`),
  };
}

// Hands a parent direct control of the native element without introducing any
// wrapper DOM, which is what makes custom transports possible.
const exposeVideoElement = modifier(
  (
    element: HTMLVideoElement,
    [callback]: [((element: HTMLVideoElement | null) => void) | undefined],
  ) => {
    callback?.(element);
    return () => callback?.(null);
  },
);

const exposeAudioElement = modifier(
  (
    element: HTMLAudioElement,
    [callback]: [((element: HTMLAudioElement | null) => void) | undefined],
  ) => {
    callback?.(element);
    return () => callback?.(null);
  },
);

// Loads a linked font face onto the caller's exact element. The face is removed
// from the document on teardown so a long-lived page doesn't accumulate one
// registration per render.
export const applyFileFont = modifier(
  (
    element: HTMLElement,
    [file, explicitURL, familyName]: [
      FileResourceLike | null | undefined,
      string | URL | null | undefined,
      string | undefined,
    ],
  ) => {
    let resourceURL = fileResourceURL(file, explicitURL);
    if (!resourceURL || typeof FontFace === 'undefined') {
      return;
    }
    let cancelled = false;
    let loadedFace: FontFace | undefined;
    let resolvedFamily = familyName || 'Boxel linked file specimen';
    let face = new FontFace(resolvedFamily, cssURL(resourceURL));
    void face
      .load()
      .then((font) => {
        if (cancelled) {
          return;
        }
        loadedFace = font;
        document.fonts.add(font);
        element.style.fontFamily = `"${resolvedFamily}", var(--font-sans)`;
      })
      .catch(() => {
        // The surrounding template keeps its theme font when the resource
        // cannot load.
      });
    return () => {
      cancelled = true;
      element.style.removeProperty('font-family');
      if (loadedFace) {
        document.fonts.delete(loadedFace);
      }
    };
  },
);

// Native media controls sit inside an embedded card that is itself clickable,
// so a press on the play button must not also navigate the enclosing card.
const containNativeMediaEvents = modifier((element: HTMLMediaElement) => {
  let stop = (event: Event) => event.stopPropagation();
  let events = ['click', 'pointerdown', 'mousedown', 'touchstart', 'keydown'];
  for (let eventName of events) {
    element.addEventListener(eventName, stop);
  }
  return () => {
    for (let eventName of events) {
      element.removeEventListener(eventName, stop);
    }
  };
});

// Browsers may pause internally while their native scrubber is dragged, which
// would leave a playing track stopped after the user let go. Restore whatever
// transport state the user had before the seek: seeking changes time, not
// play/pause.
const preservePlaybackIntentWhileSeeking = modifier(
  (element: HTMLMediaElement) => {
    let seekInProgress = false;
    let intendsToPlay = !element.paused && !element.ended;
    // Captured on pointerdown, before the browser can pause for its own scrub.
    let pointerIntent: boolean | null = null;
    let handlePlay = () => {
      intendsToPlay = true;
    };
    let handlePause = () => {
      if (!seekInProgress) {
        intendsToPlay = false;
      }
    };
    let handleSeeking = () => {
      seekInProgress = true;
      intendsToPlay =
        pointerIntent ?? (intendsToPlay || (!element.paused && !element.ended));
    };
    let handleSeeked = () => {
      seekInProgress = false;
      pointerIntent = null;
      if (intendsToPlay && !element.ended && element.paused) {
        void element.play().catch(() => {
          intendsToPlay = false;
        });
      } else if (!intendsToPlay && !element.paused) {
        element.pause();
      }
    };
    let handleEnded = () => {
      intendsToPlay = false;
      seekInProgress = false;
    };
    let handlePointerDown = () => {
      pointerIntent = !element.paused && !element.ended;
    };
    let handlePointerUp = () => {
      if (!seekInProgress) {
        pointerIntent = null;
      }
    };
    let listeners: [string, EventListener][] = [
      ['play', handlePlay],
      ['pause', handlePause],
      ['seeking', handleSeeking],
      ['seeked', handleSeeked],
      ['ended', handleEnded],
      ['pointerdown', handlePointerDown],
      ['pointerup', handlePointerUp],
      ['pointercancel', handlePointerUp],
    ];
    for (let [eventName, listener] of listeners) {
      element.addEventListener(eventName, listener);
    }
    return () => {
      for (let [eventName, listener] of listeners) {
        element.removeEventListener(eventName, listener);
      }
    };
  },
);

// The auth service worker injects the realm bearer token into native GET
// requests, so `<audio src>` normally just works. This opt-in covers the cases
// it can't: a browser with no controlling worker yet, or one that declines to
// route media element requests through it. The object URL is ephemeral and is
// revoked on teardown, so it never reaches card data.
const loadProtectedMediaBlob = modifier(
  (
    element: HTMLMediaElement,
    [resourceURL, enabled]: [string | undefined, boolean | undefined],
  ) => {
    if (!enabled || !resourceURL) {
      return;
    }
    let cancelled = false;
    let objectURL: string | undefined;
    let controller = new AbortController();
    element.removeAttribute('src');
    void (async () => {
      try {
        // `same-origin` rather than `include`: the realm server answers with
        // `Access-Control-Allow-Origin: *`, which a credentialed cross-origin
        // request rejects.
        let response = await fetch(resourceURL, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Media fetch failed with HTTP ${response.status}`);
        }
        let blob = await response.blob();
        if (cancelled) {
          return;
        }
        objectURL = URL.createObjectURL(blob);
        element.src = objectURL;
        element.load();
      } catch {
        if (!cancelled) {
          // Fall back to the canonical source so playback degrades rather
          // than disappearing.
          element.src = resourceURL;
          element.load();
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      element.removeAttribute('src');
      if (objectURL) {
        URL.revokeObjectURL(objectURL);
      }
    };
  },
);

interface FileResourceSignature {
  Args: ResourceArgs;
  Blocks: { default: [ResolvedFileResource] };
}

// Renderless: yields resolved data, never DOM.
export class FileResource extends GlimmerComponent<FileResourceSignature> {
  get resource(): ResolvedFileResource {
    return resourceFrom(this.args);
  }

  <template>{{yield this.resource}}</template>
}

interface FileImageSignature {
  Args: ResourceArgs & {
    src?: string | URL | null;
    alt?: string | null;
    loading?: 'eager' | 'lazy';
    decoding?: 'async' | 'auto' | 'sync';
  };
  Element: HTMLImageElement;
}

// Exactly one `<img>`; the caller owns every visual decision through
// `...attributes`.
export class FileImage extends GlimmerComponent<FileImageSignature> {
  get src() {
    return fileResourceURL(this.args.file, this.args.src ?? this.args.url);
  }
  get alt() {
    return this.args.alt ?? this.args.name ?? this.args.file?.name ?? '';
  }

  <template>
    {{#if this.src}}
      <img
        src={{this.src}}
        alt={{this.alt}}
        loading={{@loading}}
        decoding={{@decoding}}
        ...attributes
      />
    {{/if}}
  </template>
}

interface FileAudioSignature {
  Args: ResourceArgs & {
    src?: string | URL | null;
    controls?: boolean;
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
    preload?: 'auto' | 'metadata' | 'none';
    captionSrc?: string | URL | null;
    captionLang?: string;
    captionLabel?: string;
    loadAsBlob?: boolean;
    onElement?: (element: HTMLAudioElement | null) => void;
  };
  Blocks: { default?: [] };
  Element: HTMLAudioElement;
}

export class FileAudio extends GlimmerComponent<FileAudioSignature> {
  get src() {
    return (
      fileResourceURL(this.args.file, this.args.src ?? this.args.url) ||
      undefined
    );
  }
  // Leave `src` off the element when the blob path will set it, so the browser
  // doesn't fire a failing native request first.
  get elementSrc() {
    return this.args.loadAsBlob ? undefined : this.src;
  }
  get controls() {
    return this.args.controls ?? true;
  }
  get captionSrc() {
    return stringValue(this.args.captionSrc);
  }

  <template>
    <audio
      src={{this.elementSrc}}
      controls={{this.controls}}
      autoplay={{@autoplay}}
      loop={{@loop}}
      muted={{@muted}}
      preload={{@preload}}
      {{loadProtectedMediaBlob this.src @loadAsBlob}}
      {{exposeAudioElement @onElement}}
      {{containNativeMediaEvents}}
      {{preservePlaybackIntentWhileSeeking}}
      ...attributes
    >
      {{#if this.captionSrc}}
        <track
          kind='captions'
          src={{this.captionSrc}}
          srclang={{@captionLang}}
          label={{@captionLabel}}
          default
        />
      {{/if}}
      {{#if (has-block)}}{{yield}}{{/if}}
    </audio>
  </template>
}

interface FileVideoSignature {
  Args: ResourceArgs & {
    src?: string | URL | null;
    poster?: string | URL | null;
    controls?: boolean;
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
    playsInline?: boolean;
    preload?: 'auto' | 'metadata' | 'none';
    captionSrc?: string | URL | null;
    captionLang?: string;
    captionLabel?: string;
    onElement?: (element: HTMLVideoElement | null) => void;
    loadAsBlob?: boolean;
  };
  Blocks: { default?: [] };
  Element: HTMLVideoElement;
}

export class FileVideo extends GlimmerComponent<FileVideoSignature> {
  get src() {
    return (
      fileResourceURL(this.args.file, this.args.src ?? this.args.url) ||
      undefined
    );
  }
  get poster() {
    return stringValue(this.args.poster);
  }
  get elementSrc() {
    return this.args.loadAsBlob ? undefined : this.src;
  }
  get controls() {
    return this.args.controls ?? true;
  }
  get playsInline() {
    return this.args.playsInline ?? true;
  }
  get captionSrc() {
    return stringValue(this.args.captionSrc);
  }

  <template>
    <video
      src={{this.elementSrc}}
      poster={{this.poster}}
      controls={{this.controls}}
      autoplay={{@autoplay}}
      loop={{@loop}}
      muted={{@muted}}
      playsinline={{this.playsInline}}
      preload={{@preload}}
      {{exposeVideoElement @onElement}}
      {{loadProtectedMediaBlob this.src @loadAsBlob}}
      {{containNativeMediaEvents}}
      {{preservePlaybackIntentWhileSeeking}}
      ...attributes
    >
      {{#if this.captionSrc}}
        <track
          kind='captions'
          src={{this.captionSrc}}
          srclang={{@captionLang}}
          label={{@captionLabel}}
          default
        />
      {{/if}}
      {{#if (has-block)}}{{yield}}{{/if}}
    </video>
  </template>
}

interface FileObjectSignature {
  Args: ResourceArgs & {
    data?: string | URL | null;
    type?: string | null;
    label?: string | null;
  };
  Blocks: { default?: [] };
  Element: HTMLObjectElement;
}

// Document embedding (PDF, SVG) without injecting markup into the page.
export class FileObject extends GlimmerComponent<FileObjectSignature> {
  get data() {
    return (
      fileResourceURL(this.args.file, this.args.data ?? this.args.url) ||
      undefined
    );
  }
  get contentType() {
    return (
      this.args.type ??
      this.args.contentType ??
      this.args.file?.contentType ??
      undefined
    );
  }
  get label() {
    return (
      this.args.label ?? this.args.name ?? this.args.file?.name ?? undefined
    );
  }

  <template>
    <object
      data={{this.data}}
      type={{this.contentType}}
      aria-label={{this.label}}
      ...attributes
    >
      {{#if (has-block)}}{{yield}}{{/if}}
    </object>
  </template>
}
