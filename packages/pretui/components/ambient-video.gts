// Pretui — AmbientVideo: a muted inline loop that plays itself while it is on screen, and stays polite about it.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

// ── AmbientVideo ─────────────────────────────────────────────────────────
// The "background video" every marketing page has: muted, inline, looping,
// starting on its own. Almost every implementation is one <video autoplay
// muted loop playsinline> tag, and almost every one of them gets these wrong:
//
//   1. **It downloads before anyone can see it.** The source is attached only
//      as the frame nears the viewport (@loadMargin), so a phone does not
//      spend its data on a clip at the bottom of a page nobody scrolls to.
//   2. **It plays when nobody can see it.** Playback follows visibility
//      (@threshold) and the tab's visibility, and a pause the reader asked
//      for is never undone by scrolling.
//   3. **A refused autoplay is a dead poster.** Low Power Mode on iPhone and
//      Safari's "Never Auto-Play" reject play() with NotAllowedError even
//      for muted video. That state is detected (an AbortError, which only
//      means a pause interrupted a pending play, is not), and the frame
//      offers @fallback (an animated image) or a centred play button.
//   4. **No way to stop it.** WCAG 2.2.2: anything that moves for more than
//      five seconds needs a pause control. There is always one, named for
//      what it does, and reduced motion or Save-Data start the clip paused.
//   5. **Safari behind a service worker.** Safari cannot play media whose
//      byte-range requests a service worker answers (MediaError 4) — which
//      is every page a worker controls, including a published Boxel site.
//      When one is in control the clip is fetched whole and played from a
//      blob: URL, which no worker sees.
//
// `muted` is set as a PROPERTY: the attribute only seeds the initial value
// when a parser creates the element, so a framework-built video carrying the
// attribute can still be unmuted at play() time — and then it is refused.

export type AmbientVideoState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'user-paused'
  | 'reduced-motion'
  | 'save-data'
  | 'blocked'
  | 'fallback'
  | 'error';

/** States in which the frame waits for the reader rather than for the page. */
const WAITING_FOR_READER: ReadonlySet<AmbientVideoState> = new Set([
  'user-paused',
  'reduced-motion',
  'save-data',
  'blocked',
  'error',
]);

function errorName(e: unknown): string | undefined {
  return (e as { name?: string } | null)?.name;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function prefersSavedData(): boolean {
  let connection =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { connection?: { saveData?: boolean } })
          .connection;
  return Boolean(connection?.saveData);
}

function controlledByServiceWorker(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.serviceWorker?.controller)
  );
}

export interface AmbientVideoSignature {
  Args: {
    /** the clip; muted, so it should carry no audio worth hearing */
    src: string;
    /** the still shown before the first frame and while paused */
    poster?: string;
    /**
     * what the video shows. Given, the video is informative: the figure is
     * named by it and the control reads "Pause {label}". Omitted, it is
     * decorative and the control reads "Pause background video".
     */
    label?: string;
    /** an animated image (WebP, GIF) to show when autoplay is refused */
    fallback?: string;
    /** aspect ratio reserving the box, e.g. '16 / 9' (default '16 / 9') */
    ratio?: string;
    /** 'cover' (default) or 'contain' */
    fit?: 'cover' | 'contain';
    /** loop the clip (default true) */
    loop?: boolean;
    /** 'visible' (default) attaches the source near the viewport; 'eager'
     * attaches it at once — for a hero above the fold */
    load?: 'visible' | 'eager';
    /** how far ahead of the viewport to start loading (default '800px 0px') */
    loadMargin?: string;
    /** visible fraction at which it plays (default 0.25) */
    threshold?: number;
    /** start paused under prefers-reduced-motion (default true) */
    respectReducedMotion?: boolean;
    /** start paused, and fetch nothing, under Save-Data (default true) */
    respectSaveData?: boolean;
    /** fires on every state change */
    onStateChange?: (state: AmbientVideoState) => void;
  };
  Blocks: {
    /** content laid over the frame — a title, a credit */
    overlay: [];
  };
  Element: HTMLElement;
}

export class AmbientVideo extends Component<AmbientVideoSignature> {
  @tracked state: AmbientVideoState = this.initialState();
  /** read by the modifier at install; untracked so the modifier never
   * re-runs (and tears down its observers) when the state moves */
  private readonly heldAtStart: boolean =
    this.state === 'save-data' || this.state === 'reduced-motion';
  @tracked playableSrc: string | undefined = undefined;

  private el: HTMLVideoElement | null = null;
  private visible = false;
  private sourcing = false;
  private retried = false;
  private pending: Promise<void> | null = null;
  private objectUrl: string | null = null;

  private initialState(): AmbientVideoState {
    if ((this.args.respectSaveData ?? true) && prefersSavedData()) {
      return 'save-data';
    }
    if ((this.args.respectReducedMotion ?? true) && prefersReducedMotion()) {
      return 'reduced-motion';
    }
    return 'idle';
  }

  get ratioStyle() {
    return cssStyleFrom([
      cssDeclaration('--pretui-ambient-ratio', this.args.ratio ?? '16 / 9'),
    ]);
  }
  get fit(): 'cover' | 'contain' {
    return this.args.fit === 'contain' ? 'contain' : 'cover';
  }
  get loop(): boolean {
    return this.args.loop ?? true;
  }
  get playing(): boolean {
    return this.state === 'playing';
  }
  get showFallback(): boolean {
    return this.state === 'fallback' && Boolean(this.args.fallback);
  }
  /** the control moves to the centre when the frame is waiting on a press */
  get awaitingPress(): boolean {
    return (
      this.state === 'blocked' ||
      this.state === 'reduced-motion' ||
      this.state === 'save-data' ||
      this.state === 'error'
    );
  }
  get controlLabel(): string {
    let what = this.args.label ?? 'background video';
    return (this.playing || this.showFallback ? 'Pause ' : 'Play ') + what;
  }

  private setState(next: AmbientVideoState) {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.args.onStateChange?.(next);
  }

  // ── Source ─────────────────────────────────────────────────────────────

  private attachSource = async () => {
    if (this.playableSrc || this.sourcing || this.isDestroying) {
      return;
    }
    let src = this.args.src;
    if (!src) {
      return;
    }
    this.sourcing = true;
    if (this.state === 'idle') {
      this.setState('loading');
    }
    if (!controlledByServiceWorker()) {
      this.playableSrc = src;
      return;
    }
    try {
      let response = await fetch(src);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      let blob = await response.blob();
      if (this.isDestroying) {
        return;
      }
      let typed = blob.type.startsWith('video/')
        ? blob
        : new Blob([blob], { type: 'video/mp4' });
      this.objectUrl = URL.createObjectURL(typed);
      this.playableSrc = this.objectUrl;
    } catch {
      // a failed whole-file fetch still deserves the ordinary path
      if (!this.isDestroying) {
        this.playableSrc = src;
      }
    }
  };

  // ── Playback ───────────────────────────────────────────────────────────

  private tryPlay = () => {
    let el = this.el;
    if (
      !el ||
      !this.playableSrc ||
      !this.visible ||
      this.pending ||
      WAITING_FOR_READER.has(this.state) ||
      this.state === 'fallback' ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }
    el.muted = true;
    let started = el.play();
    if (!started || typeof started.then !== 'function') {
      return;
    }
    this.pending = started;
    started.then(
      () => {
        this.pending = null;
        this.setState('playing');
      },
      (e: unknown) => {
        this.pending = null;
        if (errorName(e) === 'NotAllowedError') {
          this.setState(this.args.fallback ? 'fallback' : 'blocked');
        }
        // AbortError: a pause or reload interrupted the request. Not a refusal.
      },
    );
  };

  /** a pause the page makes (off screen, tab hidden) — never the reader's */
  private systemPause = () => {
    let el = this.el;
    if (!el) {
      return;
    }
    // pause() while play() is pending rejects that promise with AbortError
    // and, on some engines, leaves the element stuck; wait for it to settle.
    if (this.pending) {
      this.pending.then(
        () => this.systemPause(),
        () => undefined,
      );
      return;
    }
    if (!el.paused) {
      el.pause();
    }
    if (this.state === 'playing') {
      this.setState('paused');
    }
  };

  toggle = () => {
    let el = this.el;
    if (this.playing || this.showFallback) {
      this.setState('user-paused');
      el?.pause();
      return;
    }
    // The press is consent: it lifts every reader-side hold.
    this.setState(this.playableSrc ? 'paused' : 'loading');
    if (!this.playableSrc) {
      void this.attachSource();
      return; // tryPlay runs on loadeddata, inside the press's activation window
    }
    if (el && (el.error || el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)) {
      el.load();
    }
    this.visible = true;
    this.tryPlay();
  };

  private loadFailed = () => {
    if (!this.retried && this.el) {
      this.retried = true;
      this.el.load();
      return;
    }
    this.setState('error');
  };

  engine = modifier((el: HTMLVideoElement) => {
    this.el = el;
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');

    let onReady = () => this.tryPlay();
    let onPlaying = () => this.setState('playing');
    let onPause = () => {
      if (this.state === 'playing') {
        this.setState('paused');
      }
    };
    let onError = () => this.loadFailed();
    el.addEventListener('loadeddata', onReady);
    el.addEventListener('canplay', onReady);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('error', onError);

    let playObserver = new IntersectionObserver(
      ([entry]) => {
        this.visible = Boolean(entry?.isIntersecting);
        if (this.visible) {
          this.tryPlay();
        } else {
          this.systemPause();
        }
      },
      { threshold: this.args.threshold ?? 0.25 },
    );
    playObserver.observe(el);

    let loadObserver: IntersectionObserver | undefined;
    if (!this.heldAtStart) {
      if (this.args.load === 'eager') {
        // not during install: attaching moves `state`, which render just read
        void Promise.resolve().then(() => this.attachSource());
      } else {
        loadObserver = new IntersectionObserver(
          ([entry]) => {
            if (entry?.isIntersecting) {
              loadObserver?.disconnect();
              void this.attachSource();
            }
          },
          { rootMargin: this.args.loadMargin ?? '800px 0px' },
        );
        loadObserver.observe(el);
      }
    }

    let onVisibility = () =>
      document.hidden ? this.systemPause() : this.tryPlay();
    document.addEventListener('visibilitychange', onVisibility);

    // Reduced motion honoured live, not only at first paint.
    let motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : undefined;
    let onMotion = (event: MediaQueryListEvent) => {
      if (event.matches && (this.args.respectReducedMotion ?? true)) {
        el.pause();
        this.setState('reduced-motion');
      }
    };
    motionQuery?.addEventListener?.('change', onMotion);

    return () => {
      playObserver.disconnect();
      loadObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery?.removeEventListener?.('change', onMotion);
      el.removeEventListener('loadeddata', onReady);
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('error', onError);
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      this.el = null;
    };
  });

  <template>
    <figure
      class='pretui-ambient'
      data-state={{this.state}}
      data-fit={{this.fit}}
      style={{this.ratioStyle}}
      aria-label={{@label}}
      data-test-pretui-ambient-video
      ...attributes
    >
      {{! The video is driven by the button beside it and named by the figure,
          so it is out of the tab order and the accessibility tree rather than
          a second, unlabelled control. No autoplay attribute: play() is
          called here, once it is near, visible and allowed. }}
      <video
        class='pretui-ambient-video'
        src={{this.playableSrc}}
        poster={{@poster}}
        loop={{this.loop}}
        muted
        playsinline
        preload='auto'
        disablepictureinpicture
        disableremoteplayback
        tabindex='-1'
        aria-hidden='true'
        data-test-pretui-ambient-video-element
        {{this.engine}}
      ></video>
      {{#if this.showFallback}}
        <img
          class='pretui-ambient-fallback'
          src={{@fallback}}
          alt=''
          decoding='async'
          data-test-pretui-ambient-video-fallback
        />
      {{/if}}
      <span class='pretui-ambient-overlay'>{{yield to='overlay'}}</span>
      <button
        type='button'
        class='pretui-ambient-toggle'
        data-centred={{if this.awaitingPress 'true'}}
        aria-label={{this.controlLabel}}
        aria-pressed={{if this.playing 'true' 'false'}}
        data-test-pretui-ambient-video-toggle
        {{on 'click' this.toggle}}
      >
        {{#if this.playing}}
          <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
            <path d='M8 5h3v14H8zM13 5h3v14h-3z' fill='currentColor' />
          </svg>
        {{else if this.showFallback}}
          <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
            <path d='M8 5h3v14H8zM13 5h3v14h-3z' fill='currentColor' />
          </svg>
        {{else}}
          <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
            <path d='M8 5l11 7-11 7z' fill='currentColor' />
          </svg>
        {{/if}}
      </button>
    </figure>

    <style scoped>
      @layer PretComponent {
        .pretui-ambient {
          position: relative;
          margin: 0;
          aspect-ratio: var(--pretui-ambient-ratio, 16 / 9);
          overflow: hidden;
          border-radius: var(--pretui-ambient-radius, 0);
          background: var(--pretui-ambient-ground, var(--muted));
        }
        .pretui-ambient-video,
        .pretui-ambient-fallback {
          position: absolute;
          inset: 0;
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .pretui-ambient[data-fit='contain'] .pretui-ambient-video,
        .pretui-ambient[data-fit='contain'] .pretui-ambient-fallback {
          object-fit: contain;
        }
        .pretui-ambient-overlay {
          position: absolute;
          inset: auto 10px 10px auto;
          display: flex;
          gap: 6px;
          pointer-events: none;
        }
        /* The control sits on arbitrary pixels, not on a surface, so it is a
           media scrim with light ink, as on every video player. */
        .pretui-ambient-toggle {
          position: absolute;
          inset: auto auto 10px 10px;
          display: inline-grid;
          place-items: center;
          width: 36px;
          height: 36px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: var(--pretui-media-control, rgb(12 12 14 / 0.56));
          color: var(--pretui-on-neutral, #fff);
          cursor: pointer;
          backdrop-filter: blur(8px);
        }
        .pretui-ambient-toggle svg {
          width: 15px;
          height: 15px;
        }
        .pretui-ambient-toggle[data-centred] {
          inset: 50% auto auto 50%;
          width: 64px;
          height: 64px;
          transform: translate(-50%, -50%);
        }
        .pretui-ambient-toggle[data-centred] svg {
          width: 26px;
          height: 26px;
        }
        .pretui-ambient-toggle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        @media (any-pointer: coarse) {
          .pretui-ambient-toggle {
            width: 44px;
            height: 44px;
          }
        }
      }
    </style>
  </template>
}
