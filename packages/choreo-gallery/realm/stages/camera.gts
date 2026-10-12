import type { ChoreoContext } from '@cardstack/choreo';
import { Choreo } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, spring } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSpring } from '../lib/tuning';
import CameraNotes from '../notes/camera';

/**
 * A photo library. The whole set sits on the glass at once — dive IN onto a
 * shot and the camera info develops: its number first, then, a beat later,
 * the caption, the exposure, and the verdict.
 *
 * The dive is `@fit`: the library computes the zoom AND the pan so the
 * photograph fills a set share of the glass, centred — from rest-layout
 * geometry, so a click that lands mid-flight on a different tile still
 * measures true. The grade panel never has to compete with it for room —
 * it's a callout beside the frame, not a card laid over the photo.
 */
const brackets = [
  {
    caption: 'Night shift',
    exposure: 'f/2.8 · 1/60 · ISO 800',
    no: '01',
  },
  {
    caption: 'Foundry glass',
    exposure: 'f/2 · 1/30 · ISO 1600',
    no: '02',
  },
];

/**
 * Twelve photographs, not twelve cuts of the same amber negative — and
 * not twelve colour swatches either. Each wash is layered like an
 * out-of-focus exposure: a bright bokeh bloom off-centre, a softer
 * counter-glow from another corner, a faint glint, over a dark ground.
 * The framing (where the light sits) varies shot to shot, the way a
 * bracket's frames wander; only the hue family stays per bracket row.
 */
const washes = [
  // 01 — night shift: a streetlamp high right, sodium haze low left
  `radial-gradient(150% 120% at 74% 10%, #a9c8f5d9 0%, #8eb8f000 74%),
   radial-gradient(110% 95% at 16% 82%, #3c5c8cb8 0%, #2a4a7800 82%),
   radial-gradient(60% 45% at 54% 44%, #ffffff1f 0%, #ffffff00 100%),
   linear-gradient(158deg, #2c4a74 0%, #101a26 100%)`,
  // 02 — the same street, warmer glass: shopfront glow left of frame
  `radial-gradient(140% 120% at 26% 18%, #ffc07ad4 0%, #ffc07a00 76%),
   radial-gradient(120% 100% at 80% 78%, #d4581caa 0%, #d4581c00 80%),
   radial-gradient(55% 45% at 58% 50%, #ffe6c41c 0%, #ffe6c400 100%),
   linear-gradient(148deg, #a03e14 0%, #301408 100%)`,
  // 03 — a neon sign bleeding through the top of the frame
  `radial-gradient(160% 110% at 60% 4%, #c4a0ffd4 0%, #c4a0ff00 72%),
   radial-gradient(100% 100% at 12% 70%, #6a36b3a8 0%, #5a2a9c00 80%),
   radial-gradient(55% 45% at 78% 54%, #ffffff17 0%, #ffffff00 100%),
   linear-gradient(164deg, #4a2384 0%, #1c1030 100%)`,
  // 04 — window light on water, the bloom sunk low
  `radial-gradient(145% 115% at 68% 86%, #6fd6c4cf 0%, #6fd6c400 76%),
   radial-gradient(110% 90% at 22% 16%, #2a7a78a8 0%, #1a5c5e00 82%),
   radial-gradient(60% 40% at 46% 52%, #c8f2e614 0%, #c8f2e600 100%),
   linear-gradient(152deg, #16494a 0%, #0c1c1e 100%)`,
  // 05 — tail lights, hot centre-right
  `radial-gradient(135% 115% at 66% 32%, #ff8a5ad4 0%, #ff8a5a00 72%),
   radial-gradient(100% 110% at 10% 88%, #c4271299 0%, #c4271200 78%),
   radial-gradient(55% 40% at 32% 22%, #ffd9b829 0%, #ffd9b800 100%),
   linear-gradient(160deg, #8a1e0e 0%, #220c08 100%)`,
  // 06 — overcast daylight, one soft silver source
  `radial-gradient(170% 130% at 38% 6%, #d0d6dacf 0%, #d0d6da00 78%),
   radial-gradient(110% 90% at 84% 80%, #6a737694 0%, #5c656800 82%),
   radial-gradient(65% 50% at 60% 46%, #f2f5f614 0%, #f2f5f600 100%),
   linear-gradient(170deg, #4c5457 0%, #1a1815 100%)`,
  // 07 — the foundry door cracked open, low left
  `radial-gradient(140% 120% at 20% 84%, #ff7a45d1 0%, #ff7a4500 74%),
   radial-gradient(110% 95% at 78% 20%, #c42712a3 0%, #c4271200 80%),
   radial-gradient(55% 45% at 48% 54%, #ffc79e1a 0%, #ffc79e00 100%),
   linear-gradient(160deg, #7e1c0c 0%, #2e100a 100%)`,
  // 08 — pour in frame: the melt blown out top left, sparks right
  `radial-gradient(145% 115% at 24% 12%, #ffb36ad6 0%, #ffb36a00 74%),
   radial-gradient(105% 110% at 84% 64%, #ff3b1f9e 0%, #ff3b1f00 76%),
   radial-gradient(50% 40% at 60% 32%, #fff1d633 0%, #fff1d600 100%),
   linear-gradient(145deg, #b2320f 0%, #4a1610 100%)`,
  // 09 — smoke and skylight, silver from above
  `radial-gradient(165% 120% at 56% 2%, #c5cdd0cf 0%, #c5cdd000 76%),
   radial-gradient(100% 100% at 14% 78%, #6a737691 0%, #5c656800 82%),
   radial-gradient(60% 45% at 70% 50%, #eef2f414 0%, #eef2f400 100%),
   linear-gradient(165deg, #474f52 0%, #1c1a16 100%)`,
  // 10 — blown-out furnace glass, nearly the whole frame
  `radial-gradient(155% 125% at 62% 28%, #fff4e8db 0%, #fff4e800 78%),
   radial-gradient(120% 100% at 14% 84%, #e4a35ab3 0%, #e4a35a00 80%),
   linear-gradient(150deg, #b57838 0%, #5c3a1c 100%)`,
  // 11 — arc light through violet gel, high left
  `radial-gradient(140% 115% at 22% 8%, #b08cffd4 0%, #b08cff00 74%),
   radial-gradient(110% 95% at 80% 74%, #5c2494ad 0%, #4a187800 80%),
   radial-gradient(55% 45% at 50% 48%, #ffffff1a 0%, #ffffff00 100%),
   linear-gradient(156deg, #3c1464 0%, #180c26 100%)`,
  // 12 — sodium on brass, acid bloom low right
  `radial-gradient(145% 115% at 78% 76%, #b6d15acf 0%, #b6d15a00 76%),
   radial-gradient(105% 90% at 18% 18%, #5a742ca6 0%, #3a4e1400 82%),
   radial-gradient(60% 45% at 48% 46%, #e8f2c214 0%, #e8f2c200 100%),
   linear-gradient(162deg, #2e3e10 0%, #141a0a 100%)`,
];

const VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** six frames per bracket, milliseconds apart: same light, a slightly
 * different world */
const shots = brackets.flatMap((bracket, row) =>
  VARIANTS.map((variant, i) => ({
    bracket: bracket.no,
    caption: bracket.caption,
    exposure: bracket.exposure,
    id: `n${bracket.no}${variant}`,
    label: String(row * 6 + i + 1).padStart(2, '0'),
    stamp: `07:4${row}:02.${String(114 + i * 83).padStart(3, '0')}`,
    wash: washes[row * 6 + i]!,
  })),
);

/** a camera has weight: it carries the whole table, so it never snaps —
    but 0.62s with bounce made the dive linger. Shorter, quieter settle. */
const carry = spring({ bounce: 0.05, visualDuration: 0.36 });

/** the frames' own boxes, if a pass reflows the sheet */
const settle = spring({ bounce: 0.22, visualDuration: 0.42 });

/**
 * The dive's magnification: the photograph's share of the glass on
 * whichever axis fits first. One number for `@fit` — the library derives
 * the zoom and the centring pan from it against the REAL boxes, so a
 * narrow phone and a wide desktop glass both land the frame at this
 * share, never cropped against the edge.
 */
const FILL = 0.72;

type Verdict = 'loved' | 'neutral' | 'passed';

export class Camera extends Component {
  @tracked focus: string | null = null;
  /** one verdict per shot, from a fixed three: loved it, no call yet
   * (the default), or passed on it — a segmented control, not a toggle */
  @tracked verdicts: Record<string, Verdict> = {};

  /** the region's yielded context, held so the HUD outside the glass can
   * read `c.camera` — tracked, updated when a camera step lands (§9) */
  @tracked c: ChoreoContext | null = null;

  wire = modifier((_el: Element, [c]: [ChoreoContext]) => {
    this.c = c;
  });

  get stageClass() {
    return this.focus ? 'cam-stage is-zoomed' : 'cam-stage';
  }

  loupe = (id: string, event: Event) => {
    event.stopPropagation();
    const opening = this.focus !== id;
    if (opening) {
      // `@fit` sizes the dive to fit the GLASS — but the glass itself
      // can be taller than the actual visible viewport (a phone's
      // browser chrome eats real estate the stage's own height doesn't
      // know about), so a corner dive can still land partly below the
      // fold. This is the one place scroll position is a legitimate
      // part of "does the result fit" — nudge the glass fully into
      // view along with the dive, not after it. `nearest`, not
      // `center`: a glass already fully on screen must not move — the
      // dive changes the world INSIDE the crop, never the page around
      // it.
      const stage = (event.currentTarget as HTMLElement).closest('.cam-stage');
      if (stage) {
        const box = stage.getBoundingClientRect();
        const view = window.innerHeight;
        // `block: 'nearest'` is a no-op for a glass already fully on screen,
        // which is every glass in a gallery card — so on that page this never
        // scrolled and the rule read as "a dive never moves the page". On the
        // demo page the stage is TALLER than the viewport, and `nearest` will
        // happily scroll a box that can never fit, which is the page lurching
        // on a zoom. A stage that cannot fit is one scrolling cannot help.
        const shown =
          Math.max(0, Math.min(box.bottom, view) - Math.max(box.top, 0)) /
          Math.max(1, box.height);
        // Only rescue a glass that is genuinely hidden. `block: 'nearest'`
        // alone moves the page for a stage that is one pixel short of
        // whole, and the stage sizes itself to the viewport — so on the demo
        // page, where a header sits above it, almost every dive nudged the
        // page. In a gallery card the stage is always fully on screen, which
        // is why the rule only ever misbehaved on one of the two pages.
        if (shown < 0.75) {
          stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
    this.focus = opening ? id : null;
  };

  /** a print half past the crop is still a focusable button, and focusing
   * it makes the browser scroll the page chasing a corner the crop has
   * already spoken for — swallow the mousedown's focus, keep the click */
  quellFocus = (event: Event) => {
    event.preventDefault();
  };

  clear = () => {
    this.focus = null;
  };

  /** the segmented control's own click; it ends the grade, so it never
   * toggles the frame under it too. A second click on the already-active
   * segment is what gets you BACK to neutral — there's no separate
   * "clear" control, since neutral is just "neither one clicked". */
  setVerdict = (
    shot: (typeof shots)[number],
    verdict: Verdict,
    event: Event,
  ) => {
    event.stopPropagation();
    const next = this.isVerdict(shot, verdict) ? 'neutral' : verdict;
    this.verdicts = { ...this.verdicts, [shot.id]: next };
    this.focus = null;
    // the verdict closes the dock, and the control holding focus goes with
    // it — hand focus back to the print that was graded
    const control = event.currentTarget as HTMLElement;
    if (document.activeElement === control) {
      control
        .closest('.cam')
        ?.querySelector<HTMLElement>(`[data-shot="${shot.id}"]`)
        ?.focus({ preventScroll: true });
    }
  };

  isFocus = (id: string) => this.focus === id;
  verdictOf = (shot: (typeof shots)[number]): Verdict =>
    this.verdicts[shot.id] ?? 'neutral';
  isVerdict = (shot: (typeof shots)[number], verdict: Verdict) =>
    this.verdictOf(shot) === verdict;

  /** contact-sheet marks only — loved and passed, at rest. Once dived
   * the same facts live in the grade dock, so the print stays clean. */
  showHeart = (shot: (typeof shots)[number]) =>
    this.isVerdict(shot, 'loved') && !this.isFocus(shot.id);

  showPass = (shot: (typeof shots)[number]) =>
    this.isVerdict(shot, 'passed') && !this.isFocus(shot.id);

  heartClass = (shot: (typeof shots)[number]) =>
    this.isVerdict(shot, 'loved') ? 'cam-heart is-active' : 'cam-heart';

  passClass = (shot: (typeof shots)[number]) =>
    this.isVerdict(shot, 'passed') ? 'cam-pass is-active' : 'cam-pass';

  get dockLoved() {
    const shot = this.focusedShot;
    return !!shot && this.isVerdict(shot, 'loved');
  }

  get dockPassed() {
    const shot = this.focusedShot;
    return !!shot && this.isVerdict(shot, 'passed');
  }

  get dockHeartClass() {
    return this.dockLoved
      ? 'cam-heart is-control is-active'
      : 'cam-heart is-control';
  }

  get dockPassClass() {
    return this.dockPassed
      ? 'cam-pass is-control is-active'
      : 'cam-pass is-control';
  }

  /** the frame's own class: open while dived, dimmed once passed on */
  frameClass = (shot: (typeof shots)[number]) => {
    const classes = ['cam-frame'];
    if (this.isFocus(shot.id)) {
      classes.push('is-open');
    }
    if (this.isVerdict(shot, 'loved')) {
      classes.push('is-loved');
    }
    if (this.isVerdict(shot, 'passed')) {
      classes.push('is-passed');
    }
    return classes.join(' ');
  };

  /** where the glass actually stands — the library's own landed camera
   * state, read back instead of a number this component computed. Guarded:
   * a camera measured against a stage that had no box yet (mid-crossing)
   * can read back non-finite, and "NaN×" is not a magnification */
  get power() {
    const zoom = this.c?.camera.zoom ?? 1;
    return `${(Number.isFinite(zoom) ? zoom : 1).toFixed(2)}×`;
  }

  /** the graded shot, if any — the dock's own content, not a per-frame one */
  get focusedShot() {
    return shots.find((shot) => shot.id === this.focus) ?? null;
  }

  <template>
    <div class='ex'>
      <div class='cam'>
        {{! the zoom readout — pinned over the corner, OUTSIDE the region,
            so it never rides the camera; it reads c.camera back instead }}
        <span class='cam-hud-dock'>
          <span class='cam-hud'>{{this.power}}</span>
        </span>
        {{! the cursor is the affordance: zoom-in over a frame, zoom-out on
            the table once you are close — no toolbar, the world explains }}
        <Choreo class={{this.stageClass}} {{on 'click' this.clear}} as |c|>
          {{! the sheet of prints is the demo's SUBSTANCE: the crossing
              matches this box, not the stage frame around it }}
          <div class='cam-sheet' data-choreo-substance {{this.wire c}}>
            {{#each shots as |shot|}}
              <button
                type='button'
                class={{this.frameClass shot}}
                data-shot={{shot.id}}
                {{motion id=shot.id role='frame'}}
                {{on 'click' (fn this.loupe shot.id)}}
                {{on 'mousedown' this.quellFocus}}
              >
                <span class='cam-wash' style={{washOf shot.wash}}></span>
                <span
                  class='cam-no'
                  {{motion id=(labelId shot) role='no'}}
                >{{shot.label}}</span>
                {{! heart and X on the contact sheet only — when dived they
                    live in the grade dock, off the print }}
                {{#unless (this.isFocus shot.id)}}
                  <span class='cam-marks'>
                    {{#if (this.showHeart shot)}}
                      <span
                        class={{this.heartClass shot}}
                        {{motion id=(heartId shot) role='heart'}}
                      >
                        <svg viewBox='0 0 24 24' aria-hidden='true'>
                          <path
                            fill='currentColor'
                            d='M12 21s-7.2-4.6-9.6-8.8C.4 8.8 1.5 4.6 5.2 3.4 7.8 2.5 10.2 3.6 12 6.2c1.8-2.6 4.2-3.7 6.8-2.8 3.7 1.2 4.8 5.4 2.8 8.8C19.2 16.4 12 21 12 21z'
                          />
                        </svg>
                      </span>
                    {{/if}}
                    {{#if (this.showPass shot)}}
                      <span
                        class={{this.passClass shot}}
                        {{motion id=(verdictId shot) role='verdict'}}
                      >
                        <svg viewBox='0 0 24 24' aria-hidden='true'>
                          <path
                            fill='none'
                            stroke='currentColor'
                            stroke-linecap='round'
                            stroke-width='2.2'
                            d='M7 7l10 10M17 7L7 17'
                          />
                        </svg>
                      </span>
                    {{/if}}
                  </span>
                {{/unless}}
              </button>
            {{/each}}
          </div>

          <c.Parallel>
            {{! ONE camera step, aimed by state. Every pass replays it
                toward wherever the work now stands — an interrupted dive
                simply bends. @fit computes the zoom and the centring pan
                from rest-layout geometry inside the library; null means
                back to the resting sheet. @steady keeps take numbers and
                the other tiles' marks legible while the camera flies. }}
            <c.Camera
              @fit={{if this.focus (c.id this.focus) null}}
              @margin={{FILL}}
              @spring={{tuneSpring 'camera' carry 'carry'}}
              @steady={{array
                (c.role 'no')
                (c.role 'heart')
                (c.role 'verdict')
              }}
            />
            {{! if a verdict reflows the sheet, every frame that moved tweens }}
            <c.Move
              @of={{c.moved 'frame'}}
              @spring={{tuneSpring 'camera' settle 'settle'}}
            />
          </c.Parallel>
        </Choreo>

        {{! the grade dock: pinned to the TABLE, not the frame — so the
            dive zooms the photograph and never the reading of it. Heart
            and pass sit HERE, beside the caption, never on the print. }}
        <div
          class={{if
            this.focusedShot
            'cam-grade-dock is-open'
            'cam-grade-dock'
          }}
        >
          {{#if this.focusedShot}}
            <div class='cam-grade-copy'>
              <span class='cam-caption'>{{this.focusedShot.caption}}</span>
              <span class='cam-exp'>{{this.focusedShot.exposure}}
                ·
                {{this.focusedShot.stamp}}</span>
            </div>
            <div class='cam-grade-tools'>
              <button
                type='button'
                class={{this.dockHeartClass}}
                aria-label='Love this one'
                aria-pressed={{if this.dockLoved 'true' 'false'}}
                {{on 'click' (fn this.setVerdict this.focusedShot 'loved')}}
              >
                <svg viewBox='0 0 24 24' aria-hidden='true'>
                  <path
                    fill='currentColor'
                    d='M12 21s-7.2-4.6-9.6-8.8C.4 8.8 1.5 4.6 5.2 3.4 7.8 2.5 10.2 3.6 12 6.2c1.8-2.6 4.2-3.7 6.8-2.8 3.7 1.2 4.8 5.4 2.8 8.8C19.2 16.4 12 21 12 21z'
                  />
                </svg>
              </button>
              <button
                type='button'
                class={{this.dockPassClass}}
                aria-label='Pass'
                aria-pressed={{if this.dockPassed 'true' 'false'}}
                {{on 'click' (fn this.setVerdict this.focusedShot 'passed')}}
              >
                <svg viewBox='0 0 24 24' aria-hidden='true'>
                  <path
                    fill='none'
                    stroke='currentColor'
                    stroke-linecap='round'
                    stroke-width='2.2'
                    d='M7 7l10 10M17 7L7 17'
                  />
                </svg>
              </button>
            </div>
          {{/if}}
        </div>
      </div>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      /* The library IS the demo container, edge to edge — no chrome around the
         glass. Both themes get their own canvas via --bg on `.stage-wrap`. */
      .cam {
        position: absolute;
        inset: 0;
      }

      /* the photographer's hands: pinned over the table's corner, never riding
         the camera. Same glass-pill language as `.replay`. */
      .cam-hud-dock {
        position: absolute;
        top: 12px;
        right: 14px;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .cam-hud {
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        background: color-mix(in srgb, var(--bg-elev) 82%, transparent);
        backdrop-filter: blur(8px);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        color: var(--ink-dim);
        pointer-events: none;
        font-variant-numeric: tabular-nums;
      }

      /* The glass clips: at rest the whole library sits on it.
         The cursor is the affordance: zoom-in over a frame, zoom-out on the
         table once you are close. */
      .cam-stage {
        position: absolute;
        inset: 0;
        /* the zoomed sheet is bigger than the glass BY DESIGN — `clip` crops it
           without making the glass scrollable, so a click on a half-visible print
           can never make the browser "helpfully" scroll the crop off its box
           (see .stage-wrap for the full rule) */
        overflow: clip;
      }

      .cam-stage.is-zoomed {
        cursor: zoom-out;
      }

      /* four columns on a roomy glass — a library, not a contact strip.
         Narrower glass gets fewer, bigger columns, so a dived print is always
         tall enough to sit inside instead of spilling past the edge.

         At rest the WHOLE sheet is on the glass, whatever the viewport: the
         tile is bounded by both axes — its share of the glass's width, and the
         width whose 4:3 stack of rows still fits the glass's height. Whichever
         is smaller wins, so nothing ever crops at 1.00×. */
      .cam-sheet {
        --cam-cols: 4;
        --cam-rows: 3;
        --cam-pad: 18px;
        --cam-gap: 10px;
        position: absolute;
        top: 50%;
        left: 0;
        transform: translateY(-50%);
        box-sizing: border-box;
        width: 100cqw;
        padding: var(--cam-pad);
        display: grid;
        grid-template-columns: repeat(
          var(--cam-cols),
          min(
            calc(
              (
                  100cqw - 2 * var(--cam-pad) - (var(--cam-cols) - 1) *
                    var(--cam-gap)
                ) /
                var(--cam-cols)
            ),
            calc(
              (
                  100cqh - 2 * var(--cam-pad) - (var(--cam-rows) - 1) *
                    var(--cam-gap)
                ) /
                var(--cam-rows) * 4 / 3
            )
          )
        );
        justify-content: center;
        grid-auto-rows: auto;
        gap: var(--cam-gap);
      }

      @container (max-width: 640px) {
        .cam-sheet {
          --cam-cols: 3;
          --cam-rows: 4;
        }
      }
      @container (max-width: 420px) {
        .cam-sheet {
          --cam-gap: 8px;
          --cam-pad: 14px;
        }
      }
      @container (max-width: 300px) {
        .cam-sheet {
          --cam-cols: 2;
          --cam-rows: 6;
          --cam-pad: 12px;
        }
      }

      /* the print itself: radius and shadow of a cover/shot. No selection ring —
         the cursor and the dive already say which tile is in play. */
      .cam-frame {
        position: relative;
        display: block;
        padding: 0;
        border: 0;
        border-radius: 14px;
        background: transparent;
        appearance: none;
        color: inherit;
        font: inherit;
        cursor: zoom-in;
        overflow: hidden;
      }

      .cam-frame:focus {
        outline: none;
      }

      .cam-frame.is-open {
        cursor: zoom-out;
        z-index: 1;
      }

      /* the take number: a glass chip on the print, Syne like a cover title.
         Dark glass over a photograph in BOTH themes — same reason .lightbox-body
         names its own white instead of inheriting --ink. */
      .cam-no {
        position: absolute;
        bottom: 8px;
        left: 8px;
        z-index: 1;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(12, 9, 8, 0.42);
        backdrop-filter: blur(8px);
        font-family: var(--font-display);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: #fff;
        line-height: 1.2;
        pointer-events: none;
      }

      /* the photograph: 4:3, filling the tile — no sprocket gutter around it */
      .cam-wash {
        position: relative;
        display: block;
        width: 100%;
        aspect-ratio: 4 / 3;
        overflow: hidden;
        border-radius: 14px;
        box-shadow:
          0 10px 22px rgba(var(--shadow-rgb), calc(0.32 * var(--shadow-a))),
          inset 0 0 28px rgba(0, 0, 0, 0.28);
      }

      @media (hover: hover) {
        .cam-frame:hover .cam-wash {
          box-shadow:
            0 14px 30px rgba(var(--shadow-rgb), calc(0.42 * var(--shadow-a))),
            inset 0 0 28px rgba(0, 0, 0, 0.28);
        }
      }

      /* the exposure dock: pinned to the table, like `.cam-hud-dock` — never a
         child of the zoomed sheet, so the dive zooms the photograph, not the
         reading of it. Same glass-panel language as `.cam-hud` / `.replay`. */
      .cam-grade-dock {
        position: absolute;
        left: 12px;
        bottom: 12px;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
        padding: 10px 12px 11px 14px;
        border-radius: 14px;
        border: 1px solid var(--line-strong);
        background: color-mix(in srgb, var(--bg-elev) 86%, transparent);
        backdrop-filter: blur(12px);
        box-shadow: 0 10px 24px
          rgba(var(--shadow-rgb), calc(0.35 * var(--shadow-a)));
        opacity: 0;
        transform: translateY(6px);
        pointer-events: none;
        transition:
          opacity 180ms var(--ease),
          transform 180ms var(--ease);
      }

      .cam-grade-dock.is-open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      .cam-grade-copy {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .cam-caption {
        font-family: var(--font-display);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1.2;
        color: var(--ink);
      }

      .cam-exp {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--ink-dim);
        font-variant-numeric: tabular-nums;
      }

      .cam-grade-tools {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
      }

      /* dock controls sit on the table, not the print — theme tokens, a
         real hit target. Tile marks keep the dark-on-photo chips above. */
      .cam-grade-dock .cam-heart,
      .cam-grade-dock .cam-pass {
        width: 32px;
        height: 32px;
        padding: 0;
        border: 1px solid var(--line-strong);
        background: rgba(var(--surface-tint-rgb), 0.08);
        color: var(--ink-dim);
        box-shadow: none;
        cursor: pointer;
      }

      .cam-grade-dock .cam-heart svg,
      .cam-grade-dock .cam-pass svg {
        width: 14px;
        height: 14px;
      }

      .cam-grade-dock .cam-heart.is-active {
        background: var(--ember);
        border-color: transparent;
        color: #fff;
        box-shadow: 0 4px 14px rgba(255, 59, 31, 0.45);
      }

      /* an X that is ON reads reversed — ink chip, paper glyph — with the same
         conviction as the heart's ember fill; a 12% tint read as "not pressed" */
      .cam-grade-dock .cam-pass.is-active {
        background: var(--ink);
        border-color: transparent;
        color: var(--bg);
      }

      /* heart and X: the same job as `.cam-no`, the other end of the frame.
         They sit. They do not grow. */
      .cam-marks {
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 4px;
        pointer-events: none;
      }

      .cam-heart,
      .cam-pass {
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(12, 9, 8, 0.42);
        backdrop-filter: blur(8px);
        color: rgba(255, 255, 255, 0.7);
      }

      .cam-heart svg,
      .cam-pass svg {
        width: 10px;
        height: 10px;
        display: block;
      }

      .cam-heart.is-active {
        color: #fff;
        background: var(--ember);
        border-color: transparent;
        box-shadow: 0 4px 14px rgba(255, 59, 31, 0.5);
      }

      .cam-pass.is-active {
        color: rgba(255, 255, 255, 0.55);
        background: rgba(12, 9, 8, 0.55);
      }

      .cam-heart.is-control,
      .cam-pass.is-control {
        pointer-events: auto;
        cursor: pointer;
      }

      /* a passed frame on the contact sheet: the print eases back, that's all.
         The corner X is the mark; a cross through the wash was too much. Once
         dived, full colour so you can still grade. */
      .cam-frame.is-passed:not(.is-open) .cam-wash {
        opacity: 0.38;
        filter: saturate(0.35) brightness(0.78);
      }
    </style>
  </template>
}

function washOf(wash: string) {
  return htmlSafe(`background: ${wash}`);
}

function labelId(shot: { id: string }) {
  return `no-${shot.id}`;
}

function verdictId(shot: { id: string }) {
  return `verdict-${shot.id}`;
}

function heartId(shot: { id: string }) {
  return `heart-${shot.id}`;
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('camera', carry, 'carry');
tuneSpring('camera', settle, 'settle');

export class CameraDemo extends GalleryDemo {
  static stage = Camera;
  static notes = CameraNotes;
}
