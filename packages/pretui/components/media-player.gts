// Pretui — MediaPlayer: native audio and video on Media Chrome, with captions, chapters and a transcript.
//
// `MediaPlayer` is one contract for audio and video, built on Media Chrome
// 4.19.2 (MIT, vendored at ./media-chrome — see that folder's README for the
// licence, the build command and the audit). `AudioPlayer` and `VideoPlayer`
// are skins over it, in the wrap-and-curry idiom Law 10 names (Tag wraps
// Pill): they add defaults and a little chrome of their own and forward
// everything else.
//
// WHY MEDIA CHROME AND NOT A PLAYER — it is the foundation every skin can
// ride, and a checkout confirms why:
//
//   • Pure Web Components. In Glimmer a custom element is just a tag, so
//     there is no adapter, no wrapper component per control, and no React.
//   • It is themed exclusively through `--media-*` custom properties, which
//     cross the shadow boundary. That is our theming contract exactly:
//     every value below is a Pretui token, so a season recompile re-dresses
//     the player and there is not one dark branch anywhere in this file.
//   • It disposes itself. `disconnectedCallback` stops the one rAF loop
//     (the time-range playhead), clears the auto-hide timeout, disconnects
//     both observers and unbinds every listener. Glimmer destroying the
//     element is enough: the element lifecycle owns the frame loop, so
//     nothing here needs a modifier to police it.
//
// BETTER THAN THE INSPIRATION — what Media Chrome's own defaults get wrong,
// and what this file does instead:
//
//   1. `autohide` is ON by default, so after two seconds the controls are
//      invisible but still focusable, which is worse than no control. Pretui defaults to `noautohide`, and
//      when a caller opts into cinema behaviour an outer-tree rule re-shows
//      the bar on `:focus-within`. (Outer-tree rules on a slotted child beat
//      the shadow root's `::slotted()` rules, whatever their specificity.)
//   2. The captions, PiP and fullscreen buttons render whether or not they
//      can do anything. Here they are conditional: no text tracks, no
//      captions button.
//   3. Buffering is a spinning glyph and nothing else, and the spinner keeps
//      spinning under `prefers-reduced-motion`. Here every transport state
//      also has a text channel, and reduced motion hides the spinner and
//      leans on the text (Law 5's end state).
//   4. There is no transcript surface at all, and a player without a track
//      channel is incomplete; this one renders a real,
//      seekable transcript in a native `<details>`, with the active cue
//      marked by `aria-current`.
//   5. Nothing reserves space, so the layout jumps when the poster resolves.
//      Here the stage carries `aspect-ratio` from the first paint.
//
// DELIBERATELY NOT HERE: autoplay (there is no `@autoplay` arg and there
// will not be one), and any object-URL creation — `@src` is passed through
// untouched, so if you hand it a blob URL you still own revoking it.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import type { SafeString } from '@ember/template';
import { modifier } from 'ember-modifier';
import { formatClock } from '../internal/reading-format';

// Side-effect import: evaluating the bundle DEFINES the custom elements.
// It is DOM-free (Media Chrome ships a server-safe globals shim), which is
// why it is safe at module scope in a realm — verified by evaluating this
// exact file under plain Node. See ./media-chrome/README.md.
import '../media-chrome/index.js';

// ── Shared media vocabulary ──────────────────────────────────────────────

/** What a `MediaPlayer` is playing. Image and model kinds live on
 * `MediaViewer`, which routes them to their own adapters. */
export type MediaKind = 'audio' | 'video';

/** Presets for how much chrome the player wears. */
export type MediaChrome = 'full' | 'compact' | 'minimal' | 'none';

/** One `<track>`. `isDefault` rather than `default` because `default` reads
 * badly as a property in both TypeScript and a Glimmer path. */
export interface MediaTrackSpec {
  /** URL of the WebVTT file. */
  src: string;
  /** Human label shown in the captions UI ("English", "Deutsch"). */
  label: string;
  /** BCP-47 language tag. */
  srclang: string;
  /** WebVTT track kind. Defaults to `'captions'`. */
  kind?: 'captions' | 'subtitles' | 'descriptions' | 'chapters';
  /** Mark this the default track for its kind. */
  isDefault?: boolean;
}

/** One transcript line. Times are seconds from the start of the media. */
export interface TranscriptCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds; used only to decide which cue is current. */
  end: number;
  /** The spoken text. */
  text: string;
  /** Optional speaker attribution, rendered as a separate channel. */
  speaker?: string;
}

/** The transport state a `MediaPlayer` reports. Every value has a text
 * channel in the UI — none of them is signalled by colour alone. */
export type MediaPhase =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

/** An immutable read of the media element, pushed on media events only. */
export interface MediaSnapshot {
  phase: MediaPhase;
  currentTime: number;
  duration: number;
  errorMessage: string;
}

const IDLE_SNAPSHOT: MediaSnapshot = {
  phase: 'idle',
  currentTime: 0,
  duration: 0,
  errorMessage: '',
};

// Monotonic per module load; see `transcriptId`.
let TRANSCRIPT_SEQ = 0;

const EMPTY_TRACKS: readonly MediaTrackSpec[] = [];
const EMPTY_CUES: readonly TranscriptCue[] = [];

// The four `MediaError` codes, in plain language. The browser's own
// `message` is empty in most engines, so a mapping is not a nicety.
const MEDIA_ERROR_TEXT: Record<number, string> = {
  1: 'Playback was stopped before the media finished loading.',
  2: 'The network dropped while the media was loading.',
  3: 'The media is damaged, or uses a codec this browser cannot decode.',
  4: 'This media format or address cannot be played here.',
};

/** An ISO-8601 duration for `<time datetime>`, so a transcript timestamp is
 * machine-readable and not just ink. */
export function isoMediaTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor(whole / 60) % 60;
  const secs = whole % 60;
  return `PT${hours}H${mins}M${secs}S`;
}

// A caller string lands in a custom property, so it is filtered rather than
// trusted: digits, dot, slash and space are everything `aspect-ratio` needs,
// and nothing in that set can close a declaration.
const ASPECT_ALLOWED = /[^0-9./ ]/g;
function safeAspect(value: string | undefined): string {
  const cleaned = (value ?? '').replace(ASPECT_ALLOWED, '').trim();
  return cleaned.length > 0 ? cleaned : '16 / 9';
}

// ── The one modifier: element capture + event subscription ───────────────
//
// Everything this player knows about playback arrives on media events —
// there is no polling and no frame loop, which is the arrangement Appendix
// M.3 asks for ("prefer event-driven state where it exists"). The modifier
// owns the listeners and removes every one of them in its destructor.
//
// It deliberately does NOT push a snapshot on install: a modifier body runs
// inside the render transaction, and a tracked write there is the
// backtracking-rerender assertion. The first real snapshot arrives with
// `loadedmetadata`, a few milliseconds later, and `IDLE_SNAPSHOT` is a
// truthful description of the gap.
const BASE_EVENTS = [
  'loadedmetadata',
  'durationchange',
  'canplay',
  'play',
  'playing',
  'pause',
  'ended',
  'waiting',
  'stalled',
  'emptied',
  'error',
];
const TIME_EVENTS = ['timeupdate', 'seeked'];

function readSnapshot(el: HTMLMediaElement): MediaSnapshot {
  const failure = el.error;
  const currentTime = Number.isFinite(el.currentTime) ? el.currentTime : 0;
  const duration = Number.isFinite(el.duration) ? el.duration : 0;
  if (failure) {
    return {
      phase: 'error',
      currentTime,
      duration,
      errorMessage:
        MEDIA_ERROR_TEXT[failure.code] ?? 'This media could not be played.',
    };
  }
  let phase: MediaPhase;
  if (el.ended) {
    phase = 'ended';
  } else if (el.readyState < 1 && el.networkState === 2) {
    phase = 'loading';
  } else if (!el.paused && el.readyState < 3) {
    phase = 'buffering';
  } else if (el.paused) {
    phase = el.readyState < 1 ? 'idle' : 'paused';
  } else {
    phase = 'playing';
  }
  return { phase, currentTime, duration, errorMessage: '' };
}

const mediaBridge = modifier(
  (
    el: HTMLMediaElement,
    [onElement, onSnapshot, withTime]: [
      (media: HTMLMediaElement | null) => void,
      (snapshot: MediaSnapshot) => void,
      boolean,
    ],
  ) => {
    // Untracked write, so this is safe inside the render transaction.
    onElement(el);
    const push = () => onSnapshot(readSnapshot(el));
    const names = withTime ? BASE_EVENTS.concat(TIME_EVENTS) : BASE_EVENTS;
    for (const name of names) {
      el.addEventListener(name, push);
    }
    return () => {
      for (const name of names) {
        el.removeEventListener(name, push);
      }
      onElement(null);
    };
  },
);

// ── MediaPlayer ──────────────────────────────────────────────────────────

export interface MediaPlayerSignature {
  Args: {
    /** URL of the media. Passed through untouched — the player never builds
     * or revokes an object URL, so a blob URL stays the caller's to revoke. */
    src?: string;
    /** `'video'` (default) or `'audio'`. Audio mode lays the transport out
     * in normal flow instead of over a picture. */
    kind?: MediaKind;
    /** Accessible name for the player region, and the heading when one is
     * shown. Strongly recommended: an unnamed region is a dead end for a
     * screen-reader user moving by landmark. */
    label?: string;
    /** Poster image for video. Also the thing that makes the reserved space
     * useful rather than merely blank. */
    poster?: string;
    /** A tiny inline placeholder (data URI or blurhash-style image) painted
     * under the poster while the poster itself loads. */
    placeholder?: string;
    /** Aspect ratio for the stage, as a CSS `aspect-ratio` value. Reserved
     * from the first paint so nothing reflows (Law 8's corollary).
     * @default '16 / 9' */
    aspectRatio?: string;
    /** Text tracks. Captions/subtitles get a captions button; descriptions
     * and chapters ride along for the browser and the scrubber. */
    tracks?: readonly MediaTrackSpec[];
    /** URL of a WebVTT thumbnails track. Present ⇒ the scrubber shows a
     * preview image while seeking. */
    thumbnails?: string;
    /** A seekable transcript. Rendered in a native `<details>`; the cue
     * containing the playhead carries `aria-current`. */
    transcript?: readonly TranscriptCue[];
    /** Open the transcript disclosure on first paint. @default false */
    transcriptOpen?: boolean;
    /** Turn on the first subtitles track without the reader asking.
     * @default false */
    captionsDefault?: boolean;
    /** How much chrome to wear. `'none'` renders an empty bar for the
     * `<:controls>` block to fill. @default 'full' */
    chrome?: MediaChrome;
    /** Seconds for the skip buttons and the ←/→ hotkeys. @default 10 */
    seekOffset?: number;
    /** Let the controls fade out during playback (Media Chrome's own
     * default, which Pretui inverts). Focus always brings them back.
     * @default false */
    autoHide?: boolean;
    /** Loop the media. @default false */
    loop?: boolean;
    /** Start muted. Not autoplay — there is no autoplay here. @default false */
    muted?: boolean;
    /** `<video preload>`. @default 'metadata' */
    preload?: 'none' | 'metadata' | 'auto';
    /** `crossorigin` on the media element. Cross-origin `<track>` files
     * need `'anonymous'` here or the browser drops them silently. */
    crossOrigin?: 'anonymous' | 'use-credentials';
    /** Hide the status line under the transport. The line is the text
     * channel for buffering and error state — turn it off only when the
     * host shows the same thing elsewhere. @default false */
    quietStatus?: boolean;
    /** Fires on every media event with the current snapshot. */
    onSnapshot?: (snapshot: MediaSnapshot) => void;
  };
  Blocks: {
    /** Floats over the picture, top-left: a live pill, a rights badge. Not
     * pointer-interactive by default so it never steals a click from the
     * gesture layer — set `pointer-events: auto` on your own control. */
    overlay: [];
    /** Appended INSIDE the control bar, just before fullscreen. Combine
     * with `@chrome='none'` to own the bar completely. */
    controls: [];
    /** Under the transport, above the transcript. */
    footer: [];
  };
  Element: HTMLDivElement;
}

interface TranscriptRow {
  index: number;
  start: number;
  clock: string;
  iso: string;
  speaker: string;
  text: string;
  isActive: boolean;
}

export class MediaPlayer extends Component<MediaPlayerSignature> {
  /** Snapshot of the media element. Written only from media events, which
   * are asynchronous — never during render. */
  @tracked private snapshot: MediaSnapshot = IDLE_SNAPSHOT;

  /** Plain field on purpose: it is a handle for event handlers to act on,
   * never something the template reads, so making it tracked would turn
   * every install into a re-render dependency. */
  private media: HTMLMediaElement | null = null;

  private takeElement = (media: HTMLMediaElement | null) => {
    this.media = media;
  };

  private takeSnapshot = (snapshot: MediaSnapshot) => {
    this.snapshot = snapshot;
    this.args.onSnapshot?.(snapshot);
  };

  seekTo = (seconds: number) => {
    const media = this.media;
    if (media && Number.isFinite(seconds)) {
      media.currentTime = Math.max(0, seconds);
    }
  };

  // ── shape ──────────────────────────────────────────────────────────────

  get kind(): MediaKind {
    return this.args.kind ?? 'video';
  }
  get isAudio(): boolean {
    return this.kind === 'audio';
  }
  get chrome(): MediaChrome {
    return this.args.chrome ?? 'full';
  }
  get seekOffset(): number {
    return this.args.seekOffset ?? 10;
  }
  get seekOffsetText(): string {
    return String(this.seekOffset);
  }
  get preload(): string {
    return this.args.preload ?? 'metadata';
  }
  get hostStyle(): SafeString {
    return htmlSafe(`--pretui-media-aspect: ${safeAspect(this.args.aspectRatio)}`);
  }

  // Boolean attributes, and the trap under them. Glimmer binds a dynamic
  // attribute through the PROPERTY when the element has one — and every
  // name here is a property: `details.open`, `video.loop`, `video.muted`,
  // and Media Chrome's own `audio`/`noautohide`/`defaultsubtitles`
  // accessors. So the value has to be truthy as a *value*, not merely
  // present as an attribute: `''` sets `el.open = ''`, which is false, and
  // the element silently does nothing. `true` is correct on both paths —
  // it sets the property, or writes `="true"`, which is present.
  // (`false` would be wrong the other way: it writes the string "false",
  // and a present attribute is true. Hence `undefined` to remove.)
  private flag(wanted: boolean): true | undefined {
    return wanted ? true : undefined;
  }
  get audioAttr(): true | undefined {
    return this.flag(this.isAudio);
  }
  get noAutohideAttr(): true | undefined {
    return this.flag(!(this.args.autoHide ?? false));
  }
  get defaultSubtitlesAttr(): true | undefined {
    return this.flag(this.args.captionsDefault ?? false);
  }
  get loopAttr(): true | undefined {
    return this.flag(this.args.loop ?? false);
  }
  get mutedAttr(): true | undefined {
    return this.flag(this.args.muted ?? false);
  }

  // ── tracks ─────────────────────────────────────────────────────────────

  get tracks(): readonly MediaTrackSpec[] {
    return this.args.tracks ?? EMPTY_TRACKS;
  }
  get hasCaptions(): boolean {
    return this.tracks.some((track) => {
      const kind = track.kind ?? 'captions';
      return kind === 'captions' || kind === 'subtitles';
    });
  }
  get captionCount(): number {
    return this.tracks.length;
  }

  // ── chrome presets ─────────────────────────────────────────────────────
  // Four named steps rather than nine booleans (Law 7 wants named knobs, not
  // a switchboard); anything finer is `@chrome='none'` plus `<:controls>`.

  get showScrubber(): boolean {
    return this.chrome !== 'none';
  }
  get showSkip(): boolean {
    return this.chrome === 'full';
  }
  get showTime(): boolean {
    return this.chrome === 'full' || this.chrome === 'compact';
  }
  get showVolume(): boolean {
    return this.chrome === 'full' || this.chrome === 'compact';
  }
  get showRate(): boolean {
    return this.chrome === 'full';
  }
  get showCaptions(): boolean {
    return this.chrome !== 'none' && this.hasCaptions;
  }
  get showPip(): boolean {
    return this.chrome === 'full' && !this.isAudio;
  }
  get showFullscreen(): boolean {
    return this.chrome !== 'none' && !this.isAudio;
  }

  // ── status: the text channel ───────────────────────────────────────────

  get phase(): MediaPhase {
    return this.snapshot.phase;
  }
  get statusText(): string {
    switch (this.phase) {
      case 'loading':
        return 'Loading media';
      case 'buffering':
        return 'Buffering';
      case 'playing':
        return 'Playing';
      case 'paused':
        return 'Paused';
      case 'ended':
        return 'Ended';
      case 'error':
        return this.snapshot.errorMessage;
      default:
        return 'Ready';
    }
  }
  get statusGlyph(): string {
    switch (this.phase) {
      case 'loading':
      case 'buffering':
        return '···';
      case 'playing':
        return '▶';
      case 'paused':
        return '❚❚';
      case 'ended':
        return '■';
      case 'error':
        return '!';
      default:
        return '○';
    }
  }
  get showStatus(): boolean {
    return !(this.args.quietStatus ?? false);
  }
  /** The live region says one thing and says it rarely: a failure. Play,
   * pause and seek are already announced by the transport buttons' own
   * labels, and repeating them would be the "announces per keystroke"
   * failure. */
  get announcement(): string {
    return this.phase === 'error' ? this.snapshot.errorMessage : '';
  }
  get durationText(): string {
    return formatClock(this.snapshot.duration);
  }

  // ── transcript ─────────────────────────────────────────────────────────

  get transcript(): readonly TranscriptCue[] {
    return this.args.transcript ?? EMPTY_CUES;
  }
  get hasTranscript(): boolean {
    return this.transcript.length > 0;
  }
  /** Subscribing to `timeupdate` costs a re-render four times a second, so
   * it is only subscribed when something on screen actually moves with the
   * playhead. */
  get wantsTime(): boolean {
    return this.hasTranscript;
  }
  /** Uncontrolled disclosure state: `undefined` means "@transcriptOpen
   * still applies", so a caller flipping the arg is still obeyed until the
   * reader touches the toggle. */
  @tracked private transcriptToggled: boolean | undefined = undefined;

  get transcriptExpanded(): boolean {
    return this.transcriptToggled ?? (this.args.transcriptOpen ?? false);
  }
  toggleTranscript = () => {
    this.transcriptToggled = !this.transcriptExpanded;
  };
  /** A per-instance id for `aria-controls`. A module counter, not a random
   * or a timestamp — both are forbidden, and neither is needed: the id has
   * to be unique in a document, not unguessable. */
  private uid = ++TRANSCRIPT_SEQ;
  get transcriptId(): string {
    return `pretui-transcript-${this.uid}`;
  }
  get transcriptRows(): TranscriptRow[] {
    const now = this.snapshot.currentTime;
    return this.transcript.map((cue, index) => ({
      index,
      start: cue.start,
      clock: formatClock(cue.start),
      iso: isoMediaTime(cue.start),
      speaker: cue.speaker ?? '',
      text: cue.text,
      isActive: now >= cue.start && now < cue.end,
    }));
  }
  get transcriptSummary(): string {
    const count = this.transcript.length;
    return count === 1 ? '1 line' : `${count} lines`;
  }

  <template>
    <div
      class='pretui-media'
      role={{if @label 'region'}}
      aria-label={{@label}}
      style={{this.hostStyle}}
      data-kind={{this.kind}}
      data-phase={{this.phase}}
      data-test-pretui-media-player
      ...attributes
    >
      <media-controller
        class='pretui-media-stage'
        audio={{this.audioAttr}}
        noautohide={{this.noAutohideAttr}}
        defaultsubtitles={{this.defaultSubtitlesAttr}}
        keyboardforwardseekoffset={{this.seekOffsetText}}
        keyboardbackwardseekoffset={{this.seekOffsetText}}
        data-test-pretui-media-controller
      >
        {{#if this.isAudio}}
          <audio
            slot='media'
            aria-label={{@label}}
            src={{@src}}
            preload={{this.preload}}
            crossorigin={{@crossOrigin}}
            loop={{this.loopAttr}}
            muted={{this.mutedAttr}}
            data-test-pretui-media-element
            {{mediaBridge this.takeElement this.takeSnapshot this.wantsTime}}
          >
            {{#each this.tracks as |part|}}
              <track
                kind={{if part.kind part.kind 'captions'}}
                src={{part.src}}
                srclang={{part.srclang}}
                label={{part.label}}
                default={{if part.isDefault true}}
              />
            {{/each}}
          </audio>
        {{else}}
          <video
            slot='media'
            aria-label={{@label}}
            src={{@src}}
            preload={{this.preload}}
            crossorigin={{@crossOrigin}}
            loop={{this.loopAttr}}
            muted={{this.mutedAttr}}
            playsinline
            data-test-pretui-media-element
            {{mediaBridge this.takeElement this.takeSnapshot this.wantsTime}}
          >
            {{#each this.tracks as |part|}}
              <track
                kind={{if part.kind part.kind 'captions'}}
                src={{part.src}}
                srclang={{part.srclang}}
                label={{part.label}}
                default={{if part.isDefault true}}
              />
            {{/each}}
            {{#if @thumbnails}}
              <track kind='metadata' label='thumbnails' src={{@thumbnails}} />
            {{/if}}
          </video>
        {{/if}}

        {{#unless this.isAudio}}
          {{#if @poster}}
            <media-poster-image
              slot='poster'
              src={{@poster}}
              placeholdersrc={{@placeholder}}
            ></media-poster-image>
          {{/if}}
          <media-loading-indicator
            slot='centered-chrome'
            noautohide
          ></media-loading-indicator>
        {{/unless}}

        <media-error-dialog></media-error-dialog>

        {{! the overlay collapses to nothing when the block is empty — see
            .pretui-media-overlay:empty, which is why the yield is written
            flush against the tags }}
        <div
          class='pretui-media-overlay'
          slot='centered-chrome'
        >{{yield to='overlay'}}</div>

        {{#if this.showScrubber}}
          <media-control-bar class='pretui-media-scrub'>
            <media-time-range></media-time-range>
          </media-control-bar>
        {{/if}}

        <media-control-bar class='pretui-media-bar'>
          {{#if this.showScrubber}}
            <media-play-button></media-play-button>
          {{/if}}
          {{#if this.showSkip}}
            <media-seek-backward-button
              seekoffset={{this.seekOffsetText}}
            ></media-seek-backward-button>
            <media-seek-forward-button
              seekoffset={{this.seekOffsetText}}
            ></media-seek-forward-button>
          {{/if}}
          {{#if this.showTime}}
            <media-time-display showduration></media-time-display>
          {{/if}}
          <span class='pretui-media-gap'></span>
          <span class='pretui-media-slot'>{{yield to='controls'}}</span>
          {{#if this.showCaptions}}
            <media-captions-button></media-captions-button>
          {{/if}}
          {{#if this.showRate}}
            <media-playback-rate-button
              rates='0.5 1 1.25 1.5 2'
            ></media-playback-rate-button>
          {{/if}}
          {{#if this.showVolume}}
            <media-mute-button></media-mute-button>
            <media-volume-range class='pretui-media-volume'></media-volume-range>
          {{/if}}
          {{#if this.showPip}}
            <media-pip-button></media-pip-button>
          {{/if}}
          {{#if this.showFullscreen}}
            <media-fullscreen-button></media-fullscreen-button>
          {{/if}}
        </media-control-bar>
      </media-controller>

      {{#if this.showStatus}}
        <p class='pretui-media-status' data-test-pretui-media-status>
          <span class='pretui-media-statusGlyph' aria-hidden='true'>{{this.statusGlyph}}</span>
          <span class='pretui-media-statusText'>{{this.statusText}}</span>
          {{#if this.snapshot.duration}}
            <span class='pretui-media-statusDur'>{{this.durationText}}</span>
          {{/if}}
        </p>
      {{/if}}

      {{! always present, always empty until a load fails — an aria-live
          element inserted with text already in it is not reliably announced }}
      <p
        class='pretui-media-live'
        role='status'
        aria-live='polite'
      >{{this.announcement}}</p>

      <div class='pretui-media-footer'>{{yield to='footer'}}</div>

      {{! An APG disclosure rather than <details>/<summary>, and NOT by
          preference: realm lint's `no-nested-interactive` counts <details>
          as interactive and rejects any <button> inside it, cue buttons
          included. The platform element would have been the better answer
          (platform behaviour before JS re-implementation) — it
          is unavailable here, so the replacement carries the full
          contract instead: a real button, aria-expanded, aria-controls,
          and a region that stays in the DOM and hides with `hidden`, so
          the id aria-controls names always resolves. }}
      {{#if this.hasTranscript}}
        <div
          class='pretui-media-transcript'
          data-open={{if this.transcriptExpanded 'true' 'false'}}
          data-test-pretui-media-transcript
        >
          <button
            type='button'
            class='pretui-media-transcriptHead'
            aria-expanded={{if this.transcriptExpanded 'true' 'false'}}
            aria-controls={{this.transcriptId}}
            data-test-pretui-media-transcript-toggle
            {{on 'click' this.toggleTranscript}}
          >
            <span class='pretui-media-transcriptCaret' aria-hidden='true'>▸</span>
            <span class='pretui-media-transcriptTitle'>Transcript</span>
            <span class='pretui-media-transcriptCount'>{{this.transcriptSummary}}</span>
          </button>
          <ol
            class='pretui-media-cues'
            id={{this.transcriptId}}
            hidden={{unless this.transcriptExpanded true}}
          >
            {{#each this.transcriptRows key='index' as |row|}}
              <li class='pretui-media-cue'>
                <button
                  type='button'
                  class='pretui-media-cueBtn'
                  aria-current={{if row.isActive 'true'}}
                  data-active={{if row.isActive 'true'}}
                  data-test-pretui-media-cue
                  {{on 'click' (fn this.seekTo row.start)}}
                >
                  <span class='pretui-media-cueClock'>{{row.clock}}</span>
                  <span class='pretui-media-cueBody'>
                    {{#if row.speaker}}<span
                        class='pretui-media-cueSpeaker'
                      >{{row.speaker}}</span>{{/if}}
                    <span class='pretui-media-cueText'>{{row.text}}</span>
                  </span>
                </button>
              </li>
            {{/each}}
          </ol>
        </div>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        /* ── The token bridge ────────────────────────────────────────────
           Media Chrome is themed ONLY through --media-* custom properties,
           which is the one channel that crosses a shadow boundary. Every
           value below is a Pretui token with a light-value fallback, so the
           player re-tints with a season it has never seen and there is not
           one dark branch in this file. */
        .pretui-media {
          --pretui-media-aspect: 16 / 9;
          --pretui-media-ink: var(--card);
          --pretui-media-scrim: color-mix(
            in oklch,
            var(--foreground) 62%,
            transparent
          );
          --pretui-media-radius: var(--radius);

          --media-font-family: var(--font-sans);
          --media-font-size: var(--text-ui-sm, 11.5px);
          --media-font-weight: 500;
          --media-primary-color: var(--pretui-media-ink, var(--boxel-light));
          --media-secondary-color: transparent;
          --media-control-background: transparent;
          --media-control-hover-background: color-mix(
            in oklch,
            var(--pretui-media-ink, var(--boxel-light)) 18%,
            transparent
          );
          --media-control-height: 16px;
          --media-control-padding: 8px;
          --media-focus-box-shadow: inset 0 0 0 2px var(--ring);
          --media-range-track-height: 4px;
          --media-range-track-border-radius: 999px;
          --media-range-track-background: color-mix(
            in oklch,
            var(--pretui-media-ink, var(--boxel-light)) 26%,
            transparent
          );
          --media-range-bar-color: var(--primary);
          --media-time-range-buffered-color: color-mix(
            in oklch,
            var(--pretui-media-ink, var(--boxel-light)) 42%,
            transparent
          );
          --media-range-thumb-background: var(--pretui-media-ink, var(--boxel-light));
          --media-range-thumb-width: 12px;
          --media-range-thumb-height: 12px;
          --media-tooltip-background: var(--popover);
          --media-tooltip-border-radius: var(--radius-sm, 6px);
          --media-object-fit: contain;

          container-type: inline-size;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
          font-family: var(--font-sans);
        }

        /* Audio wears the page's ink, because its transport sits on the page
           rather than over a picture. One property flip, no second theme. */
        .pretui-media[data-kind='audio'] {
          --pretui-media-ink: var(--foreground);
          --media-control-hover-background: var(
            --hover,
            color-mix(in oklch, var(--foreground) 8%, transparent)
          );
        }

        .pretui-media-stage {
          --media-background-color: color-mix(
            in oklch,
            var(--foreground) 92%,
            var(--card)
          );
          aspect-ratio: var(--pretui-media-aspect);
          width: 100%;
          overflow: hidden;
          border-radius: var(--pretui-media-radius);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
        }

        .pretui-media[data-kind='audio'] .pretui-media-stage {
          --media-background-color: transparent;
          aspect-ratio: auto;
          background: var(--card);
          padding: 4px 4px 2px;
        }

        /* Law 8 — the picture is judged in a still frame, so the transport
           gets a legible ground rather than relying on the video being dark
           under it. A gradient, not a bar: the picture keeps its edge. */
        .pretui-media[data-kind='video'] .pretui-media-bar,
        .pretui-media[data-kind='video'] .pretui-media-scrub {
          background: linear-gradient(
            to top,
            var(--pretui-media-scrim),
            transparent
          );
        }
        .pretui-media[data-kind='video'] .pretui-media-scrub {
          background: none;
          padding-bottom: 0;
        }

        .pretui-media-bar {
          --media-control-bar-display: flex;
          align-items: center;
          gap: 2px;
          padding: 4px 6px 6px;
        }
        .pretui-media-scrub {
          padding: 0 6px;
        }
        .pretui-media-scrub media-time-range {
          width: 100%;
        }
        .pretui-media-gap {
          flex: 1 1 auto;
        }
        /* display: contents so an unfilled slot adds no box to the flex row */
        .pretui-media-slot {
          display: contents;
        }
        .pretui-media-volume {
          width: 68px;
        }

        /* A control that is focusable and invisible is worse
           than no control. When a caller opts into auto-hide, focus brings the
           bar straight back. Rules in the outer tree beat the shadow root's
           ::slotted() rules on a slotted child, so this needs no !important
           and no :deep(). */
        .pretui-media-stage:focus-within .pretui-media-bar,
        .pretui-media-stage:focus-within .pretui-media-scrub {
          opacity: 1;
          pointer-events: auto;
          visibility: visible;
        }

        .pretui-media-overlay {
          display: flex;
          align-self: start;
          justify-self: start;
          gap: 6px;
          margin: 8px;
          pointer-events: none;
        }
        .pretui-media-overlay:empty {
          display: none;
        }

        /* ── the text channel ─────────────────────────────────────────── */
        .pretui-media-status {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin: 0;
          min-height: 1.4em;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-media-statusGlyph {
          font-size: 9px;
          line-height: 1;
          color: var(--muted-foreground);
        }
        .pretui-media-statusText {
          min-width: 0;
        }
        .pretui-media[data-phase='error'] .pretui-media-statusText,
        .pretui-media[data-phase='error'] .pretui-media-statusGlyph {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          font-weight: 600;
        }
        .pretui-media-statusDur {
          margin-inline-start: auto;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        .pretui-media-live {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-media-footer:empty {
          display: none;
        }

        /* ── transcript ───────────────────────────────────────────────── */
        .pretui-media-transcript {
          border-radius: var(--radius);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          background: var(--card);
        }
        .pretui-media-transcriptHead {
          display: flex;
          align-items: baseline;
          gap: 10px;
          width: 100%;
          padding: 8px 12px;
          margin: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
          font-family: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-align: start;
          text-transform: uppercase;
          color: var(--foreground);
          border-radius: var(--radius);
        }
        .pretui-media-transcriptHead:hover {
          background: var(
            --hover,
            color-mix(in oklch, var(--foreground) 5%, transparent)
          );
        }
        .pretui-media-transcriptHead:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        /* The caret turns because the disclosure changed state — Law 5's
           "encodes a state transition", and the end state under reduced
           motion is simply the turned caret. */
        .pretui-media-transcriptCaret {
          display: inline-block;
          font-size: 9px;
          color: var(--muted-foreground);
          transition: rotate 140ms ease;
        }
        .pretui-media-transcript[data-open='true'] .pretui-media-transcriptCaret {
          rotate: 90deg;
        }
        .pretui-media-transcriptCount {
          font-weight: 400;
          letter-spacing: 0;
          text-transform: none;
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        .pretui-media-cues {
          list-style: none;
          margin: 0;
          padding: 0 6px 6px;
          max-height: 15rem;
          overflow-y: auto;
        }
        .pretui-media-cueBtn {
          display: flex;
          gap: 10px;
          width: 100%;
          padding: 5px 8px;
          border: 0;
          border-radius: var(--radius-sm, 6px);
          background: transparent;
          color: var(--foreground);
          font: inherit;
          font-size: var(--text-body, 14px);
          line-height: 1.5;
          text-align: start;
          cursor: pointer;
        }
        .pretui-media-cueBtn:hover {
          background: var(
            --hover,
            color-mix(in oklch, var(--foreground) 6%, transparent)
          );
        }
        .pretui-media-cueBtn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        /* The active cue is marked three ways — weight, a rule down the
           inline start, and aria-current — because state is never colour
           alone and this one has to survive greyscale. */
        .pretui-media-cueBtn[data-active='true'] {
          background: color-mix(
            in oklch,
            var(--primary) 10%,
            var(--card)
          );
          box-shadow: inset 2px 0 0 0 var(--primary);
          font-weight: 600;
        }
        .pretui-media-cueClock {
          flex: 0 0 auto;
          min-width: 4ch;
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11.5px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
          padding-top: 0.15em;
        }
        .pretui-media-cueBody {
          min-width: 0;
        }
        .pretui-media-cueSpeaker {
          display: block;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-media-cueText {
          display: block;
        }

        /* ── touch ────────────────────────────────────────────────────── */
        @media (any-pointer: coarse) {
          .pretui-media {
            --media-control-height: 22px;
            --media-control-padding: 11px;
            --media-range-thumb-width: 16px;
            --media-range-thumb-height: 16px;
          }
          .pretui-media-cueBtn {
            padding: 11px 8px;
          }
        }

        /* ── narrow panes ─────────────────────────────────────────────
           Unnamed container query only: a named one silently deletes every
           rule after it. Rules match descendants of the container, never the
           container element itself. */
        @container (max-width: 420px) {
          .pretui-media-volume {
            display: none;
          }
          .pretui-media-statusDur {
            display: none;
          }
        }

        /* ── Law 5 ────────────────────────────────────────────────────
           Reduced motion lands on the END state: the transport stops
           transitioning, and the spinner — which cannot be slowed from out
           here, it lives in a shadow root — is replaced by the text channel
           that is already on screen. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-media {
            --media-control-transition-in: none;
            --media-control-transition-out: none;
            --media-range-thumb-transition: none;
            --media-range-track-transition: none;
            --media-loading-indicator-display: none;
          }
          .pretui-media-cueBtn,
          .pretui-media-transcriptCaret {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
