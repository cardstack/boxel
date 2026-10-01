/**
 * THE SCHEDULE — everything a film derives from its shot list before a
 * single frame is drawn, as pure functions of the table.
 *
 * A film is its cue table and its camera path: when a beat starts, what
 * fires when, where the lens is at every waypoint, how the chapters are
 * cut. These were getters on the engine; lifting them here changes no
 * number — the engine calls them — and lets the same arithmetic be run
 * headless, in Node, to write the golden fixtures the graph refactor is
 * measured against (`scripts/film-fixtures.mjs`,
 * `tests/unit/film-schedule-test.ts`).
 *
 * Nothing in here reads the clock, the page or the DOM. Everything is a
 * function of `Beat[]` and a few numbers, which is the property the
 * fixtures pin.
 */
import { lerp } from './math.ts';
import type { Beat, Cam, Chapter, Join, JoinName } from './types.ts';

/** one tick of the shot list, in seconds: a beat's `ticks` × this is its length */
export const TICK = 2;

/** the whole film, in seconds, leads included */
export function totalSecs(beats: Beat[]): number {
  return (
    beats.reduce((n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)), 0) *
    TICK
  );
}

/** film seconds before a beat's nominal head, leads included */
export function secsBefore(beats: Beat[], index: number): number {
  return (
    beats
      .slice(0, index)
      .reduce((n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)), 0) *
    TICK
  );
}

/**
 * FILM SECONDS AT WHICH A BEAT'S OWN SHOT BEGINS. The cues fire one tick
 * after the beat table says, because the pose-in-force seed occupies the
 * spline's first slot — so the windows the exact clock derives carry the
 * same offset, and the picture and the type agree with the cut film to
 * the frame. This is the single most load-bearing constant in the film.
 */
export function beatStart(beats: Beat[], i: number): number {
  if (i <= 0) {
    return 0;
  }
  return secsBefore(beats, i) + (beats[i]!.lead ?? 0) * TICK + TICK;
}

/** one cue per beat (and an `air` cue ahead of a led beat), as delays into the score */
export interface Cue {
  action: 'air' | 'beat';
  delay: number;
  index: string;
}

export function cues(beats: Beat[]): Cue[] {
  let t = 0;
  const out: Cue[] = [];
  beats.forEach((b, i) => {
    const lead = i === 0 ? 0 : (b.lead ?? 0);
    if (lead > 0) {
      out.push({ action: 'air', delay: t + TICK, index: String(i) });
    }
    const at = t + lead * TICK;
    t = at + b.ticks * TICK;
    /* cue 0 is exempt from the offset: the boot applies the head beat by
       hand and a guard swallows its immediate re-fire */
    out.push({
      action: 'beat',
      delay: at === 0 ? 0 : at + TICK,
      index: String(i),
    });
  });
  return out;
}

/** the first beat of each chapter, in whole-film indices */
export function chapterHeads(beats: Beat[]): number[] {
  const heads: number[] = [];
  beats.forEach((b, i) => {
    if (heads.length === 0 || beats[heads[heads.length - 1]!]!.ch !== b.ch) {
      heads.push(i);
    }
  });
  return heads;
}

/** the chapter menu's rows: head index, numeral, title, shot count, running time */
export interface Content {
  head: number;
  n: string;
  secs: number;
  shots: number;
  title: string;
}

export function contents(beats: Beat[], chapters: Chapter[]): Content[] {
  const heads = chapterHeads(beats);
  return heads.map((head, i) => {
    const nextHead = heads[i + 1] ?? beats.length;
    const ch = chapters[beats[head]!.ch] ?? chapters[0]!;
    return {
      head,
      n: ch.n,
      secs: beats.slice(head, nextHead).reduce((t, b) => t + b.ticks, 0) * TICK,
      shots: nextHead - head,
      title: ch.title,
    };
  });
}

/** the seam a beat is entered through, or none when it neither cuts nor names one */
export function joinInto(
  beats: Beat[],
  i: number,
  defaultJoin: Join,
): JoinName | null {
  const beat = beats[i]!;
  return beat.cut || beat.join ? (beat.join ?? defaultJoin) : null;
}

/**
 * WHERE A SHOT ENDS — the beat's authored tail, floored so it always reads
 * as a move, and clamped so it never travels past the pose the next shot
 * begins on. Shared by the path (which lerps its waypoints across it) and
 * by the launch: a cut hands the chaser this shot's own speed.
 *
 * A shot must move on screen, not on paper: frame-differencing a capture
 * of the cut showed authored tails of a few degrees reading as stills, so
 * a tail is a DIRECTION and a floor, not a distance — what the beat asks
 * for is honoured, and anything slower than a real slow move is stretched
 * up to one. The floors are per second. And it never travels past where
 * the next shot begins: at a cut that jumped BACKWARDS into the successor.
 */
export function tailFor(beats: Beat[], bi: number): Cam {
  const b = beats[bi]!;
  const drift = b.toCam ?? {
    ...b.cam,
    dolly: b.cam.dolly * 1.05,
    pitch: b.cam.pitch + 1.4,
    yaw: b.cam.yaw + 6,
  };
  const next = beats[bi + 1];
  const secs = b.ticks * TICK;
  const sgn = (d: number) => (d < 0 ? -1 : 1);
  const stretch = (
    key: 'dolly' | 'ox' | 'pitch' | 'yaw',
    floor: number,
  ): number => {
    const head = b.cam[key] ?? 0;
    const d = (drift[key] ?? 0) - head;
    const nose = next ? (next.cam[key] ?? 0) - head : 0;
    /* the direction is the beat's own, or the next shot's if the beat
       asked for nothing at all */
    const way = d !== 0 ? sgn(d) : nose !== 0 ? sgn(nose) : 1;
    const reach = !next
      ? Infinity
      : sgn(nose) === way && nose !== 0
        ? Math.abs(nose)
        : 0;
    const want = Math.min(
      Math.max(Math.abs(d), floor),
      Math.max(Math.abs(d), reach),
    );
    return head + way * want;
  };
  const to = {
    ...drift,
    dolly: stretch('dolly', b.cam.dolly * Math.min(0.22, 0.022 * secs)),
    ox: stretch('ox', Math.min(0.07, 0.008 * secs)),
    pitch: stretch('pitch', Math.min(6, 0.45 * secs)),
    yaw: stretch('yaw', Math.min(22, 2 * secs)),
  };
  return {
    dolly: to.dolly,
    fx: to.fx ?? b.cam.fx ?? 0,
    fz: to.fz ?? b.cam.fz ?? 0,
    lookY: to.lookY,
    ox: to.ox,
    pitch: to.pitch,
    yaw: to.yaw,
  };
}

/** one waypoint of the camera spline, in the terms `c.Camera3D @through` takes */
export interface Waypoint {
  cut?: boolean;
  dolly: number;
  look: { x: number; y: number; z: number };
  pitch: number;
  x: number;
  y: number;
  yaw: number;
}

/**
 * THE PATH. Every beat contributes `ticks` waypoints, lerped from its
 * head to its tail, so waypoint count is screen time; a led beat first
 * contributes `lead` waypoints travelling in from the previous tail; a
 * `cut` beat splices the spline. `recut` marks the first beat as a splice
 * too — a cut film re-cut from a chapter's head has nothing behind it.
 */
export function waypoints(beats: Beat[], recut = false): Waypoint[] {
  const pts: Waypoint[] = [];
  for (const [bi, b] of beats.entries()) {
    const splice = b.cut === true || (bi === 0 && recut);
    const to = tailFor(beats, bi);
    const lead = bi === 0 ? 0 : (b.lead ?? 0);
    const prev = pts[pts.length - 1];
    if (lead > 0 && prev) {
      for (let k = 1; k <= lead; k++) {
        const f = k / (lead + 1);
        pts.push({
          dolly: lerp(prev.dolly, b.cam.dolly, f),
          look: {
            x: lerp(prev.look.x, b.cam.fx ?? 0, f),
            y: lerp(prev.look.y, b.cam.lookY, f),
            z: lerp(prev.look.z, b.cam.fz ?? 0, f),
          },
          pitch: lerp(prev.pitch, b.cam.pitch, f),
          x: lerp(prev.x, b.cam.ox ?? 0, f),
          y: 0,
          yaw: lerp(prev.yaw, b.cam.yaw, f),
        });
      }
    }
    for (let k = 0; k < b.ticks; k++) {
      const f = b.ticks === 1 ? 0 : k / (b.ticks - 1);
      pts.push({
        cut: splice && k === 0 ? true : undefined,
        dolly: lerp(b.cam.dolly, to.dolly, f),
        look: {
          x: lerp(b.cam.fx ?? 0, to.fx ?? 0, f),
          y: lerp(b.cam.lookY, to.lookY, f),
          z: lerp(b.cam.fz ?? 0, to.fz ?? 0, f),
        },
        pitch: lerp(b.cam.pitch, to.pitch, f),
        x: lerp(b.cam.ox ?? 0, to.ox ?? 0, f),
        y: 0,
        yaw: lerp(b.cam.yaw, to.yaw, f),
      });
    }
  }
  return pts;
}

/**
 * THE GOLDEN SCHEDULE: one object per film, everything above at once, in
 * the shape the fixtures are written in. A refactor of the engine that
 * changes any number in here has changed the film.
 */
export interface Schedule {
  beats: {
    ch: number;
    id: string;
    join: JoinName | null;
    lead: number;
    secsBefore: number;
    start: number;
    ticks: number;
  }[];
  contents: Content[];
  cues: Cue[];
  total: number;
  waypoints: Waypoint[];
}

export function schedule(
  beats: Beat[],
  chapters: Chapter[],
  defaultJoin: Join,
): Schedule {
  return {
    beats: beats.map((b, i) => ({
      ch: b.ch,
      id: b.id,
      join: joinInto(beats, i, defaultJoin),
      lead: i === 0 ? 0 : (b.lead ?? 0),
      secsBefore: secsBefore(beats, i),
      start: beatStart(beats, i),
      ticks: b.ticks,
    })),
    contents: contents(beats, chapters),
    cues: cues(beats),
    total: totalSecs(beats),
    waypoints: waypoints(beats),
  };
}
