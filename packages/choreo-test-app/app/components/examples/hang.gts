import { array, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { DialConfig } from 'dialkit/store';
import { modifier } from 'ember-modifier';
import type { DeriveContext } from 'glimmer-motion';
import { beacon, Choreo, motion } from 'glimmer-motion';
import { DialPanel } from 'test-app/components/dial-panel';
import { tuneNumber, tuneSeconds, tuneSpring } from 'test-app/lib/demo-tuning';
import { Dial } from 'test-app/lib/dial';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * Shuffleboard, which is a game about one number: how fast your hand was
 * moving at the instant you let go.
 *
 * Every other stage in this gallery can be played by pressing a button. This
 * one cannot, and that is the point. The puck cannot be carried to where you
 * want it — the shooting area is walled, so the distance has to come out of
 * the THROW, and a throw is a quantity no measurement in a layout pass
 * contains. Choreo can measure where the finger stopped; only `c.gesture`
 * knows how fast it was going when it stopped there.
 *
 * ## Why a flick game and not a physics toy
 *
 * The tempting version of this stage is the one where the puck is handed to
 * `dragMomentum` and slides on Motion's own inertia. It would look right and
 * prove nothing: inertia has no destination and no rules, so the library
 * doing the animating would be the one we did not write.
 *
 * `dragMomentum=false` here on purpose. The throw is READ (release point and
 * release velocity), a resting place is RESOLVED from it (a zone, a knock, or
 * off the end), and only then is the flight AUTHORED to that place with the
 * throw's own speed borrowed as its opening velocity. The flick decides where
 * the puck goes and how the going feels; the rules decide where it is allowed
 * to stop. That split is the thing worth demonstrating, and it is invisible
 * in any demo where the physics is also the answer.
 *
 * ## A wall, not a foul
 *
 * An earlier cut of this had a foul line: let go past it and the throw was
 * scratched. It taught the same lesson and it was miserable to play — a rule
 * that punishes you for the thing the interface let you do. `dragConstraints`
 * says it better. The shooting area is the constraint, so the drag simply
 * stops at the wall and nobody is ever told off. Same lesson, no rule.
 *
 * ## The identity that keeps it honest
 *
 * `COAST` and `SLIDE` are the same number twice. If the projection used to
 * pick the destination disagreed with the spring that flies the puck there,
 * the puck would visibly lie about how hard you threw it — coasting past and
 * being hauled back, or arriving early and creeping the last inch. Any stage
 * that predicts a landing and then animates to it owes itself this check.
 */

/**
 * The two numbers this stage rests on, and the reason the dial spike exists.
 *
 * These shipped hand-tuned: edit a constant, rebuild, throw a puck, decide it
 * was wrong, edit it again. The whole stage's honesty depends on them and on
 * COAST being derived from them, and there was no instrument for the job.
 *
 * `[value, min, max, step]` is dialkit's slider tuple. The panel is drawn by
 * `DialPanel`; the store→tracked bridge is `lib/dial.ts`, and notes/dialkit.md
 * is the evaluation that led here.
 */
const TUNING = {
  damping: [28, 4, 60, 1],
  stiffness: [100, 20, 400, 5],
} satisfies DialConfig;

/** the long glide: overdamped, so it reads as friction rather than a bounce */
const SLIDE = { damping: 28, stiffness: 100 };
/** the shove a puck passes to the puck it hits — short, and all at once */
const KNOCK = { damping: 19, stiffness: 340 } as const;
/** a throw too soft to leave the shooting area, handed back */
const HOME = { damping: 24, stiffness: 300 } as const;
/** off the end, into the gutter */
const OFF = { damping: 28, stiffness: 200 } as const;

/**
 * Seconds of coast — and NOT a free parameter.
 *
 * An overdamped spring decays with a time constant of damping/stiffness, and
 * a puck released at velocity v under exponential decay travels v·τ before it
 * stops. So the distance a throw is projected over must be the spring's own
 * τ, or the projection and the flight are two different physics arguing over
 * one puck. Retune SLIDE and this follows it.
 */
export const coastOf = (spring: { damping: number; stiffness: number }) =>
  spring.damping / spring.stiffness;

export const COAST = coastOf(SLIDE);

/** the shooting area, as a fraction of the lane. A wall, not a rule. */
export const RUNWAY = 0.28;

/**
 * The scoring bands, near to far, as fractions of the lane — and they are
 * spaced by what a hand can actually do. From the wall, with τ = 0.28s, the
 * ladder is roughly: 400 px/s reaches the 1, 900 the 2, 1250 the 3, 1600 the
 * hang, and it takes better than 1900 to throw it away entirely. Every band
 * is inside an ordinary flick, and the failure at the top takes real effort.
 *
 * The hang is deliberately the WIDEST band, not the narrowest. It is the
 * boundary a player is aiming at and the one the preview is least able to
 * promise — `onDrag` is dispatched a frame behind the pointer, so a hand
 * still accelerating is previewed slightly slow. A hair-thin hang would flip
 * to the gutter between the last frame and the release, which reads as the
 * game lying rather than as a hand that was a little heavy.
 */
export const ZONES = [
  { from: 0.44, name: '1', score: 1 },
  { from: 0.62, name: '2', score: 2 },
  { from: 0.76, name: '3', score: 3 },
  { from: 0.9, name: 'hang', score: 4 },
] as const;

const BANDS = ZONES.map((z, i) => ({
  name: z.name,
  style: htmlSafe(
    `left:${z.from * 100}%;width:${((ZONES[i + 1]?.from ?? 1) - z.from) * 100}%`
  ),
}));

/** the puck, in px — the diameter every collision is measured against */
export const PUCK = 44;
export const THROWS = 8;

export type Side = 'blue' | 'red';

export interface Puck {
  id: number;
  side: Side;
  /** the CENTRE, as a fraction of the lane's width */
  x: number;
}

export function scoreOf(x: number) {
  let n = 0;
  for (const z of ZONES) {
    if (x >= z.from) {
      n = z.score;
    }
  }
  return n;
}

/** what the aim preview calls the place the puck is currently headed */
export function callIt(x: number) {
  if (x > 1) {
    return 'off the end';
  }
  if (x <= RUNWAY) {
    return 'too soft';
  }
  const z = scoreOf(x);
  return z === 0 ? 'short' : z === 4 ? 'the hang' : String(z);
}

/**
 * The entire collision model: put the arrival on the board and sweep once,
 * near end to far.
 *
 * The board was already spaced before this throw, so the only pair that can
 * overlap is the one the arrival made — and pushing that puck clear may in
 * turn overlap the next, which the same sweep keeps resolving. A chain
 * reaction, in a loop with no special case in it. Anything shoved past the
 * far end has left the board.
 */
export function settle(board: Puck[], arrival: Puck, gap: number) {
  const next = [...board, arrival].sort((a, b) => a.x - b.x);
  for (let i = 1; i < next.length; i++) {
    if (next[i]!.x - next[i - 1]!.x < gap) {
      next[i] = { ...next[i]!, x: next[i - 1]!.x + gap };
    }
  }
  return {
    off: next.filter((p) => p.x > 1),
    pucks: next.filter((p) => p.x <= 1),
  };
}

/**
 * Shuffleboard's real rule, and the reason a board is worth building: only
 * ONE colour scores, and it scores every puck it has ahead of the other
 * colour's best. So the board is never a running sum of throws — every throw
 * re-reads the whole thing, and one knock can hand the round over.
 */
export function standing(board: Puck[]) {
  const best = (side: Side) =>
    board.reduce((n, p) => (p.side === side && p.x > n ? p.x : n), -1);
  const red = best('red');
  const blue = best('blue');
  if (red === blue) {
    return { lead: null, score: 0 };
  }
  const lead: Side = red > blue ? 'red' : 'blue';
  const mark = lead === 'red' ? blue : red;
  return {
    lead,
    score: board.reduce(
      (n, p) => (p.side === lead && p.x > mark ? n + scoreOf(p.x) : n),
      0
    ),
  };
}

/**
 * The lead line: a hairline standing at the furthest puck on the board.
 *
 * This is the case `c.Follow` exists for, and it is worth being exact about
 * why a keyframe could not do it. The line's destination is not known when
 * the score is written: the furthest puck at the end of this pass might be
 * the one being thrown, or a puck it knocked forward, or the puck that was
 * already leading and never moved — and which of those wins can change PART
 * WAY THROUGH the flight, at a moment nobody can name in advance. `@read`
 * runs every frame over every puck the pass is holding and takes the max, so
 * the line changes allegiance exactly when the lead changes hands.
 *
 * It is handed measured boxes, never the live page, so it cannot read back
 * what it wrote last frame. And `@rest` is `x:0` because the stylesheet has
 * already parked the line at the new leader (`--lead`): at the end of the run
 * the max IS that resting position, the derived value goes to zero on its
 * own, and the handover to rest is seamless rather than a snap.
 */
const lead = ({ rest, sources }: DeriveContext) => {
  let far = -Infinity;
  for (const s of sources) {
    const mid = s.now.x + s.now.width / 2;
    if (mid > far) {
      far = mid;
    }
  }
  return { x: far === -Infinity ? 0 : far - (rest.x + rest.width / 2) };
};
const LEAD_REST = { x: 0 } as const;

const OPENING = 'flick the puck — the ghost shows where it would land';
/** the fastest flick the power bar bothers to draw */
const FULL = 2000;

export class Hang extends Component {
  @tracked pucks: Puck[] = [];
  @tracked thrown = 0;
  /** how many left the board — the gutter is a tally, not a list */
  @tracked lost = 0;
  /** bumped on a dud, to re-key the cradle puck (see `cradle`) */
  @tracked nudge = 0;
  @tracked speed = 0;
  @tracked note = OPENING;

  bands = BANDS;
  throws = THROWS;
  runwayStyle = htmlSafe(`width:${RUNWAY * 100}%`);

  /**
   * The slide spring, live off the dial rather than off a constant.
   *
   * `resolveDialValues` returns `{ damping, stiffness }` — which is already
   * exactly the spring spec `@spring` wants, so the dial's output is handed
   * straight to the score with nothing in between. Move a slider and the
   * region's `treePrint` changes, so the pass replays: you watch the spring
   * you are editing, while you edit it.
   */
  dial = new Dial('hang-slide', 'The slide', TUNING);

  get slide() {
    return this.dial.values as unknown as {
      damping: number;
      stiffness: number;
    };
  }

  /** still derived, still the spring's own time constant — see coastOf */
  get coast() {
    return coastOf(this.slide);
  }

  willDestroy() {
    super.willDestroy();
    this.dial.teardown();
  }

  private laneEl: HTMLElement | null = null;
  private ghostEl: HTMLElement | null = null;
  private powerEl: HTMLElement | null = null;
  /** handed to dragConstraints — Motion measures it and drags inside it */
  pen: { current: HTMLElement | null } = { current: null };

  bindLane = modifier((el: HTMLElement) => {
    this.laneEl = el;
    const surface = el as HTMLElement & { playDemoShot?: () => void };
    surface.playDemoShot = this.demoShot;
    return () => {
      delete surface.playDemoShot;
      this.laneEl = null;
    };
  });

  bindPen = modifier((el: HTMLElement) => {
    this.pen.current = el;
    return () => {
      this.pen.current = null;
    };
  });

  bindGhost = modifier((el: HTMLElement) => {
    this.ghostEl = el;
    return () => {
      this.ghostEl = null;
    };
  });

  bindPower = modifier((el: HTMLElement) => {
    this.powerEl = el;
    return () => {
      this.powerEl = null;
    };
  });

  get side(): Side {
    return this.thrown % 2 === 0 ? 'red' : 'blue';
  }

  get done() {
    return this.thrown >= THROWS;
  }

  /**
   * A dud leaves the board untouched, so there is no layout change for a pass
   * to notice — and the puck would sit there wearing the transform the drag
   * left on it. Re-keying replaces the element instead: the same id removed
   * and inserted in one pass, which is a counterpart pair whose arrival is a
   * fresh, untransformed puck in its proper seat. The flight home is then the
   * ordinary `c.received` flight, borrowing the same gesture a real throw
   * borrows. One mechanism, both outcomes.
   */
  get cradle() {
    return [`${this.thrown}:${this.nudge}`];
  }

  get seats() {
    return this.pucks.map((p) => ({
      id: p.id,
      mark: scoreOf(p.x),
      side: p.side,
      style: htmlSafe(`left:${p.x * 100}%`),
    }));
  }

  get standing() {
    return standing(this.pucks);
  }

  /** where the stylesheet parks the lead line: the furthest puck at rest */
  get leadStyle() {
    return htmlSafe(
      `--lead:${this.pucks.reduce((n, p) => (p.x > n ? p.x : n), 0)}`
    );
  }

  /** the read that both the preview and the throw are decided by */
  private project(clientX: number, vx: number, rect: DOMRect) {
    const at = Math.min(RUNWAY, (clientX - rect.left) / rect.width);
    return at + (vx * this.coast) / rect.width;
  }

  /**
   * The aim preview, and the one piece of this stage that is deliberately
   * NOT in the score.
   *
   * It runs on every pointer move while nothing is animating, so putting it
   * through Glimmer would re-render the region — and re-measure every sprite
   * in it — sixty times a second to move one dashed ring. There is no state
   * here worth keeping: the ghost is a readout of the pointer, it exists only
   * while a finger is down, and the moment the finger lifts the SCORE takes
   * over and the imperative half is done. Written straight to the element.
   *
   * It previews `info.velocity.x` — the same windowed velocity Motion will
   * hand `onDragEnd`, projected through the same `project` — so the ghost is
   * not an approximation of the throw, it is the throw, asked early.
   */
  aim = (event: PointerEvent, info: { velocity: { x: number; y: number } }) => {
    const lane = this.laneEl;
    const ghost = this.ghostEl;
    if (!lane || !ghost) {
      return;
    }
    const rect = lane.getBoundingClientRect();
    const x = this.project(event.clientX, info.velocity.x, rect);
    /**
     * `--at` is clamped so the ring stays on the lane where it can be seen;
     * `data-at` keeps the raw projection, because a throw headed well past
     * the end is a different thing from one that just reaches it and the
     * readout should not quietly round the two together.
     */
    ghost.style.setProperty('--at', String(Math.max(0, Math.min(1, x))));
    ghost.dataset['at'] = x.toFixed(3);
    ghost.dataset['call'] = callIt(x);
    ghost.textContent = callIt(x);
    if (this.powerEl) {
      const p = Math.max(0, Math.min(1, Math.abs(info.velocity.x) / FULL));
      this.powerEl.style.setProperty('--power', String(p));
    }
  };

  private clearAim() {
    this.ghostEl?.style.removeProperty('--at');
    this.ghostEl?.removeAttribute('data-at');
    this.ghostEl?.removeAttribute('data-call');
    this.powerEl?.style.removeProperty('--power');
  }

  /** Guided-tour/capture handle: use the same landing model as a real release. */
  demoShot = () => {
    if (!this.laneEl) {
      return;
    }
    const rect = this.laneEl.getBoundingClientRect();
    const start = RUNWAY * 0.7;
    const destination = this.thrown % 2 ? 0.86 : 0.76;
    this.land(
      new PointerEvent('pointerup', {
        clientX: rect.left + start * rect.width,
      }),
      {
        velocity: {
          x: ((destination - start) * rect.width) / this.coast,
          y: 0,
        },
      }
    );
  };

  rack = () => {
    this.pucks = [];
    this.thrown = 0;
    this.lost = 0;
    this.speed = 0;
    this.note = OPENING;
  };

  /**
   * Read the throw, resolve where it is allowed to stop, change the state.
   *
   * Nothing in here animates anything, and that is worth noticing: the whole
   * flight — the slide, the knock, the dimming, the gutter, the lead line —
   * is the score below, reacting to a board that simply became different.
   */
  land = (
    event: PointerEvent,
    info: { velocity: { x: number; y: number } }
  ) => {
    const lane = this.laneEl;
    this.clearAim();
    if (!lane || this.done) {
      return;
    }
    const rect = lane.getBoundingClientRect();
    this.speed = Math.round(info.velocity.x);
    const x = this.project(event.clientX, info.velocity.x, rect);

    /**
     * Too soft to leave the shooting area. Not a penalty and not a scratch —
     * the puck comes back and the throw is still to come, because a stage
     * that costs you a turn for under-flicking teaches flinching, not aim.
     */
    if (x <= RUNWAY) {
      this.nudge += 1;
      this.note = 'too soft — it never left the pen. Try again, harder.';
      return;
    }

    const mine: Puck = { id: this.thrown, side: this.side, x };
    const { off, pucks } = settle(this.pucks, mine, PUCK / rect.width);
    const rested = pucks.find((p) => p.id === mine.id);

    this.pucks = pucks;
    this.lost += off.length;
    this.thrown += 1;
    this.note = !rested
      ? 'off the end — that was too much'
      : rested.x < ZONES[0]!.from
        ? 'short of the scoring bands, but it is in the way now'
        : off.length > 0
          ? `${scoreOf(rested.x)} — and one knocked clean off`
          : `${scoreOf(rested.x)}`;
  };

  <template>
    <div class="ex hang-ex no-select" {{on "selectstart" preventSelect}}>
      <header class="hang-head">
        <span class="hang-turn is-{{this.side}}">
          {{if this.done "rack empty" (concat this.side " throws")}}
        </span>
        <span class="hang-tally">{{this.thrown}}/{{this.throws}}</span>
        <span class="hang-standing">
          {{#if this.standing.lead}}
            <b class="is-{{this.standing.lead}}">{{this.standing.lead}}</b>
            {{this.standing.score}}
          {{else}}
            <i>tied</i>
          {{/if}}
        </span>
        {{! the wind-up, drawn while the finger is down }}
        <span class="hang-power" {{this.bindPower}}><i></i></span>
        <span class="hang-speed">
          {{#if this.speed}}{{this.speed}} px/s{{/if}}
        </span>
        <button type="button" class="chip" {{on "click" this.rack}}>
          rack again
        </button>
      </header>

      <Choreo class="hang-table" as |c|>
        <div
          class="hang-lane {{unless this.pucks.length 'is-empty'}}"
          style={{this.leadStyle}}
          {{this.bindLane}}
        >
          {{#each this.bands key="name" as |band|}}
            <span class="hang-zone" style={{band.style}}><i
              >{{band.name}}</i></span>
          {{/each}}

          {{! the shooting area. Handed to dragConstraints, so it is a wall
              the puck stops at rather than a line you can be punished for
              crossing — the distance still has to come out of the throw. }}
          <div class="hang-pen" style={{this.runwayStyle}} {{this.bindPen}}>
            {{#unless this.done}}
              {{#each this.cradle key="@identity"}}
                <span
                  class="hang-puck hang-shot is-{{this.side}}"
                  data-test-shot
                  {{motion
                    id=(concat "puck-" this.thrown)
                    role="cradle"
                    drag="x"
                    dragConstraints=this.pen
                    dragMomentum=false
                    dragElastic=(tuneNumber "hang" 0.06 "dragElastic")
                    onDrag=this.aim
                    onDragEnd=this.land
                  }}
                ></span>
              {{/each}}
            {{/unless}}
          </div>

          {{#each this.seats key="id" as |seat|}}
            <span
              class="hang-puck is-{{seat.side}}"
              style={{seat.style}}
              data-test-puck={{seat.id}}
              {{motion id=(concat "puck-" seat.id) role="puck"}}
            >{{seat.mark}}</span>
          {{/each}}

          {{! where it would land if you let go now — see `aim` }}
          <span class="hang-ghost" {{this.bindGhost}}></span>

          <span class="hang-lead" {{motion id="lead"}}></span>
        </div>

        <footer class="hang-foot">
          <span class="hang-note">{{this.note}}</span>
          {{! a place, not a list: pucks that leave fly HERE and are counted.
              The gutter has no element per puck to become, which is exactly
              when a beacon is the right answer and a shared id is not. }}
          <span class="hang-gutter" {{beacon "gutter"}}>
            gutter
            <b>{{this.lost}}</b>
          </span>
        </footer>

        <p class="hang-legend">
          soft lands in the
          <b>1</b>
          · firm reaches the
          <b>3</b>
          · the
          <b>hang</b>
          is the far edge, and a hair more is the gutter
        </p>

        <c.Parallel>
          {{! The throw. The arrival is `received` because the cradle puck
              left and the lane puck claimed its id — two elements, one
              identity. @from replaces the measured start with the pointer,
              and the spring opens at the pointer's velocity, which is the
              one part of a throw no layout pass can supply. }}
          <c.Move
            @of={{c.received "puck"}}
            @from={{c.gesture}}
            @spring={{tuneSpring "hang" this.slide "slide"}}
            @size={{false}}
            @swap="none"
          />

          {{! a dud: same pair, same borrowed gesture, handed back instead }}
          <c.Move
            @of={{c.received "cradle"}}
            @from={{c.gesture}}
            @spring={{tuneSpring "hang" HOME "HOME"}}
            @size={{false}}
            @swap="none"
          />

          {{! the half either arrival claimed, parked in the orphan layer }}
          <c.Tween
            @of={{c.counterpart}}
            @opacity={{0}}
            @duration={{tuneSeconds "hang" 0.1 "Step 1 duration"}}
          />

          {{! The knock. Nothing told these to move: the collision sweep
              changed their seats and the changeset noticed. A different
              spring because it is a different event — a transferred shove
              is not a throw. }}
          <c.Move
            @of={{c.moved "puck"}}
            @spring={{tuneSpring "hang" KNOCK "KNOCK"}}
            @size={{false}}
          />

          {{! and what the throw did NOT disturb dims for the length of it,
              so a four-puck chain reaction reads as one thing. Freeze this
              and you cannot tell what the throw touched. }}
          <c.Hold
            @of={{c.still "puck"}}
            @opacity={{0.38}}
            @duration={{tuneSeconds "hang" 0.55 "Hold duration 1"}}
          />

          {{! shoved off the far end: removed, claimed by nobody, so it has
              nowhere to land. The beacon is the somewhere. }}
          <c.Move
            @of={{c.removed "puck"}}
            @to={{c.beacon "gutter"}}
            @spring={{tuneSpring "hang" OFF "OFF"}}
          />
          <c.Tween
            @of={{c.removed "puck"}}
            @opacity={{0}}
            @duration={{tuneSeconds "hang" 0.42 "Step 2 duration"}}
          />

          {{! the lead line, derived per frame from every puck on the board }}
          <c.Follow
            @of={{c.id "lead"}}
            @to={{c.kept "puck"}}
            @read={{lead}}
            @rest={{LEAD_REST}}
            @duration={{tuneSeconds "hang" 1.6 "Follow duration 2"}}
          />

          {{! the next puck into the pen, once the last one is away }}
          <c.Tween
            @of={{c.inserted "cradle"}}
            @opacity={{array 0 1}}
            @scale={{array 0.5 1}}
            @duration={{tuneSeconds "hang" 0.24 "Step 3 duration"}}
            @delay={{0.12}}
          />
        </c.Parallel>
      </Choreo>

      <DialPanel @dial={{this.dial}} />
    </div>
  </template>
}

export default Hang;

// Declare the demo variables before the first interactive Choreo pass.
tuneNumber('hang', 0.06, 'dragElastic');
tuneSpring('hang', HOME, 'HOME');
tuneSeconds('hang', 0.1, 'Step 1 duration');
tuneSpring('hang', KNOCK, 'KNOCK');
tuneSeconds('hang', 0.55, 'Hold duration 1');
tuneSpring('hang', OFF, 'OFF');
tuneSeconds('hang', 0.42, 'Step 2 duration');
tuneSeconds('hang', 1.6, 'Follow duration 2');
tuneSeconds('hang', 0.24, 'Step 3 duration');
