import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, spring } from 'glimmer-motion';

/**
 * A photo library. The whole set sits on the glass at once — dive IN onto a
 * shot and the camera info develops: its number first, then, a beat later,
 * the caption, the exposure, and the verdict.
 *
 * The dive's zoom is not a stylistic choice: it is computed so the
 * photograph itself fills a set share of the glass (§FILL below). The grade
 * panel never has to compete with it for room — it's a callout beside the
 * frame, not a card laid over the photo.
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
 * Twelve photographs, not twelve cuts of the same amber negative. The rest
 * of the suite tells shots apart with ember, copper, iris, teal, steel —
 * a library that was all one developer-tank hue couldn't.
 */
const washes = [
  'linear-gradient(158deg, #8eb8f0 0%, #2a4a78 44%, #0c141c 100%)',
  'linear-gradient(148deg, #ffc07a 0%, #d4581c 46%, #2a1008 100%)',
  'linear-gradient(164deg, #c4a0ff 0%, #5a2a9c 42%, #1a0c28 100%)',
  'linear-gradient(152deg, #6fd6c4 0%, #1a5c5e 48%, #081618 100%)',
  'linear-gradient(160deg, #ff8a5a 0%, #c42712 48%, #1c0806 100%)',
  'linear-gradient(170deg, #d0d6da 0%, #5c6568 40%, #161412 100%)',
  'linear-gradient(160deg, #ff7a45 0%, #c42712 42%, #2a0c08 100%)',
  'linear-gradient(145deg, #ffb36a 0%, #ff3b1f 48%, #4a1208 100%)',
  'linear-gradient(165deg, #c5cdd0 0%, #5c6568 40%, #1a1613 100%)',
  'linear-gradient(150deg, #fff4e8 0%, #e4a35a 45%, #5a3214 100%)',
  'linear-gradient(156deg, #b08cff 0%, #4a1878 46%, #140818 100%)',
  'linear-gradient(162deg, #b6d15a 0%, #3a4e14 44%, #101408 100%)',
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
 * §FILL — the dive's zoom, computed, not guessed, from what's actually
 * on screen. A fixed multiplier assumes a reference viewport; on any
 * other one (a narrow phone, a squeezed column) the SAME multiplier
 * either underzooms or — worse — overzooms and crops the frame against
 * the glass. So the zoom is derived at the moment of the dive, from the
 * two real boxes measured in `loupe()` below: the clicked frame's own
 * rest-state size, and the glass (`.cam-stage`) it has to fit inside.
 *
 * TARGET_H is what a dive should feel like — the photograph filling most
 * of the glass's height. TARGET_W is a looser cap on the OTHER axis: it
 * only bites on a glass much wider than it is tall, where a height-only
 * target would zoom the frame wide enough to crop left and right. The
 * smaller of the two candidate zooms is the one that's guaranteed not to
 * crop either way.
 */
const TARGET_H = 0.72; // the frame's share of the glass's height, dived in
const TARGET_W = 0.86; // the same, but for width — a looser backstop

type Verdict = 'loved' | 'neutral' | 'passed';

export class Camera extends Component {
  @tracked focus: string | null = null;
  /** one verdict per shot, from a fixed three: loved it, no call yet
   * (the default), or passed on it — a segmented control, not a toggle */
  @tracked verdicts: Record<string, Verdict> = {};

  /** the two boxes §FILL measures at the moment of the dive: the frame
   * as it stood at rest, and the glass it has to fit inside */
  @tracked restW = 0;
  @tracked restH = 0;
  @tracked glassW = 0;
  @tracked glassH = 0;
  /** §PAN — how far the aim point sits from the glass's own centre, in
   * the same rest-frame local coordinates `@origin` is measured in. The
   * camera's formula holds the aim point FIXED at its own screen position
   * while it zooms (translate(x + (1−z)·P)·scale(z)) — it does not
   * recentre it. A frame near a grid corner would zoom in place and grow
   * straight off the glass. `@x`/`@y` are the extra pan that lands the
   * aim point in the middle instead: `panX`/`panY` here. */
  @tracked panX = 0;
  @tracked panY = 0;

  /** one number, derived from state — the Camera step reads it every pass.
   * Before anything is ever measured (restW still 0) this falls back to a
   * modest, always-safe 1.5 — smaller than any real measured zoom would
   * be, so the very first dive of a session is never the one that crops. */
  get zoom() {
    if (!this.focus) return 1;
    if (!this.restW || !this.restH || !this.glassW || !this.glassH) {
      return 1.5;
    }
    const byHeight = (TARGET_H * this.glassH) / this.restH;
    const byWidth = (TARGET_W * this.glassW) / this.restW;
    return Math.max(1, Math.min(byHeight, byWidth));
  }

  /** where the camera aims: the graded frame, or nowhere in particular */
  get aimId() {
    return this.focus;
  }

  get stageClass() {
    return this.focus ? 'cam-stage is-zoomed' : 'cam-stage';
  }

  loupe = (id: string, event: Event) => {
    event.stopPropagation();
    const opening = this.focus !== id;
    if (opening) {
      // measured NOW, in LAYOUT terms — never in screen terms. Clicking
      // straight from one loupe to the next tile fires this while the
      // camera is still mid-zoom (maybe mid-SPRING) on the OLD frame, so
      // there is no single "current zoom" to divide out reliably;
      // getBoundingClientRect would answer with whatever the last
      // painted frame happened to be. offsetWidth/offsetHeight/offsetTop
      // are layout properties — CSS transform never touches them, so
      // they read the frame's REST geometry correctly no matter what the
      // camera is doing on screen at this instant.
      //
      // The one thing layout offsets don't see is `.cam-sheet`'s own
      // `top: 50%; transform: translateY(-50%)` centring — but that's a
      // fixed relationship, not something to read off a live transform:
      // the sheet's rest top, relative to the stage, is always exactly
      // half the stage's height minus half the sheet's own height.
      const frame = event.currentTarget as HTMLElement;
      const sheet = frame.offsetParent as HTMLElement | null;
      const stage = frame.closest('.cam-stage') as HTMLElement | null;
      if (sheet && stage) {
        this.restW = frame.offsetWidth;
        this.restH = frame.offsetHeight;
        this.glassW = stage.clientWidth;
        this.glassH = stage.clientHeight;
        const sheetTop = this.glassH / 2 - sheet.offsetHeight / 2;
        const frameCenterX = frame.offsetLeft + this.restW / 2;
        const frameCenterY = sheetTop + frame.offsetTop + this.restH / 2;
        this.panX = this.glassW / 2 - frameCenterX;
        this.panY = this.glassH / 2 - frameCenterY;
        // §FILL sizes the dive to fit the GLASS — but the glass itself
        // can be taller than the actual visible viewport (a phone's
        // browser chrome eats real estate the stage's own height doesn't
        // know about), so a corner dive can still land partly below the
        // fold. This is the one place scroll position is a legitimate
        // part of "does the result fit" — nudge the glass fully into
        // view along with the dive, not after it.
        stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
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
  };

  /** the frame's own class: open while dived, dimmed once passed on */
  frameClass = (shot: (typeof shots)[number]) => {
    const classes = ['cam-frame'];
    if (this.isFocus(shot.id)) classes.push('is-open');
    if (this.isVerdict(shot, 'loved')) classes.push('is-loved');
    if (this.isVerdict(shot, 'passed')) classes.push('is-passed');
    return classes.join(' ');
  };

  /** the ordered distance, which the spring is always converging on */
  get power() {
    return `${this.zoom.toFixed(2)}×`;
  }

  /** the graded shot, if any — the dock's own content, not a per-frame one */
  get focusedShot() {
    return shots.find((shot) => shot.id === this.focus) ?? null;
  }

  <template>
    <div class="ex">
      <div class="cam">
        {{! the zoom readout is the photographer's hand, not part of the
            library — pinned over the corner, it never rides the camera }}
        <span class="cam-hud-dock">
          <span class="cam-hud">{{this.power}}</span>
        </span>
        {{! the cursor is the affordance: zoom-in over a frame, zoom-out on
            the table once you are close — no toolbar, the world explains }}
        <Choreo class={{this.stageClass}} {{on "click" this.clear}} as |c|>
          <div class="cam-sheet">
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
                simply bends. @steady keeps take numbers and the other
                tiles' marks legible while the camera flies. Heart and
                pass on the OPEN frame live in the dock, off the print. }}
            <c.Camera
              @zoom={{this.zoom}}
              @origin={{if this.aimId (c.id this.aimId)}}
              @x={{if this.focus this.panX 0}}
              @y={{if this.focus this.panY 0}}
              @spring={{carry}}
              @steady={{array (c.role "no") (c.role "heart") (c.role "verdict")}}
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
