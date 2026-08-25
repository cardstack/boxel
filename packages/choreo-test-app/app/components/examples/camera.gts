import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, spring } from 'glimmer-motion';

/**
 * A light table. The whole roll sits on the glass at once, unlabelled
 * film — loupe IN onto a frame and the camera info develops: its number
 * first, then, a beat later, the full exposure and the verdict.
 *
 * The loupe's zoom is not a stylistic choice: it is computed so the
 * negative itself fills a set share of the glass (§FILL below). The grade
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

/** one developer's-tank hue band — yellow through orange and red to
 * brown — and every frame draws its own point in it, so no two shots on
 * the roll ever land on quite the same shade */
function filmWash(): string {
  const hue = 8 + Math.random() * 42; // 8°(red) .. 50°(yellow), one warm band
  const sat = 62 + Math.random() * 28; // kept high — low sat reads muddy, not brown
  const highlight = `hsl(${hue} ${Math.min(sat + 8, 100)}% ${78 + Math.random() * 15}%)`;
  const mid = `hsl(${hue} ${sat}% ${38 + Math.random() * 12}%)`;
  // browns are just this same band darkened, not desaturated toward grey —
  // desaturating too far is what reads as an off, muddy-green wrong note
  const shadow = `hsl(${hue} ${Math.max(sat - 12, 50)}% ${9 + Math.random() * 7}%)`;
  const angle = 130 + Math.random() * 60;
  return `linear-gradient(${angle}deg, ${highlight} 0%, ${mid} 42%, ${shadow} 100%)`;
}

const VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** six frames per bracket, milliseconds apart: same light, a slightly
 * different world — small strips enough to fill the sheet edge to edge */
const shots = brackets.flatMap((bracket, row) =>
  VARIANTS.map((variant, i) => ({
    bracket: bracket.no,
    caption: bracket.caption,
    exposure: bracket.exposure,
    id: `n${bracket.no}${variant}`,
    label: `${bracket.no} · ${variant.toUpperCase()}`,
    stamp: `07:4${row}:02.${String(114 + i * 83).padStart(3, '0')}`,
    wash: filmWash(),
  })),
);

/** a camera has weight: it carries the whole table, so it never snaps */
const carry = spring({ bounce: 0.12, visualDuration: 0.62 });

/** the frames' own boxes, if a pass reflows the sheet */
const settle = spring({ bounce: 0.22, visualDuration: 0.42 });

/**
 * §FILL — the loupe's zoom, computed, not guessed, from what's actually
 * on screen. A fixed multiplier assumes a reference viewport; on any
 * other one (a narrow phone, a squeezed column) the SAME multiplier
 * either underzooms or — worse — overzooms and crops the frame against
 * the glass. So the zoom is derived at the moment of the dive, from the
 * two real boxes measured in `loupe()` below: the clicked frame's own
 * rest-state size, and the glass (`.cam-stage`) it has to fit inside.
 *
 * TARGET_H is what a loupe should feel like — the negative filling most
 * of the glass's height. TARGET_W is a looser cap on the OTHER axis: it
 * only bites on a glass much wider than it is tall, where a height-only
 * target would zoom the frame wide enough to crop left and right. The
 * smaller of the two candidate zooms is the one that's guaranteed not to
 * crop either way.
 */
const TARGET_H = 0.65; // the frame's share of the glass's height, louped in
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
        // §FILL sizes the loupe to fit the GLASS — but the glass itself
        // can be taller than the actual visible viewport (a phone's
        // browser chrome eats real estate `min(58vh, 560px)` doesn't
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
    event: Event,
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

  /** the frame's own class: open while louped, tinted once loved,
   * dimmed once passed on */
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
        {{! the loupe power is the photographer's hand, not part of the
            table — pinned over the corner, it never rides the camera }}
        <span class="cam-hud-dock">
          <span class="cam-hud">{{this.power}}</span>
        </span>
        {{! the cursor is the affordance: zoom-in over a frame, zoom-out on
            the table once you are close — no toolbar, the world explains }}
        <Choreo
          class={{this.stageClass}}
          {{on "click" this.clear}}
          as |c|
        >
          <div class="cam-sheet">
            {{#each shots as |shot|}}
              <button
                type="button"
                class={{this.frameClass shot}}
                {{motion id=shot.id role="frame"}}
                {{on "click" (fn this.loupe shot.id)}}
              >
                {{! basic metadata — the frame number — reads at rest;
                    the full exposure only develops once you loupe in }}
                <span
                  class="cam-no"
                  {{motion id=(labelId shot) role="no"}}
                >{{shot.label}}</span>
                <span class="cam-wash" style={{washOf shot.wash}}></span>
                {{! the loved mark reads from the whole sheet at a glance,
                    not just from inside the loupe — a heart stamped on
                    the negative itself, the way a grease pencil would }}
                {{#if (this.isVerdict shot "loved")}}
                  <span
                    class="cam-heart"
                    {{motion id=(heartId shot) role="no"}}
                  >♥</span>
                {{/if}}
                {{! the verdict control: docked in the label strip,
                    mirroring `.cam-no` on the other side — never over the
                    photo. Two segments, not three: neutral isn't a
                    button, it's what you get by clicking the active one
                    again. Its own role, steady like the frame number, so
                    the loupe's zoom never blows it up. }}
                {{#if (this.isFocus shot.id)}}
                  <span
                    class="cam-verdict-seg"
                    {{motion id=(verdictId shot) role="verdict"}}
                  >
                    <span
                      class={{if
                        (this.isVerdict shot "loved")
                        "cam-seg is-loved is-active"
                        "cam-seg is-loved"
                      }}
                      role="button"
                      aria-label="Love this one"
                      {{on "click" (fn this.setVerdict shot "loved")}}
                    >♥</span>
                    <span
                      class={{if
                        (this.isVerdict shot "passed")
                        "cam-seg is-passed-seg is-active"
                        "cam-seg is-passed-seg"
                      }}
                      role="button"
                      aria-label="Pass"
                      {{on "click" (fn this.setVerdict shot "passed")}}
                    >✕</span>
                  </span>
                {{/if}}
              </button>
            {{/each}}
          </div>

          <c.Parallel>
            {{! ONE camera step, aimed by state. Every pass replays it
                toward wherever the work now stands — an interrupted dive
                simply bends. @steady names what must stay legible at any
                distance: the frame number and the verdict icon scale
                against the camera, damped back toward their own size —
                the loupe zooms the NEGATIVE in, not the UI on top of it.
                The grade dock lives outside this region entirely (below),
                so it never needs steadying. }}
            <c.Camera
              @zoom={{this.zoom}}
              @origin={{if this.aimId (c.id this.aimId)}}
              @x={{if this.focus this.panX 0}}
              @y={{if this.focus this.panY 0}}
              @spring={{carry}}
              @steady={{array (c.role "no") (c.role "verdict")}}
            />
            {{! if a verdict reflows the sheet, every frame that moved tweens }}
            <c.Move @of={{c.moved "frame"}} @spring={{settle}} />
            {{! the verdict icon arrives with the loupe — a plain fade, no
                overshoot, since @steady is already busy correcting its
                scale against the camera's own move }}
            <c.Tween
              @of={{c.inserted "verdict"}}
              @opacity={{array 0 1}}
              @duration={{0.18}}
            />
            <c.Tween
              @of={{c.removed "verdict"}}
              @opacity={{0}}
              @duration={{0.12}}
            />
          </c.Parallel>
        </Choreo>

        {{! the exposure dock: pinned to the TABLE, not the frame or the
            camera — a bottom bar, like `.cam-hud-dock` above it, so
            zooming the negative never zooms the reading of it. The
            verdict itself lives on the frame's own corner instead — two
            dots, not a panel over the photo. }}
        <div class={{if this.focusedShot "cam-grade-dock is-open" "cam-grade-dock"}}>
          {{#if this.focusedShot}}
            <span class="cam-exp">{{this.focusedShot.exposure}} ·
              {{this.focusedShot.stamp}}</span>
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
