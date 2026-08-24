/**
 * A score, and two ways to read it.
 *
 * A score here is a short list of beats — walk to that control, press it, wait
 * — compiled into clips with absolute times. Nothing in it is a pixel or a
 * property: a beat names a `data-cue`, and where that cue IS gets measured off
 * the real stage at the moment the question is asked.
 *
 * The reason for the module is the second way to read it. Playing a score is
 * easy: hold a clock, fire each press as its moment goes by, let Motion animate
 * whatever the click changed. That is what `{{motion animate=…}}` already does
 * and it cannot be seeked — there is no `t` to set.
 *
 * So everything here answers a question of the form "at t, what?" instead:
 *
 *   ghostAt(t)  where the hand is, and how far the button is pressed
 *   stateAt(t)  which clicks have landed by then
 *   poseAt(t)   and therefore what every animated value is MID-FLIGHT
 *
 * `poseAt` is the interesting one. It re-walks the score from zero, keeping for
 * each value a little record of what it is travelling from, to, and since when,
 * and asks Motion's own `spring()` generator — the same generator the engine
 * would be running — for its value at that offset. Play and scrub therefore
 * show the same curve, because it is the same curve.
 *
 * What it does not do, and what a real `valueAt` in <Choreo> would: carry
 * VELOCITY across an interruption. Retarget a value here before it has settled
 * and the new spring starts from the right position with none of the speed it
 * had. Positions stay continuous, which is what scrubbing needs; a value caught
 * mid-flight and re-aimed is a shade lazier than the engine would have been.
 */
import { easeInAndOut } from 'glimmer-motion';
import { type KeyframeGenerator, spring } from 'motion-dom';

export interface Point {
  x: number;
  y: number;
}

/** the shape both this sampler and `{{motion transition=…}}` are given */
export interface Spring {
  bounce?: number;
  damping?: number;
  mass?: number;
  stiffness?: number;
  visualDuration?: number;
}

export interface Beat {
  /** the control this beat is about — matched to a `data-cue` in the stage */
  cue?: string;
  /**
   * `move` walks the hand to the cue, `press` clicks it, `hold` is a pause for
   * the eye. Only a press changes anything.
   */
  kind: 'hold' | 'move' | 'press';
  /** how long the beat lasts, in milliseconds */
  ms: number;
}

export interface Clip extends Beat {
  end: number;
  /** the cue the hand is resting on when the clip begins */
  from?: string;
  start: number;
}

/**
 * Where in a press the click actually lands — not at the start of the beat.
 *
 * A hand goes down, the button fires, the hand comes back up. Firing on the
 * way down is what makes a scripted click read as a click rather than as a
 * state change that happened to have a cursor near it.
 */
const HIT = 0.42;

/** how long the ring left behind by a click takes to fade, in ms */
const RIPPLE = 560;

/** absolute times for a list of beats, and how long the whole thing runs */
export function compile(beats: Beat[]): { clips: Clip[]; duration: number } {
  const clips: Clip[] = [];
  let at = 0;
  let anchor: string | undefined;
  for (const beat of beats) {
    clips.push({ ...beat, end: at + beat.ms, from: anchor, start: at });
    at += beat.ms;
    if (beat.kind === 'move' && beat.cue) {
      anchor = beat.cue;
    }
  }
  return { clips, duration: at };
}

/** the moment a press clip's click lands */
export function hitAt(clip: Clip): number {
  return clip.start + clip.ms * HIT;
}

export function presses(clips: Clip[]): Clip[] {
  return clips.filter((clip) => clip.kind === 'press' && clip.cue);
}

export interface Ghost {
  /** 0 at rest, 1 at the bottom of a press */
  down: number;
  /** 0..1 through the ring a click leaves behind; 1 once it is gone */
  ring: number;
  /**
   * Where that ring sits — the cue that was pressed, not the hand.
   *
   * The ring outlives the press beat, so by the time it has faded the hand has
   * often set off for the next control. A mark left by a click stays where the
   * click was.
   */
  ringX: number;
  ringY: number;
  x: number;
  y: number;
}

/**
 * The hand at t.
 *
 * `place` is asked for a cue's centre in stage coordinates every time, rather
 * than baked in when the score was written. The score says "the Express
 * button"; where that button is, is the stage's business — which is the same
 * reason <Choreo> steps take a query and a beacon instead of a rectangle.
 */
export function ghostAt(
  t: number,
  clips: Clip[],
  place: (cue: string) => Point,
  home: Point
): Ghost {
  const at = (cue?: string) => (cue ? place(cue) : home);
  let x = home.x;
  let y = home.y;

  // the clip in force: the last one that has started
  let live: Clip | undefined;
  for (const clip of clips) {
    if (clip.start > t) {
      break;
    }
    live = clip;
  }

  if (live?.kind === 'move' && live.cue) {
    const a = at(live.from);
    const b = at(live.cue);
    const p = t >= live.end ? 1 : easeInAndOut((t - live.start) / live.ms);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // a slight bow across the path: a hand does not travel on a ruler, and
    // the bow peaks in the middle so both ends still land exactly on the cue
    const bow = Math.min(len * 0.12, 30) * Math.sin(Math.PI * p);
    x = a.x + dx * p + (len ? (-dy / len) * bow : 0);
    y = a.y + dy * p + (len ? (dx / len) * bow : 0);
  } else if (live) {
    const here = at(live.from);
    x = here.x;
    y = here.y;
  }

  let down = 0;
  let ring = 1;
  let ringX = x;
  let ringY = y;
  for (const clip of presses(clips)) {
    if (t >= clip.start && t <= clip.end) {
      const p = (t - clip.start) / clip.ms;
      down = p < HIT ? p / HIT : Math.max(0, 1 - (p - HIT) / (1 - HIT));
    }
    const hit = hitAt(clip);
    if (t >= hit && t < hit + RIPPLE) {
      ring = (t - hit) / RIPPLE;
      const spot = at(clip.cue);
      ringX = spot.x;
      ringY = spot.y;
    }
  }

  return { down, ring, ringX, ringY, x, y };
}

export interface Moment<S> {
  at: number;
  state: S;
}

/**
 * The score folded into states: what the app IS from each click onwards.
 *
 * `step` is the app's own reducer — the same function its click handlers run —
 * so a scrubbed state cannot drift from a clicked one. There is one description
 * of what pressing a cue does, and both readings of the score use it.
 */
export function moments<S>(
  clips: Clip[],
  initial: S,
  step: (state: S, cue: string) => S
): Moment<S>[] {
  const out: Moment<S>[] = [{ at: 0, state: initial }];
  let state = initial;
  for (const clip of presses(clips)) {
    state = step(state, clip.cue!);
    out.push({ at: hitAt(clip), state });
  }
  return out;
}

export function stateAt<S>(t: number, list: Moment<S>[]): S {
  let state = list[0]!.state;
  for (const moment of list) {
    if (moment.at > t) {
      break;
    }
    state = moment.state;
  }
  return state;
}

export type Pose = Record<string, number>;
export type Poses = Record<string, Pose>;

/** what a value is travelling from, to, and since when */
interface Flight {
  from: number;
  since: number;
  to: number;
}

/**
 * Every animated value at t, mid-flight included.
 *
 * Walk the moments up to t. Whenever a moment retargets a value, freeze where
 * that value had got to and start a new flight from there. Then sample every
 * flight at t. Nothing is measured and nothing is read off the DOM: this is the
 * score plus the spring specs, and it would give the same numbers with no
 * browser attached — which is the property a recorder needs.
 */
export function poseAt<S>(
  t: number,
  list: Moment<S>[],
  posesOf: (state: S) => Poses,
  springs: Record<string, Spring>
): Poses {
  const flights: Record<string, Record<string, Flight>> = {};
  for (const [name, pose] of Object.entries(posesOf(list[0]!.state))) {
    flights[name] = {};
    for (const [key, value] of Object.entries(pose)) {
      flights[name]![key] = { from: value, since: 0, to: value };
    }
  }

  for (const moment of list) {
    if (moment.at > t || moment.at === 0) {
      continue;
    }
    const next = posesOf(moment.state);
    for (const [name, tracks] of Object.entries(flights)) {
      for (const [key, flight] of Object.entries(tracks)) {
        const target = next[name]?.[key];
        if (target === undefined || target === flight.to) {
          continue;
        }
        flight.from = sample(flight, moment.at, springs[name]);
        flight.to = target;
        flight.since = moment.at;
      }
    }
  }

  const out: Poses = {};
  for (const [name, tracks] of Object.entries(flights)) {
    const pose: Pose = {};
    for (const [key, flight] of Object.entries(tracks)) {
      pose[key] = sample(flight, t, springs[name]);
    }
    out[name] = pose;
  }
  return out;
}

/**
 * Motion's spring generator, asked for its value at an offset.
 *
 * Generators are closed-form in t and hold no playhead of their own, so one
 * can be kept and asked about any time in any order — which is exactly what
 * dragging a scrubber backwards does.
 */
const cache = new Map<string, KeyframeGenerator<number>>();

function sample(flight: Flight, t: number, spec: Spring = {}): number {
  if (flight.from === flight.to) {
    return flight.to;
  }
  const key = `${flight.from}|${flight.to}|${JSON.stringify(spec)}`;
  let gen = cache.get(key);
  if (!gen) {
    if (cache.size > 300) {
      cache.clear();
    }
    gen = spring({ keyframes: [flight.from, flight.to], ...spec });
    cache.set(key, gen);
  }
  const { done, value } = gen.next(Math.max(0, t - flight.since));
  return done ? flight.to : value;
}
