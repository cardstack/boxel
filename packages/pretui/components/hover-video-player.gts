// Pretui — HoverVideoPlayer: a poster that previews its video on hover or focus, never against reduced motion.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

// ── HoverVideoPlayer ─────────────────────────────────────────────────────
// A thumbnail that becomes a moving preview when you show interest in it,
// and stops when you stop. Four things the genre routinely gets wrong, and
// what is done here instead:
//
//   1. **Touch.** Upstream binds `mouseenter`/`mouseleave` and is simply
//      dead on a phone. Here there is always a real play/pause `<button>`;
//      on fine pointers it fades in on hover or focus, on coarse pointers it
//      is permanently visible at 44px.
//   2. **Keyboard.** `focusin`/`focusout` drive the same path as the
//      pointer, so tabbing to the card previews it.
//   3. **Motion preference.** `prefers-reduced-motion: reduce` disables
//      hover- and focus-autoplay outright — a moving image is exactly what
//      that preference is about. The explicit button still works, because
//      the preference is about ambient motion, not about consent.
//   4. **Layout.** `@ratio` reserves the box before the poster loads, so a
//      grid of these does not reflow as they arrive.
//
// Playback is driven by ONE tracked boolean through a modifier; there is no
// timer, no rAF, and no listener that outlives the element.

/** hover/focus intent on the card, with every listener removed on teardown */
const previewIntent = modifier(
  (
    el: HTMLElement,
    [onEnter, onLeave]: [() => void, () => void],
  ) => {
    let enter = () => onEnter();
    let leave = () => onLeave();
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', enter);
    el.addEventListener('focusout', leave);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', enter);
      el.removeEventListener('focusout', leave);
    };
  },
);

/**
 * Playback follows one boolean. The modifier body re-runs whenever that
 * boolean changes, which is the whole scheduling mechanism — no interval
 * polls the element's state. `play()` can reject (a source that never
 * loaded, an autoplay policy), so the rejection is routed back to the
 * component instead of surfacing as an unhandled promise.
 */
const previewPlayback = modifier(
  (
    el: HTMLVideoElement,
    [playing, rewind, onFail]: [boolean, boolean, () => void],
  ) => {
    if (playing) {
      let started = el.play();
      if (started && typeof started.catch === 'function') {
        started.catch(() => onFail());
      }
      return;
    }
    el.pause();
    if (rewind && el.readyState > 0) {
      el.currentTime = 0;
    }
  },
);

export interface HoverVideoPlayerSignature {
  Args: {
    /** the preview clip */
    src: string;
    /** the still shown before and after playback */
    poster?: string;
    /**
     * what the preview is OF. Required: it names the play control and the
     * figure, and an unlabelled video is an unlabelled control.
     */
    label: string;
    /** aspect ratio reserving the box, e.g. '16 / 9' (default '16 / 9') */
    ratio?: string;
    /** keep it silent (default true — an unmuted hover preview is hostile) */
    muted?: boolean;
    /** loop the preview (default true) */
    loop?: boolean;
    /** rewind to the first frame when the preview stops (default true) */
    rewind?: boolean;
    /** preview on hover and focus (default true) */
    playOnIntent?: boolean;
    /** caption rendered under the frame */
    caption?: string;
    /** fires whenever playback starts or stops */
    onPlayingChange?: (playing: boolean) => void;
  };
  Blocks: {
    /** content laid over the frame — a duration chip, a title */
    overlay: [];
  };
  Element: HTMLElement;
}

export class HoverVideoPlayer extends Component<HoverVideoPlayerSignature> {
  @tracked private playing = false;

  get ratioStyle() {
    return cssStyleFrom([
      cssDeclaration('--pretui-hvp-ratio', this.args.ratio ?? '16 / 9'),
    ]);
  }
  get muted(): boolean {
    return this.args.muted ?? true;
  }
  get loop(): boolean {
    return this.args.loop ?? true;
  }
  get rewind(): boolean {
    return this.args.rewind ?? true;
  }
  get playOnIntent(): boolean {
    return this.args.playOnIntent ?? true;
  }
  get toggleLabel(): string {
    return (this.playing ? 'Pause preview of ' : 'Play preview of ') + this.args.label;
  }

  /** true when the reader has asked the platform for less movement */
  private get reducedMotion(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** NOT named `set` — an arrow property called `set` on a Glimmer class
   * trips ember/classic-decorator-no-classic-methods at realm lint, which
   * reads it as the classic `this.set()` API. */
  private setPlaying = (next: boolean) => {
    if (this.playing === next) {
      return;
    }
    this.playing = next;
    this.args.onPlayingChange?.(next);
  };

  enter = () => {
    if (!this.playOnIntent || this.reducedMotion) {
      return;
    }
    this.setPlaying(true);
  };

  leave = () => {
    if (!this.playOnIntent) {
      return;
    }
    this.setPlaying(false);
  };

  toggle = () => this.setPlaying(!this.playing);

  /** play() was refused; the control must not keep claiming it is playing */
  failed = () => this.setPlaying(false);

  <template>
    <figure
      class='pretui-hvp'
      data-playing={{if this.playing 'true'}}
      style={{this.ratioStyle}}
      data-test-pretui-hover-video-player
      {{previewIntent this.enter this.leave}}
      ...attributes
    >
      <div class='pretui-hvp-frame'>
        {{! The media element is decorative: it is named by the figcaption
            and driven by the button beside it, so it is out of the tab order
            and out of the accessibility tree rather than being a second,
            unlabelled control. }}
        <video
          class='pretui-hvp-video'
          src={{@src}}
          poster={{@poster}}
          muted={{if this.muted true}}
          loop={{if this.loop true}}
          playsinline={{true}}
          preload='metadata'
          tabindex='-1'
          aria-hidden='true'
          data-test-pretui-hover-video-player-video
          {{previewPlayback this.playing this.rewind this.failed}}
        ></video>
        <span class='pretui-hvp-overlay'>{{yield to='overlay'}}</span>
        <button
          type='button'
          class='pretui-hvp-toggle'
          aria-label={{this.toggleLabel}}
          aria-pressed={{if this.playing 'true' 'false'}}
          data-test-pretui-hover-video-player-toggle
          {{on 'click' this.toggle}}
        >
          {{#if this.playing}}
            <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
              <path d='M8 5h3v14H8zM13 5h3v14h-3z' fill='currentColor' />
            </svg>
          {{else}}
            <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
              <path d='M8 5l11 7-11 7z' fill='currentColor' />
            </svg>
          {{/if}}
        </button>
      </div>
      <figcaption class='pretui-hvp-caption'>
        {{#if @caption}}{{@caption}}{{else}}<span class='pretui-sr'
          >{{@label}}</span>{{/if}}
      </figcaption>
    </figure>

    <style scoped>
      @layer PretComponent {
        .pretui-hvp {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .pretui-hvp-frame {
          position: relative;
          aspect-ratio: var(--pretui-hvp-ratio, 16 / 9);
          border-radius: 10px;
          overflow: hidden;
          background: var(--inset, var(--boxel-100));
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-hvp-video {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .pretui-hvp-overlay {
          position: absolute;
          inset: auto 8px 8px auto;
          display: flex;
          gap: 5px;
          pointer-events: none;
        }
        .pretui-hvp-toggle {
          position: absolute;
          inset: auto auto 8px 8px;
          display: inline-grid;
          place-items: center;
          width: 32px;
          height: 32px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: color-mix(in oklch, var(--boxel-dark) 55%, transparent);
          color: var(--boxel-light);
          cursor: pointer;
          opacity: 0;
          transition: opacity 140ms linear;
        }
        .pretui-hvp-toggle svg {
          width: 15px;
          height: 15px;
        }
        /* hover is never the only affordance: focus-within reveals it too */
        .pretui-hvp:hover .pretui-hvp-toggle,
        .pretui-hvp:focus-within .pretui-hvp-toggle,
        .pretui-hvp[data-playing] .pretui-hvp-toggle {
          opacity: 1;
        }
        .pretui-hvp-toggle:focus-visible {
          opacity: 1;
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-hvp-caption {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        /* a coarse pointer has no hover state to reveal anything with */
        @media (any-pointer: coarse) {
          .pretui-hvp-toggle {
            opacity: 1;
            width: 44px;
            height: 44px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-hvp-toggle {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
