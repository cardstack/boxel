import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import type { StageSignature } from '../demo';
import { FilmFrame, type FilmName } from './film-frame';

/* THE WELL CAN BE RESIZED BY HAND, within reason. The film is responsive
   — resize its frame and the shot reframes, the type re-sets, the bar
   re-lays — and the demo lets a viewer prove that with a corner grip
   rather than a browser window. The picture stays CENTRED as it shrinks,
   the way a monitor in a grading suite does; the well itself does not
   move. The floor is a frame that still reads; the ceiling is the well.
   Double-click the grip, or the chip, to snap back. */
const SIZE_MIN = { h: 216, w: 384 } as const;

interface Size {
  h: number;
  w: number;
}

interface Signature {
  Args: StageSignature['Args'] & {
    film: FilmName;
    /** the well's ground, showing around a hand-sized frame */
    ground: string;
    /** whether the frame has a corner grip; it does unless this is false */
    resizable?: boolean;
    /** where a hand-set frame size is remembered, per viewer */
    sizeKey: string;
    /** the frame's accessible name */
    title: string;
  };
  Blocks: {
    /** the gallery tile's face: the film's poster */
    tile: [];
  };
  Element: HTMLDivElement;
}

/**
 * A film's two faces in the gallery. In the grid it is the poster the `tile`
 * block draws: no WebGL in a tile. On the demo page it is the film itself in
 * a frame, with a door into theater and a corner grip that resizes the frame.
 * In theater both controls stand down: the frame is the window.
 */
export class FilmStage extends Component<Signature> {
  /** a hand-set frame, else the well's own size */
  @tracked private size: Size | null = this.saved();
  /** a drag in progress: the iframe stands aside and a readout shows */
  @tracked private sizing = false;
  private grip?: { h0: number; w0: number; x0: number; y0: number };
  private embedEl?: HTMLElement;

  private saved(): Size | null {
    try {
      let raw = window.localStorage.getItem(this.args.sizeKey);
      let size = raw ? (JSON.parse(raw) as Size) : null;
      return size && size.w >= SIZE_MIN.w && size.h >= SIZE_MIN.h ? size : null;
    } catch {
      return null;
    }
  }

  private remember() {
    try {
      if (this.size) {
        window.localStorage.setItem(
          this.args.sizeKey,
          JSON.stringify(this.size),
        );
      } else {
        window.localStorage.removeItem(this.args.sizeKey);
      }
    } catch {
      /* storage refused: the size just does not remember */
    }
  }

  private well = modifier((element: HTMLElement) => {
    this.embedEl = element;
    return () => {
      if (this.embedEl === element) {
        this.embedEl = undefined;
      }
    };
  });

  get isStage() {
    return this.args.face === 'stage';
  }

  get resizable() {
    return this.args.resizable !== false;
  }

  get inTheater() {
    return this.args.theater?.on === true;
  }

  /** a hand-set size applies on the page; in theater the frame is the window */
  get sized(): Size | null {
    return this.inTheater || !this.resizable ? null : this.size;
  }

  get frameStyle() {
    let size = this.sized;
    let ground = `--film-ground:${this.args.ground}`;
    return htmlSafe(
      size ? `${ground};--film-w:${size.w}px;--film-h:${size.h}px` : ground,
    );
  }

  get readout(): string {
    let size = this.size;
    return size ? `${size.w} × ${size.h}` : '';
  }

  /** the ceiling: the well the face sits in */
  private ceiling(): Size {
    let box = this.embedEl?.parentElement?.getBoundingClientRect();
    return {
      h: Math.max(SIZE_MIN.h, Math.floor(box?.height ?? 0)),
      w: Math.max(SIZE_MIN.w, Math.floor(box?.width ?? 0)),
    };
  }

  private gripDown = (event: Event) => {
    if (!(event instanceof PointerEvent)) {
      return;
    }
    let rect = this.embedEl?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.grip = {
      h0: rect.height,
      w0: rect.width,
      x0: event.clientX,
      y0: event.clientY,
    };
    this.sizing = true;
    event.preventDefault();
  };

  private gripMove = (event: Event) => {
    if (!(event instanceof PointerEvent)) {
      return;
    }
    let grip = this.grip;
    if (!grip) {
      return;
    }
    /* the frame is centred, so a corner dragged by d grows the box by 2d */
    let max = this.ceiling();
    let w = Math.round(
      Math.max(
        SIZE_MIN.w,
        Math.min(max.w, grip.w0 + 2 * (event.clientX - grip.x0)),
      ),
    );
    /* AND THE BOX NEVER GOES TALLER THAN IT IS WIDE. Every layout inside
       the film is written for a frame that is not portrait — the type sets
       beside the subject, the mark draws across to it — so a tall thin drag
       does not show the film small, it shows a different film. The grip is
       free above that line and stops at it. */
    let h = Math.round(
      Math.max(
        SIZE_MIN.h,
        Math.min(max.h, w, grip.h0 + 2 * (event.clientY - grip.y0)),
      ),
    );
    /* at the ceiling on both axes the frame is the well again: no override */
    this.size = w >= max.w - 1 && h >= max.h - 1 ? null : { h, w };
  };

  private gripUp = () => {
    if (!this.grip) {
      return;
    }
    this.grip = undefined;
    this.sizing = false;
    this.remember();
  };

  /** snap back to the well's own size */
  private reset = () => {
    this.size = null;
    this.grip = undefined;
    this.sizing = false;
    this.remember();
  };

  private toggleTheater = () => this.args.theater?.toggle();

  <template>
    <div class='film-face' data-test-film={{@film}} ...attributes>
      {{#if this.isStage}}
        {{! the demo page's face: the film in a frame, tweened in — the heavy
          world stays in its own document and unmounts whole }}
        <div
          class='film-embed
            {{if this.sized "is-sized"}}
            {{if this.sizing "is-sizing"}}'
          style={{this.frameStyle}}
          {{this.well}}
        >
          <FilmFrame
            class='film-frame'
            @film={{@film}}
            @link={{@filmLink}}
            @title={{@title}}
          />
          {{#if @theater}}
            {{#unless this.inTheater}}
              {{! UPPER RIGHT, where the mark stands in theater: the way in and
                the way out are the same corner, and only ever one of them is
                on screen }}
              <button
                type='button'
                class='film-theater-btn'
                data-film-theater
                data-test-theater-enter
                {{on 'click' this.toggleTheater}}
              >⛶ Theater mode</button>
            {{/unless}}
          {{/if}}
          {{#unless this.inTheater}}
            {{#if this.sized}}
              <button
                type='button'
                class='film-theater-btn film-reset-btn'
                {{on 'click' this.reset}}
              >↺ Default size</button>
            {{/if}}
            {{#if this.resizable}}
              {{! the corner grip: drag to resize the frame, double-click to
                snap back }}
              <button
                type='button'
                class='film-grip'
                aria-label='Resize the frame'
                title='Drag to resize · double-click to reset'
                {{on 'pointerdown' this.gripDown}}
                {{on 'pointermove' this.gripMove}}
                {{on 'pointerup' this.gripUp}}
                {{on 'pointercancel' this.gripUp}}
                {{on 'dblclick' this.reset}}
              ></button>
            {{/if}}
            {{#if this.sizing}}
              <span class='film-size'>{{this.readout}}</span>
            {{/if}}
          {{/unless}}
        </div>
      {{else}}
        {{yield to='tile'}}
      {{/if}}
    </div>
    <style scoped>
      .film-face {
        position: absolute;
        inset: 0;
      }

      .film-embed {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: var(--film-ground);
      }

      /* a hand-set frame: its own size, centred in the well, the well's
         recessed ground showing around it */
      .film-embed.is-sized {
        inset: auto;
        left: 50%;
        top: 50%;
        width: var(--film-w);
        height: var(--film-h);
        transform: translate(-50%, -50%);
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
      }

      .film-embed :deep(.film-frame) {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        transform-origin: 50% 60%;
      }

      /* while the hand is on the grip the iframe stands aside, so the
         pointer never falls into the film's own document mid-drag */
      .film-embed.is-sizing :deep(.film-frame) {
        pointer-events: none;
      }

      .film-grip {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        background: linear-gradient(
            135deg,
            transparent 0 50%,
            rgba(242, 233, 210, 0.85) 50% 56%,
            transparent 56% 66%,
            rgba(242, 233, 210, 0.85) 66% 72%,
            transparent 72% 82%,
            rgba(242, 233, 210, 0.85) 82% 88%,
            transparent 88%
          )
          no-repeat;
        cursor: nwse-resize;
        opacity: 0;
        transition: opacity 160ms ease;
        touch-action: none;
      }

      .film-embed:hover .film-grip,
      .film-embed.is-sizing .film-grip,
      .film-grip:focus-visible {
        opacity: 1;
      }

      .film-theater-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--film-btn-rim, rgba(168, 98, 31, 0.45));
        background: var(--film-btn-ground, rgba(36, 27, 12, 0.6));
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: var(--film-btn-ink, #f2e9d2);
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .film-theater-btn:hover {
        background: var(--film-btn-hover, rgba(74, 52, 20, 0.85));
      }

      /* opposite the way-in button */
      .film-reset-btn {
        right: auto;
        left: 14px;
      }

      .film-size {
        position: absolute;
        right: 34px;
        bottom: 10px;
        padding: 5px 9px;
        border-radius: 6px;
        background: rgba(36, 27, 12, 0.7);
        color: #f2e9d2;
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.08em;
        pointer-events: none;
      }
    </style>
  </template>
}
