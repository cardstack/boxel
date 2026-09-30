import { array } from '@ember/helper';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import type { ChoreoContext, ChoreoRun } from 'glimmer-motion';
import { Choreo, motion } from 'glimmer-motion';
import type { SHOTS } from 'test-app/components/long-take/shots';
import { GLIDE, tunedShots } from 'test-app/components/long-take/shots';

/** the signal path, as an engineering drawing rather than as boxes */
const WIRES = [
  'M 348 232 L 430 232',
  'M 682 232 L 764 232',
  'M 1016 232 L 1098 232',
  'M 1214 316 L 1214 392 L 596 392 L 596 470',
  'M 852 586 L 962 586',
  // capsule down the left margin and into the desk, ABOVE the patch bay
  'M 214 316 L 214 600 L 330 600',
  // and the patch bay back up into the desk's underside
  'M 314 748 L 372 748 L 372 712',
];

interface BoardSignature {
  Args: {
    /**
     * Hands this region's run up to the stage, which drives it.
     *
     * Two regions with two clocks is two clocks, and two clocks drift. See the
     * stage's `sync` for what it does with this.
     */
    onRun: (run: ChoreoRun | null) => void;
    /**
     * Whether the film is running. The outer stage owns this: stopping
     * the camera has to stop BOTH of them, or taking hold of the laptop
     * leaves the drawing still being crawled by a camera nobody asked
     * for.
     */
    playing: boolean;
    /**
     * The take counter, bumped by the outer stage when its own score
     * finishes. A region does not compile a score for a pass in which
     * nothing moved, so changing this is what makes the loop a loop —
     * and because ONE counter restarts both regions, the two cameras can
     * never come back from a loop out of step with each other.
     */
    take: number;
  };
  Element: HTMLDivElement;
}

/**
 * A drawing that never changes. Not one element mounts, unmounts, moves
 * or animates for the length of the film — there is no `@animate`, no
 * changeset, no `c.Move` anywhere in this region. Every frame of it is
 * the camera.
 */
export class Board extends Component<BoardSignature> {
  /**
   * Stop this region's run the moment the film stops, rather than waiting for
   * the cue in flight to finish.
   *
   * `@playing` already gates whether the score is RENDERED, and that is not the
   * same thing: unrendering a score does not cancel a run that is part way
   * through a four-second `c.Aim`. So switching the laptop back to 2D, or
   * taking hold of the camera, left this camera crawling across the drawing on
   * its own for the rest of the cue — visible in 2D, where the drawing is the
   * whole picture and nothing should be moving at all.
   *
   * The outer stage has always paused its own run in `toggleCamera`. This is
   * the other half of "stopping the camera stops BOTH of them".
   */
  hold = modifier(
    (
      _el: HTMLElement,
      [c, playing, onRun]: [
        ChoreoContext,
        boolean,
        (run: ChoreoRun | null) => void,
      ]
    ) => {
      const run = (c as unknown as { run: ChoreoRun | null }).run;
      onRun(run ?? null);
      if (!run) {
        return;
      }
      if (playing) {
        run.play();
      } else {
        run.pause();
      }
      return () => onRun(null);
    }
  );

  get shots() {
    return tunedShots();
  }
  readonly wires = WIRES;
  readonly glide = GLIDE;

  isKind = (shot: (typeof SHOTS)[number], kind: string) => shot.kind === kind;

  <template>
    <Choreo class="lt-region" ...attributes as |c|>
      <div
        class="lt-board"
        {{motion id="board"}}
        {{this.hold c @playing @onRun}}
      >
        <svg class="lt-grid" aria-hidden="true">
          <defs>
            <pattern
              id="lt-mesh"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#lt-mesh)" />
        </svg>

        <svg class="lt-wires" viewBox="0 0 1440 932" aria-hidden="true">
          {{#each this.wires key="@index" as |d|}}
            <path d={{d}} />
          {{/each}}
        </svg>

        {{! THE STATIONS. Each one carries a motion id, and that id is the
        only thing the shot list names: a shot says "preamp" and the camera
        step resolves it. That is the whole binding between the score and
        the drawing — no coordinates anywhere in the shot list. }}
        <div class="lt-node is-capsule" {{motion id="capsule"}}>
          <span class="lt-ref">A1</span>
          <h3>Capsule</h3>
          <p>Large diaphragm, cardioid</p>
          <dl>
            <div><dt>Z</dt><dd>200 Ω</dd></div>
            <div><dt>SPL</dt><dd>138 dB</dd></div>
          </dl>
        </div>

        <div class="lt-node is-preamp" {{motion id="preamp"}}>
          <span class="lt-ref">A2</span>
          <h3>Preamp</h3>
          <p>Transformer input, +66 dB</p>
          <dl>
            <div><dt>NOISE</dt><dd>−128 dBu</dd></div>
            <div><dt>PAD</dt><dd>−20 dB</dd></div>
          </dl>
        </div>

        <div class="lt-node is-converter" {{motion id="converter"}}>
          <span class="lt-ref">A3</span>
          <h3>Converter</h3>
          <p>32-bit, 192 kHz</p>
          <dl>
            <div><dt>THD</dt><dd>0.0004%</dd></div>
            <div><dt>LAT</dt><dd>0.6 ms</dd></div>
          </dl>
        </div>

        <div class="lt-node is-clock" {{motion id="clock"}}>
          <span class="lt-ref">A4</span>
          <h3>Clock</h3>
          <p>Ovenised reference</p>
          <dl>
            <div><dt>JITTER</dt><dd>&lt;1 ps</dd></div>
            <div><dt>LOCK</dt><dd>WORD</dd></div>
          </dl>
        </div>

        <div class="lt-node is-desk" {{motion id="desk"}}>
          <span class="lt-ref">B1</span>
          <h3>Desk</h3>
          <p>Summing matrix, 32 in / 8 bus</p>
          <div class="lt-meters">
            {{#each
              (array 62 78 41 90 55 73 34 84 47 68 29 81) key="@index"
              as |v|
            }}
              <span class="lt-meter"><i style="height:{{v}}%"></i></span>
            {{/each}}
          </div>
        </div>

        <div class="lt-node is-monitors" {{motion id="monitors"}}>
          <span class="lt-ref">B2</span>
          <h3>Monitors</h3>
          <p>Three-way, active</p>
          <div class="lt-cones">
            <span class="lt-cone is-lf"></span>
            <span class="lt-cone is-mf"></span>
            <span class="lt-cone is-hf"></span>
          </div>
        </div>

        <div class="lt-node is-patch" {{motion id="patch"}}>
          <span class="lt-ref">C1</span>
          <h3>Patch bay</h3>
          <div class="lt-jacks">
            {{#each
              (array 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16) key="@index"
              as |n|
            }}
              <span class="lt-jack" data-n={{n}}></span>
            {{/each}}
          </div>
        </div>

        {{! the title block, the way a drawing signs itself }}
        <div class="lt-title-block">
          <div class="lt-tb-row"><span>DRAWING</span><b>SIGNAL PATH — STUDIO B</b></div>
          <div class="lt-tb-row"><span>SHEET</span><b>1 OF 1</b></div>
          <div class="lt-tb-row"><span>SCALE</span><b>AS DRAWN</b></div>
        </div>
      </div>

      {{! The marker whose only job is to change on every take — see @take.
          Its id is `take` and not `clock`, because the drawing already has
          a station called Clock and two sprites answering to one id is one
          identity as far as the region is concerned. }}
      {{#if @playing}}
        <span
          class="lt-clock"
          data-take={{@take}}
          aria-hidden="true"
          {{motion id="take"}}
        ></span>
      {{/if}}

      {{! ── THE SCORE ──────────────────────────────────────────────────
          Five constructs, and between them they are every move a camera
          can make over something that is not moving:

            c.Frame     fit this station — the arriving shot
            c.Aim       recentre on it, ZOOM HELD — the travelling shot
            c.Pan       shift by exact pixels — the drift
            c.SlowZoom  multiply the zoom in force — the push under a hold

          Nothing on the board changes while they run. }}
      {{#if @playing}}
        <c.Sequence>
          {{#each this.shots key="@index" as |shot|}}
            {{#if (this.isKind shot "frame")}}
              <c.Frame
                @of={{c.id shot.at}}
                @padding={{shot.fill}}
                @duration={{shot.move}}
                @ease={{this.glide}}
              />
            {{else if (this.isKind shot "aim")}}
              <c.Aim
                @of={{c.id shot.at}}
                @duration={{shot.move}}
                @ease={{this.glide}}
              />
            {{else}}
              <c.Pan
                @x={{shot.x}}
                @y={{shot.y}}
                @duration={{shot.move}}
                @ease={{this.glide}}
              />
            {{/if}}

            {{! THE HOLD IS NOT A FREEZE. A shot that stops dead reads as a
                still; the slow push is what keeps it alive, and it is one
                step rather than a second animation to keep in step. }}
            <c.SlowZoom
              @by={{shot.push}}
              @duration={{shot.hold}}
              @ease="linear"
            />
          {{/each}}
        </c.Sequence>
      {{/if}}
    </Choreo>

    <style>
      .lt-clock {
        position: absolute;
        left: -9999px;
        top: -9999px;
        opacity: 0;
        pointer-events: none;
      }

      .lt-region {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #0a1420;
        color: #cfe6f5;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        user-select: none;
        -webkit-user-select: none;
      }

      .lt-board {
        position: absolute;
        top: 0;
        left: 0;
        width: 1440px;
        height: 932px;
        background:
          radial-gradient(120% 90% at 30% 0%, #14324a 0%, #0a1420 60%), #0a1420;
      }

      /* NO HAIRLINES ANYWHERE INSIDE THIS BOARD.
         A CSS 3D-transformed subtree is rasterised ONCE at its layout
         resolution and then sampled through the matrix, so the inner
         camera's 3x push-in is magnifying a texture rather than redrawing
         it. A 1px stroke lands on a fractional number of device pixels and
         crawls as the camera moves; 2px at half the opacity is the same
         amount of ink on screen and resamples cleanly. Every rule in this
         stylesheet that used to say 1px says 2px for that reason. */
      .lt-grid {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        color: #1e3a52;
        opacity: 0.34;
      }

      .lt-wires {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        fill: none;
        stroke: #2f7fb5;
        stroke-width: 3;
        stroke-linecap: square;
      }

      .lt-node {
        position: absolute;
        padding: 22px 24px 20px;
        border: 2px solid #2f7fb5;
        border-radius: 4px;
        background: #0d1c2c;
        box-shadow: inset 0 0 0 2px #0a1420;
      }

      .lt-ref {
        position: absolute;
        top: -13px;
        left: 18px;
        padding: 1px 8px;
        font-size: 15px;
        letter-spacing: 0.14em;
        color: #6fb7e0;
        background: #0d1c2c;
      }

      .lt-node h3 {
        margin: 0;
        font-size: 30px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: #eaf6ff;
      }

      .lt-node p {
        margin: 6px 0 0;
        font-size: 17px;
        color: #7fa8c4;
      }

      .lt-node dl {
        margin: 16px 0 0;
        display: flex;
        gap: 26px;
        font-size: 15px;
      }

      .lt-node dl div {
        display: flex;
        gap: 8px;
      }

      .lt-node dt {
        color: #56809c;
        letter-spacing: 0.1em;
      }

      .lt-node dd {
        margin: 0;
        color: #9fd4f2;
      }

      .is-capsule {
        left: 90px;
        top: 158px;
        width: 258px;
      }
      .is-preamp {
        left: 430px;
        top: 158px;
        width: 252px;
      }
      .is-converter {
        left: 764px;
        top: 158px;
        width: 252px;
      }
      .is-clock {
        left: 1098px;
        top: 158px;
        width: 252px;
      }
      .is-desk {
        left: 330px;
        top: 470px;
        width: 522px;
      }
      .is-monitors {
        left: 962px;
        top: 470px;
        width: 388px;
      }
      /* clear of the desk on both axes: it used to share the desk's left
         edge exactly, and two boxes that touch read as one box with a line
         through it */
      .is-patch {
        left: 90px;
        top: 706px;
        width: 224px;
      }

      .lt-meters {
        margin-top: 18px;
        height: 84px;
        display: flex;
        align-items: flex-end;
        gap: 10px;
      }

      .lt-meter {
        flex: 1;
        height: 100%;
        display: flex;
        align-items: flex-end;
        background: #0a1420;
        border: 2px solid #16293a;
      }

      .lt-meter i {
        display: block;
        width: 100%;
        background: linear-gradient(180deg, #6fe0c2, #2f7fb5);
      }

      .lt-cones {
        margin-top: 18px;
        display: flex;
        align-items: center;
        gap: 18px;
      }

      .lt-cone {
        border-radius: 50%;
        border: 2px solid #2f7fb5;
        background: radial-gradient(circle at 38% 34%, #17324a, #0a1420 70%);
      }
      .is-lf {
        width: 84px;
        height: 84px;
      }
      .is-mf {
        width: 54px;
        height: 54px;
      }
      .is-hf {
        width: 32px;
        height: 32px;
      }

      .lt-jacks {
        margin-top: 16px;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 8px;
      }

      .lt-jack {
        aspect-ratio: 1;
        border-radius: 50%;
        border: 2px solid #2f7fb5;
        background: #06101a;
      }

      .lt-title-block {
        position: absolute;
        right: 40px;
        bottom: 36px;
        width: 420px;
        border: 2px solid #2f7fb5;
        background: #0d1c2c;
      }

      .lt-tb-row {
        display: flex;
        border-bottom: 2px solid #16293a;
        font-size: 15px;
      }
      .lt-tb-row:last-child {
        border-bottom: 0;
      }
      .lt-tb-row span {
        width: 110px;
        padding: 9px 12px;
        color: #56809c;
        letter-spacing: 0.12em;
        border-right: 2px solid #16293a;
      }
      .lt-tb-row b {
        padding: 9px 12px;
        font-weight: 600;
        color: #cfe6f5;
        letter-spacing: 0.04em;
      }
    </style>
  </template>
}

export default Board;
