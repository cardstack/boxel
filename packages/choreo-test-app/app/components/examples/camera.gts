import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoContext } from 'glimmer-motion';
import { Choreo, motion, spring } from 'glimmer-motion';

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
  }))
);

/** a camera has weight: it carries the whole table, so it never snaps */
const carry = spring({ bounce: 0.12, visualDuration: 0.62 });

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
      // view along with the dive, not after it.
      (event.currentTarget as HTMLElement)
        .closest('.cam-stage')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    this.focus = opening ? id : null;
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
    event: Event
  ) => {
    event.stopPropagation();
    const next = this.isVerdict(shot, verdict) ? 'neutral' : verdict;
    this.verdicts = { ...this.verdicts, [shot.id]: next };
    this.focus = null;
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

  get dockHeartClass() {
    const shot = this.focusedShot;
    return shot && this.isVerdict(shot, 'loved')
      ? 'cam-heart is-control is-active'
      : 'cam-heart is-control';
  }

  get dockPassClass() {
    const shot = this.focusedShot;
    return shot && this.isVerdict(shot, 'passed')
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
   * state, read back instead of a number this component computed */
  get power() {
    return `${(this.c?.camera.zoom ?? 1).toFixed(2)}×`;
  }

  /** the graded shot, if any — the dock's own content, not a per-frame one */
  get focusedShot() {
    return shots.find((shot) => shot.id === this.focus) ?? null;
  }

  <template>
    <div class="ex">
      <div class="cam">
        {{! the zoom readout — pinned over the corner, OUTSIDE the region,
            so it never rides the camera; it reads c.camera back instead }}
        <span class="cam-hud-dock">
          <span class="cam-hud">{{this.power}}</span>
        </span>
        {{! the cursor is the affordance: zoom-in over a frame, zoom-out on
            the table once you are close — no toolbar, the world explains }}
        <Choreo class={{this.stageClass}} {{on "click" this.clear}} as |c|>
          <div class="cam-sheet" {{this.wire c}}>
            {{#each shots as |shot|}}
              <button
                type="button"
                class={{this.frameClass shot}}
                {{motion id=shot.id role="frame"}}
                {{on "click" (fn this.loupe shot.id)}}
              >
                <span class="cam-wash" style={{washOf shot.wash}}></span>
                <span
                  class="cam-no"
                  {{motion id=(labelId shot) role="no"}}
                >{{shot.label}}</span>
                {{! heart and X on the contact sheet only — when dived they
                    live in the grade dock, off the print }}
                {{#unless (this.isFocus shot.id)}}
                  <span class="cam-marks">
                    {{#if (this.showHeart shot)}}
                      <span
                        class={{this.heartClass shot}}
                        {{motion id=(heartId shot) role="heart"}}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12 21s-7.2-4.6-9.6-8.8C.4 8.8 1.5 4.6 5.2 3.4 7.8 2.5 10.2 3.6 12 6.2c1.8-2.6 4.2-3.7 6.8-2.8 3.7 1.2 4.8 5.4 2.8 8.8C19.2 16.4 12 21 12 21z"
                          />
                        </svg>
                      </span>
                    {{/if}}
                    {{#if (this.showPass shot)}}
                      <span
                        class={{this.passClass shot}}
                        {{motion id=(verdictId shot) role="verdict"}}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="none"
                            stroke="currentColor"
                            stroke-linecap="round"
                            stroke-width="2.2"
                            d="M7 7l10 10M17 7L7 17"
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
              @spring={{carry}}
              @steady={{array
                (c.role "no")
                (c.role "heart")
                (c.role "verdict")
              }}
            />
            {{! if a verdict reflows the sheet, every frame that moved tweens }}
            <c.Move @of={{c.moved "frame"}} @spring={{settle}} />
          </c.Parallel>
        </Choreo>

        {{! the grade dock: pinned to the TABLE, not the frame — so the
            dive zooms the photograph and never the reading of it. Heart
            and pass sit HERE, beside the caption, never on the print. }}
        <div
          class={{if
            this.focusedShot
            "cam-grade-dock is-open"
            "cam-grade-dock"
          }}
        >
          {{#if this.focusedShot}}
            <div class="cam-grade-copy">
              <span class="cam-caption">{{this.focusedShot.caption}}</span>
              <span class="cam-exp">{{this.focusedShot.exposure}}
                ·
                {{this.focusedShot.stamp}}</span>
            </div>
            <div class="cam-grade-tools">
              <span
                class={{this.dockHeartClass}}
                role="button"
                aria-label="Love this one"
                {{on "click" (fn this.setVerdict this.focusedShot "loved")}}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 21s-7.2-4.6-9.6-8.8C.4 8.8 1.5 4.6 5.2 3.4 7.8 2.5 10.2 3.6 12 6.2c1.8-2.6 4.2-3.7 6.8-2.8 3.7 1.2 4.8 5.4 2.8 8.8C19.2 16.4 12 21 12 21z"
                  />
                </svg>
              </span>
              <span
                class={{this.dockPassClass}}
                role="button"
                aria-label="Pass"
                {{on "click" (fn this.setVerdict this.focusedShot "passed")}}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-width="2.2"
                    d="M7 7l10 10M17 7L7 17"
                  />
                </svg>
              </span>
            </div>
          {{/if}}
        </div>
      </div>
    </div>
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
