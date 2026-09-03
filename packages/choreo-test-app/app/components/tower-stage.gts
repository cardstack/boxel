import { on } from '@ember/modifier';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, viewTransition } from 'glimmer-motion';
import { FilmTile } from 'test-app/components/film-tile';
import config from 'test-app/config/environment';
import type TheaterService from 'test-app/services/theater';

/**
 * The Towers film's catalog faces, on the Sylva pattern (sylva-stage.gts):
 * the demo page does not run the film in-process — a vendored three.js
 * world, a shader post pass and per-beat audio sharing a main thread with
 * the gallery's Magic Move is a pacing bug wearing a demo's clothes — so
 * the stage face mounts the theater route in an IFRAME (`?embed` strips
 * the gate, the transport and the dive, and begins muted), with the same
 * ⛶ Theater door Sylva's stage wears. The tile face is a POSTER — drawn,
 * not rendered: no WebGL in a gallery card, ever. See film-tile.
 */
const EMBED = `${config.rootURL}towers?embed`;
/* one frame of the film, read back through the picture's own snapshot()
   — see scripts/film-poster.mjs. The type over it is HTML, not baked in. */
const POSTER = `${config.rootURL}towers-poster.webp`;
/* the film's own inks: the keep's evening, its gold, its paper */
const PALETTE =
  '--ft-key:#e0aa52;--ft-ink:rgba(255,247,232,0.97);' +
  '--ft-sub:rgba(246,230,201,0.72);--ft-sky:#2a1e10;' +
  '--ft-floor:rgba(28,19,8,0.86);--ft-ring:rgba(240,214,164,0.32)';
const FRAME_FROM = { opacity: 0, scale: 0.97 } as const;
const FRAME_TO = { opacity: 1, scale: 1 } as const;
const FRAME_IN = { duration: 0.5, ease: [0.22, 1, 0.36, 1] } as const;

/* THE WELL CAN BE RESIZED BY HAND, within reason. The film is responsive
   — resize its frame and the shot reframes, the type re-sets, the bar
   re-lays — and the demo should let a viewer prove that with a corner
   grip rather than a browser window. The picture stays CENTRED as it
   shrinks, the way a monitor in a grading suite does; the well itself
   does not move. The floor is a frame that still reads; the ceiling is
   the well. Double-click the grip, or the chip, to snap back. */
const SIZE_MIN = { h: 216, w: 384 } as const;
const SIZE_KEY = 'tw-size';

export class TowerStage extends Component {
  /** which face to wear — decided by the box it wakes up in, like Sylva */
  @tracked private context: 'boot' | 'stage' | 'tile' = 'boot';
  /** a hand-set frame, else the well's own size */
  @tracked private size: { h: number; w: number } | null = TowerStage.saved();
  /** a drag in progress: the iframe stands aside and a readout shows */
  @tracked private sizing = false;
  private grip?: { h0: number; w0: number; x0: number; y0: number };
  private embedEl?: HTMLElement;

  private static saved(): { h: number; w: number } | null {
    try {
      const raw = window.localStorage.getItem(SIZE_KEY);
      const v = raw ? (JSON.parse(raw) as { h: number; w: number }) : null;
      return v && v.w >= SIZE_MIN.w && v.h >= SIZE_MIN.h ? v : null;
    } catch {
      return null;
    }
  }

  private well = modifier((el: HTMLElement) => {
    this.embedEl = el;
    return () => {
      if (this.embedEl === el) {
        this.embedEl = undefined;
      }
    };
  });

  get frameStyle(): string {
    const s = this.size;
    return s ? `--tw-w:${s.w}px;--tw-h:${s.h}px` : '';
  }

  get readout(): string {
    const s = this.size;
    return s ? `${s.w} × ${s.h}` : '';
  }

  /** the ceiling: the well the face sits in */
  private ceiling(): { h: number; w: number } {
    const box = this.embedEl?.parentElement?.getBoundingClientRect();
    return {
      h: Math.max(SIZE_MIN.h, Math.floor(box?.height ?? 0)),
      w: Math.max(SIZE_MIN.w, Math.floor(box?.width ?? 0)),
    };
  }

  private gripDown = (e: PointerEvent) => {
    const r = this.embedEl?.getBoundingClientRect();
    if (!r) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.grip = { h0: r.height, w0: r.width, x0: e.clientX, y0: e.clientY };
    this.sizing = true;
    e.preventDefault();
  };

  private gripMove = (e: PointerEvent) => {
    const g = this.grip;
    if (!g) {
      return;
    }
    /* the frame is centred, so a corner dragged by d grows the box by 2d */
    const max = this.ceiling();
    const w = Math.round(
      Math.max(SIZE_MIN.w, Math.min(max.w, g.w0 + 2 * (e.clientX - g.x0)))
    );
    const h = Math.round(
      Math.max(SIZE_MIN.h, Math.min(max.h, g.h0 + 2 * (e.clientY - g.y0)))
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
    try {
      if (this.size) {
        window.localStorage.setItem(SIZE_KEY, JSON.stringify(this.size));
      } else {
        window.localStorage.removeItem(SIZE_KEY);
      }
    } catch {
      /* private mode: the size just does not remember */
    }
  };

  /** snap back to the well's own size */
  private reset = () => {
    this.size = null;
    this.grip = undefined;
    this.sizing = false;
    try {
      window.localStorage.removeItem(SIZE_KEY);
    } catch {
      /* ignore */
    }
  };

  @service declare private router: RouterService;
  /* the player is already on this page; theater brings it to the
     front of it rather than opening anything */
  @service declare private theater: TheaterService;

  private place = modifier((el: HTMLElement) => {
    if (this.context !== 'boot') {
      return;
    }
    const face = el.closest('.stage-wrap') ? 'stage' : 'tile';
    requestAnimationFrame(() => {
      if (this.context === 'boot') {
        this.context = face;
      }
    });
  });

  private get isStage() {
    return this.context === 'stage';
  }

  /**
   * THE POSTER OPENS THE THEATER; the type under it opens the page.
   * A tile is a poster outside a cinema and a caption beside it, and
   * they promise different things: pressing the picture means "show me
   * the film", reading the caption means "tell me about it". So the
   * ring goes straight to `towers#theater` and the meta below — the
   * card's own link — goes to the page.
   */
  private openTheater = () => {
    void viewTransition(async () => {
      await this.router.transitionTo('towers');
      this.theater.enter(true);
    });
  };

  <template>
    <div class="tw-face" {{this.place}}>
      {{#if this.isStage}}
        {{! the demo page's face: the film in a frame, muted, tweened in —
            the heavy world stays in its own context and unmounts whole }}
        <div
          class="tw-embed
            {{if this.size 'is-sized'}}
            {{if this.sizing 'is-sizing'}}"
          style={{this.frameStyle}}
          {{this.well}}
        >
          <iframe
            class="tw-frame"
            title="Towers — the film"
            src={{EMBED}}
            {{motion initial=FRAME_FROM animate=FRAME_TO transition=FRAME_IN}}
          ></iframe>
          <button
            type="button"
            class="tw-theater-btn"
            {{on "click" this.theater.toggle}}
          >⛶ Theater mode</button>
          {{#if this.size}}
            <button
              type="button"
              class="tw-theater-btn tw-reset-btn"
              {{on "click" this.reset}}
            >↺ Default size</button>
          {{/if}}
          {{! the corner grip: drag to resize the frame, double-click to snap back }}
          <button
            type="button"
            class="tw-grip"
            aria-label="Resize the frame"
            title="Drag to resize · double-click to reset"
            {{on "pointerdown" this.gripDown}}
            {{on "pointermove" this.gripMove}}
            {{on "pointerup" this.gripUp}}
            {{on "pointercancel" this.gripUp}}
            {{on "dblclick" this.reset}}
          ></button>
          {{#if this.sizing}}
            <span class="tw-size">{{this.readout}}</span>
          {{/if}}
        </div>
      {{else}}
        {{! the gallery card's face: the poster outside the cinema — the
            film's own gate copy over a drawn plate of its own evening }}
        <FilmTile
          @eyebrow="A construction study"
          @label="Watch Towers"
          @line="Not a video — a film cut by a score"
          @name="Towers"
          @open={{this.openTheater}}
          @focus="32% 52%"
          @palette={{PALETTE}}
          @poster={{POSTER}}
        />
      {{/if}}
    </div>

    <style>
      .tw-face {
        position: absolute;
        inset: 0;
      }

      /* the Sylva stage-face pattern, in this film's own palette — the
         sy-* rules live inside sylva-stage and do not travel */
      .tw-embed {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #ecdcbc;
        view-transition-name: tower-stage;
      }

      /* a hand-set frame: its own size, centred in the well, the well's
         recessed ground showing around it */
      .tw-embed.is-sized {
        inset: auto;
        left: 50%;
        top: 50%;
        width: var(--tw-w);
        height: var(--tw-h);
        transform: translate(-50%, -50%);
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
      }

      /* while the hand is on the grip the iframe stands aside, so the
         pointer never falls into the film's own document mid-drag */
      .tw-embed.is-sizing .tw-frame {
        pointer-events: none;
      }

      .tw-grip {
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

      .tw-embed:hover .tw-grip,
      .tw-embed.is-sizing .tw-grip,
      .tw-grip:focus-visible {
        opacity: 1;
      }

      /* in theater the frame is the window, so there is nothing to
         resize and nothing to go back into — both controls stand down */
      body.is-theater .tw-theater-btn,
      body.is-theater .tw-grip,
      body.is-theater .tw-reset-btn,
      body.is-theater .tw-size {
        display: none;
      }

      /* opposite the way-in button */
      .tw-reset-btn {
        right: auto;
        left: 14px;
      }

      .tw-size {
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

      .tw-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        transform-origin: 50% 60%;
      }

      /* UPPER RIGHT, where the mark stands in theater: the way in and
         the way out are the same corner, and only ever one of them is
         on screen — this button is gone the moment you are through it. */
      .tw-theater-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid rgba(168, 98, 31, 0.45);
        background: rgba(36, 27, 12, 0.6);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #f2e9d2;
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .tw-theater-btn:hover {
        background: rgba(74, 52, 20, 0.85);
      }
    </style>
  </template>
}

export default TowerStage;
