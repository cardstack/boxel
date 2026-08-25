import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, spring } from 'glimmer-motion';

/**
 * A light table. The sheet is a filmstrip, not a spec sheet: at rest the
 * glass frames ONE bracket and its number is all you get; loupe IN (1.6×)
 * onto a frame and the full camera info develops — exposure, timestamp,
 * the verdict. Pull back (0.5×) and the roll — two brackets, built as two
 * glass-heights — fits the glass exactly, every frame stripped bare so the
 * strip reads as film, not a table of data.
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

/** the developer's own palette: orange through amber, copper, rust — never
 * the same two frames the same shade, so the strip reads as distinct shots */
const HUES = [
  '#ff7a45 0%, #c42712 42%, #2a0c08 100%',
  '#fff4e8 0%, #e4a35a 45%, #5a3214 100%',
  '#ffb27a 0%, #d9632a 40%, #401c08 100%',
  '#ffd9a0 0%, #c97b3c 45%, #3a2410 100%',
  '#ff9d5c 0%, #b3401f 45%, #2e0f06 100%',
  '#fce2b8 0%, #e08a3c 42%, #4a2812 100%',
];

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
    wash: `linear-gradient(${142 + i * 23}deg, ${HUES[(row * VARIANTS.length + i) % HUES.length]})`,
  })),
);

/** a camera has weight: it carries the whole table, so it never snaps */
const carry = spring({ bounce: 0.12, visualDuration: 0.62 });

/** the frames' own boxes, if a pass reflows the sheet */
const settle = spring({ bounce: 0.22, visualDuration: 0.42 });

export class Camera extends Component {
  @tracked focus: string | null = null;
  @tracked sheet = false;
  /** one keeper per bracket — picking a variant is picking AGAINST its siblings */
  @tracked picks: Record<string, string> = {};

  /** one number, derived from state — the Camera step reads it every pass */
  get zoom() {
    if (this.focus) {
      return 1.6;
    }
    return this.sheet ? 0.5 : 1;
  }

  /** where the camera aims: the graded frame, or the middle of the sheet */
  get aimId() {
    return this.focus ?? (this.sheet ? 'sheet-centre' : null);
  }

  /** is-sheet strips the frame numbers via plain CSS — a pull-back is a
   * distance change, not a participant entering or leaving, so it fades
   * on its own rather than joining the Choreo pass */
  get stageClass() {
    if (this.focus) {
      return 'cam-stage is-zoomed';
    }
    return this.sheet ? 'cam-stage is-sheet' : 'cam-stage';
  }

  loupe = (id: string, event: Event) => {
    event.stopPropagation();
    this.sheet = false;
    this.focus = this.focus === id ? null : id;
  };

  clear = () => {
    this.focus = null;
    this.sheet = false;
  };

  /** the verdicts end the grade; they never toggle the frame under them */
  pick = (shot: (typeof shots)[number], event: Event) => {
    event.stopPropagation();
    this.picks = { ...this.picks, [shot.bracket]: shot.id };
    this.focus = null;
  };

  pass = (shot: (typeof shots)[number], event: Event) => {
    event.stopPropagation();
    if (this.picks[shot.bracket] === shot.id) {
      const next = { ...this.picks };
      delete next[shot.bracket];
      this.picks = next;
    }
    this.focus = null;
  };

  swallow = (event: Event) => {
    event.stopPropagation();
  };

  toggleSheet = (event: Event) => {
    event.stopPropagation();
    this.focus = null;
    this.sheet = !this.sheet;
  };

  isFocus = (id: string) => this.focus === id;
  isPicked = (shot: (typeof shots)[number]) =>
    this.picks[shot.bracket] === shot.id;

  /** the ordered distance, which the spring is always converging on */
  get power() {
    return `${this.zoom.toFixed(2)}×`;
  }

  <template>
    <div class="ex">
      <div class="cam">
        {{! the loupe power and the sheet toggle are the photographer's
            hands, not part of the table — pinned over the corner, they
            never ride the camera }}
        <span class="cam-hud-dock">
          <button
            type="button"
            class={{if this.sheet "cam-sheet-toggle is-on" "cam-sheet-toggle"}}
            {{on "click" this.toggleSheet}}
          >{{if this.sheet "close" "sheet"}}</button>
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
            <span class="cam-centre" {{motion id="sheet-centre" role="mark"}}
            ></span>
            {{#each shots as |shot|}}
              <button
                type="button"
                class={{if (this.isFocus shot.id) "cam-frame is-open" "cam-frame"}}
                {{motion id=shot.id role="frame"}}
                {{on "click" (fn this.loupe shot.id)}}
              >
                {{! basic metadata — the frame number — reads at rest; it
                    fades out on the sheet, where the roll is film, not data }}
                <span
                  class="cam-no"
                  {{motion id=(labelId shot) role="no"}}
                >{{shot.label}}</span>
                {{! the editor's mark: a grease-pencil ring around the keeper }}
                {{#if (this.isPicked shot)}}
                  <span
                    class="cam-ring"
                    {{motion id=(starId shot) role="badge"}}
                  ></span>
                {{/if}}
                <span class="cam-wash" style={{washOf shot.wash}}></span>
                {{! the grade rides the SAME pass as the dive: the panel
                    arrives as the loupe drops — one changeset, one
                    timeline. Each line is its own participant, so the
                    arrival is a short ladder. }}
                {{#if (this.isFocus shot.id)}}
                  <span
                    class="cam-grade"
                    {{motion id="grade-panel" role="grade"}}
                    {{on "click" this.swallow}}
                  >
                    <span
                      class="cam-exp"
                      {{motion id="grade-exp" role="grade"}}
                    >{{shot.exposure}} · {{shot.stamp}}</span>
                    <span
                      class="cam-verdict"
                      {{motion id="grade-verdict" role="grade"}}
                    >
                      <span
                        class="cam-pick"
                        role="button"
                        {{on "click" (fn this.pick shot)}}
                      >Keep this one</span>
                      <span
                        class="cam-pass"
                        role="button"
                        {{on "click" (fn this.pass shot)}}
                      >Pass</span>
                    </span>
                  </span>
                {{/if}}
              </button>
            {{/each}}
          </div>

          <c.Parallel>
            {{! ONE camera step, aimed by state. Every pass replays it
                toward wherever the work now stands — an interrupted dive
                simply bends. @steady names what must stay legible from ANY
                distance: the frame number and the picked stars scale
                against the camera, damped back toward their own size —
                so the loupe's 1.6× never blows the label up, even though
                the sheet itself fades it out entirely (plain CSS, not a
                Choreo participant). }}
            <c.Camera
              @zoom={{this.zoom}}
              @origin={{if this.aimId (c.id this.aimId)}}
              @spring={{carry}}
              @steady={{array (c.role "no") (c.role "badge")}}
            />
            {{! if a pass reflows the sheet, every frame that moved tweens }}
            <c.Move @of={{c.moved "frame"}} @spring={{settle}} />
            {{! the readout and the verdicts climb in as the loupe drops —
                a short ladder; everything leaves at once on the way out }}
            <c.Tween
              @of={{c.inserted "grade"}}
              @opacity={{array 0 1}}
              @stagger={{0.07}}
              @duration={{0.2}}
            />
            <c.Tween
              @of={{c.removed "grade"}}
              @opacity={{0}}
              @duration={{0.14}}
            />
            {{! a pick lands as the camera pulls back: the star pops on the
                sheet — a round trip through 1.25 that settles at full size }}
            <c.Tween
              @of={{c.inserted "badge"}}
              @opacity={{array 0 1}}
              @scale={{array 0.4 1.25 1}}
              @duration={{0.45}}
            />
          </c.Parallel>
        </Choreo>
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

function starId(shot: { id: string }) {
  return `star-${shot.id}`;
}
