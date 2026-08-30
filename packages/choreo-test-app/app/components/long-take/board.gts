import { array } from '@ember/helper';
import Component from '@glimmer/component';
import {
  Choreo,
  type DeriveContext,
  motion,
  type PropValue,
} from 'glimmer-motion';
import {
  BOARD,
  GLIDE,
  RUNTIME,
  SHOTS,
} from 'test-app/components/long-take/shots';

/**
 * THE FOLLOW FOCUS.
 *
 * A camera assistant's job on a moving shot is to keep the thing that
 * matters sharp while everything else falls off. This is that, in one
 * derived element: a scrim with a soft hole in it that sits wherever the
 * camera is looking and closes down as the camera leans in.
 *
 * It is a `c.Follow` and not an animation, and the difference is the
 * whole point. There is no from-value and no to-value: the scrim's pose
 * is a pure function of where the frame stands THIS frame. Interrupt the
 * camera halfway, drag it somewhere else, seek the run backwards — the
 * focus is correct on the very next frame, with nothing to re-aim,
 * because it was never aiming at anything. It is reading.
 *
 * The arithmetic is the camera's own transform, inverted. The region is
 * drawn as `translate(camera.x, camera.y) scale(camera.zoom)` about its
 * top-left, so the board point currently under the middle of the screen
 * is `(centre - camera) / zoom`, and an element that must stay the same
 * SIZE on screen while living inside that transform has to be scaled by
 * `1 / zoom`. Both fall out of one number.
 */
const CENTRE = { x: BOARD.w / 2, y: BOARD.h / 2 };

/** how far in the camera goes on the tightest shot, for normalising attention */
const TIGHTEST = 3.4;

const focus = ({ camera, rest }: DeriveContext): Record<string, PropValue> => {
  const k = 1 / camera.zoom;
  // the board point under the centre of the screen, in board coordinates
  const cx = (CENTRE.x - camera.x) * k;
  const cy = (CENTRE.y - camera.y) * k;
  // ATTENTION IS THE ZOOM. Wide, the scrim is barely there and the whole
  // drawing is readable; leaning in, it closes down and the rest of the
  // board falls away. So the focus is not a separate track that has to be
  // kept in step with the camera — it IS the camera, read differently.
  const lean = Math.min(1, Math.max(0, (camera.zoom - 1) / (TIGHTEST - 1)));
  return {
    opacity: 0.1 + 0.74 * lean,
    // the hole tightens as the shot does, on top of holding its size
    scale: k * (1.28 - 0.42 * lean),
    x: cx - (rest.x + rest.width / 2),
    y: cy - (rest.y + rest.height / 2),
  };
};

/** what the follower's properties are at rest, so a measure pass can undo them */
const FOCUS_REST: Record<string, PropValue> = {
  opacity: 0,
  scale: 1,
  x: 0,
  y: 0,
};

/** the signal path, as an engineering drawing rather than as boxes */
const WIRES = [
  'M 348 232 L 430 232',
  'M 682 232 L 764 232',
  'M 1016 232 L 1098 232',
  'M 1214 316 L 1214 392 L 596 392 L 596 470',
  'M 852 586 L 962 586',
  'M 214 316 L 214 700 L 330 700',
];

interface BoardSignature {
  Args: {
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
 * the camera and the focus reading the camera.
 */
export class Board extends Component<BoardSignature> {
  readonly shots = SHOTS;
  readonly wires = WIRES;
  readonly glide = GLIDE;
  readonly runtime = RUNTIME;
  readonly focus = focus;
  readonly focusRest = FOCUS_REST;

  isKind = (shot: (typeof SHOTS)[number], kind: string) => shot.kind === kind;

  <template>
    <Choreo class="lt-region" ...attributes as |c|>
      <div class="lt-board" {{motion id="board"}}>
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
                stroke-width="1"
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

        {{! THE FOLLOW FOCUS. Inside the region, so the camera carries it —
            which is exactly why it has to divide the zoom back out. }}
        <span class="lt-focus" aria-hidden="true" {{motion id="focus"}}></span>
      </div>

      {{! the marker whose only job is to change on every take — see @take }}
      {{#if @playing}}
        <span
          class="lt-clock"
          data-take={{@take}}
          aria-hidden="true"
          {{motion id="clock"}}
        ></span>
      {{/if}}

      {{! ── THE SCORE ──────────────────────────────────────────────────
          Five constructs, and between them they are every move a camera
          can make over something that is not moving:

            c.Frame     fit this station — the arriving shot
            c.Aim       recentre on it, ZOOM HELD — the travelling shot
            c.Pan       shift by exact pixels — the drift
            c.SlowZoom  multiply the zoom in force — the push under a hold
            c.Hold      the beat itself

          Nothing on the board changes while they run. }}
      {{#if @playing}}
        <c.Parallel>
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

          {{! ONE FOLLOWER FOR THE WHOLE FILM. It is not anchored to any
            shot, because it is not about any shot: it reads the camera,
            and the camera is always somewhere. }}
          <c.Follow
            @of={{c.id "focus"}}
            @to={{c.id "board"}}
            @read={{this.focus}}
            @rest={{this.focusRest}}
            @duration={{this.runtime}}
          />
        </c.Parallel>
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

      .lt-grid {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        color: #1e3a52;
        opacity: 0.55;
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
        box-shadow: inset 0 0 0 1px #0a1420;
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
      .is-patch {
        left: 90px;
        top: 646px;
        width: 240px;
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
        border: 1px solid #1e3a52;
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
        border-bottom: 1px solid #1e3a52;
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
        border-right: 1px solid #1e3a52;
      }
      .lt-tb-row b {
        padding: 9px 12px;
        font-weight: 600;
        color: #cfe6f5;
        letter-spacing: 0.04em;
      }

      /* THE SCRIM. Deliberately much larger than the board: it is scaled
         DOWN by the follower (1/zoom), so it has to start big enough that
         its dark outer ring still covers the corners when the camera is
         pushed all the way in. The hole is the transparent middle of a
         radial gradient — a soft edge, because a hard-edged spotlight
         reads as a mask rather than as focus. */
      .lt-focus {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 3400px;
        height: 3400px;
        margin: -1700px 0 0 -1700px;
        pointer-events: none;
        border-radius: 50%;
        background: radial-gradient(
          circle closest-side,
          #04080e00 0%,
          #04080e00 13%,
          #04080ecc 26%,
          #04080ef2 44%,
          #04080e 100%
        );
      }
    </style>
  </template>
}

export default Board;
