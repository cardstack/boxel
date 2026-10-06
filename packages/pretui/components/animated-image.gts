// Pretui — AnimatedImage: an animated image with a pause control that respects reduced motion.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { prefersReducedMotion } from '../internal/structure-morph';

// ── AnimatedImage ────────────────────────────────────────────────────────

/**
 * Pairs the `<img>` with a `<canvas>` that holds one frozen frame.
 *
 * The mechanism, and the one thing worth knowing about it: pausing does NOT
 * stop the image. Browsers expose no way to pause an animated GIF or WEBP,
 * and the two workarounds both lose the reader's place — reassigning `src`
 * restarts from frame 0, and `display: none` stops it in some engines and
 * not others. So the canvas is painted with the current frame and laid over
 * the image. Resuming is therefore SEAMLESS: the animation the reader comes
 * back to is the one that would have been playing, not a rewind.
 *
 * The cost is honest and worth stating: a paused image still decodes. If
 * that matters more than seamless resume, the caller should unrender the
 * component.
 */
const framePause = modifier(
  (root: HTMLElement, [playing, _src]: [boolean, string]) => {
    let image = root.querySelector('img');
    let canvas = root.querySelector('canvas');
    if (!image || !canvas) {
      return;
    }
    let img = image;
    let target = canvas;

    let freeze = () => {
      if (!img.complete || img.naturalWidth === 0) {
        root.dataset['frame'] = 'pending';
        return;
      }
      target.width = img.naturalWidth;
      target.height = img.naturalHeight;
      let context = target.getContext('2d');
      if (!context) {
        return;
      }
      try {
        context.drawImage(img, 0, 0);
      } catch {
        // A cross-origin image without CORS headers taints the canvas.
        // drawImage itself is allowed, but be defensive: if anything here
        // throws, fall back to simply letting the image play rather than
        // showing a blank white box over it.
        root.dataset['frame'] = 'unavailable';
        return;
      }
      root.dataset['frame'] = 'frozen';
    };

    // The image may not have decoded yet on first render — freeze once it
    // has, so a component that starts paused (which it does under reduced
    // motion) still shows a frame rather than nothing.
    let onLoad = () => {
      if (!playing) {
        freeze();
      }
    };
    img.addEventListener('load', onLoad);

    if (playing) {
      root.dataset['frame'] = 'playing';
    } else {
      freeze();
    }

    return () => {
      img.removeEventListener('load', onLoad);
    };
  },
);

export interface AnimatedImageSignature {
  Args: {
    /** Source of the animated image (GIF, animated WEBP, animated PNG). */
    src: string;
    /** Alternative text. Required, and required to describe the CONTENT —
     * "an animation of…" is what the control beside it already says. */
    alt: string;
    /** Controlled playback. Omit for uncontrolled. */
    playing?: boolean;
    /** Initial playback for the uncontrolled case. Defaults to `false` when
     * the reader has asked for reduced motion and `true` otherwise. */
    defaultPlaying?: boolean;
    /** Fires with the next playback state on every change. */
    onPlayingChange?: (playing: boolean) => void;
    /** Hide the built-in control. Only do this when the caller supplies its
     * own — an animation with no pause fails WCAG 2.2.2. */
    hideControl?: boolean;
  };
  Element: HTMLDivElement;
}

/**
 * An animated image that can actually be stopped.
 *
 * ```hbs
 * <AnimatedImage @src={{this.loopUrl}} @alt='The kettle coming to boil' />
 * ```
 *
 * Better than the inspiration (`wa-animated-image`): upstream always
 * autoplays, which is a WCAG 2.2.2 failure the moment the loop runs past
 * five seconds and a `prefers-reduced-motion` failure regardless. Here the
 * default respects the reader's stated preference, the control is a real
 * `<button>` with a name that changes with its state (not an icon with a
 * fixed label), the playing state is announced politely, and pause is
 * frame-accurate rather than a restart.
 */
export class AnimatedImage extends Component<AnimatedImageSignature> {
  @tracked private internalPlaying: boolean | undefined = undefined;

  get playing(): boolean {
    if (this.args.playing !== undefined) {
      return this.args.playing;
    }
    if (this.internalPlaying !== undefined) {
      return this.internalPlaying;
    }
    return this.args.defaultPlaying ?? !prefersReducedMotion();
  }

  get controlLabel(): string {
    return this.playing ? 'Pause animation' : 'Play animation';
  }

  get status(): string {
    return this.playing ? 'Animation playing' : 'Animation paused';
  }

  toggle = () => {
    let next = !this.playing;
    if (this.args.playing === undefined) {
      this.internalPlaying = next;
    }
    this.args.onPlayingChange?.(next);
  };

  <template>
    <div
      class='pretui-animated'
      data-playing={{if this.playing 'true' 'false'}}
      data-test-pretui-animated-image
      {{framePause this.playing @src}}
      ...attributes
    >
      <img class='pretui-animated-img' src={{@src}} alt={{@alt}} />
      {{! The frozen frame. aria-hidden because the <img> beside it already
          carries the alternative text — announcing both is a stutter. }}
      <canvas class='pretui-animated-canvas' aria-hidden='true'></canvas>

      {{#unless @hideControl}}
        <button
          type='button'
          class='pretui-animated-control'
          aria-label={{this.controlLabel}}
          data-test-pretui-animated-toggle
          {{on 'click' this.toggle}}
        >
          <span
            class='pretui-animated-glyph'
            data-glyph={{if this.playing 'pause' 'play'}}
            aria-hidden='true'
          ></span>
        </button>
      {{/unless}}

      <p class='pretui-sr' role='status'>{{this.status}}</p>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-animated {
          position: relative;
          display: block;
          inline-size: fit-content;
          max-inline-size: 100%;
          border-radius: var(--radius-surface, 10px);
          overflow: hidden;
          background: var(--muted);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
          font-family: var(--font-sans);
        }
        .pretui-animated-img {
          display: block;
          max-inline-size: 100%;
          block-size: auto;
        }
        .pretui-animated-canvas {
          position: absolute;
          inset: 0;
          inline-size: 100%;
          block-size: 100%;
          opacity: 0;
          pointer-events: none;
        }
        /* The canvas only covers the image once it actually holds a frame —
           `pending` and `unavailable` both leave the live image showing rather
           than painting a blank rectangle over it. */
        .pretui-animated[data-playing='false'] .pretui-animated-canvas {
          opacity: 1;
        }
        .pretui-animated[data-playing='false'][data-frame='pending']
          .pretui-animated-canvas,
        .pretui-animated[data-playing='false'][data-frame='unavailable']
          .pretui-animated-canvas {
          opacity: 0;
        }
        .pretui-animated-control {
          position: absolute;
          inset-block-end: var(--space-3, 8px);
          inset-inline-start: var(--space-3, 8px);
          inline-size: 34px;
          block-size: 34px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 999px;
          background: color-mix(in oklch, var(--card) 84%, transparent);
          color: var(--foreground);
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.3)
          );
          cursor: pointer;
          backdrop-filter: blur(6px);
        }
        @media (any-pointer: coarse) {
          .pretui-animated-control {
            inline-size: 44px;
            block-size: 44px;
          }
        }
        .pretui-animated-control:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* CSS glyphs rather than svg: lint's require-presentational-children
           rejects any <svg> inside a button subtree. */
        .pretui-animated-glyph {
          position: relative;
          inline-size: 12px;
          block-size: 12px;
        }
        .pretui-animated-glyph[data-glyph='play'] {
          inline-size: 0;
          block-size: 0;
          border-block-start: 6px solid transparent;
          border-block-end: 6px solid transparent;
          border-inline-start: 10px solid currentColor;
          margin-inline-start: 3px;
        }
        .pretui-animated-glyph[data-glyph='pause']::before,
        .pretui-animated-glyph[data-glyph='pause']::after {
          content: '';
          position: absolute;
          inset-block: 0;
          inline-size: 4px;
          background: currentColor;
          border-radius: 1px;
        }
        .pretui-animated-glyph[data-glyph='pause']::before {
          inset-inline-start: 0;
        }
        .pretui-animated-glyph[data-glyph='pause']::after {
          inset-inline-end: 0;
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          margin: 0;
        }
      }
    </style>
  </template>
}
