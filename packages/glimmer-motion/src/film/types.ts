/**
 * THE FILM VOCABULARY — what a shot list is made of, and what a picture
 * has to offer before a score can cut it.
 *
 * Two hand-built films (Towers, Sagrada) share these one for one; the
 * types are lifted from them rather than designed, which is the only
 * honest way a construct gets its shape. See docs/film-construct.md.
 */

import type { FunctionBasedModifier } from 'ember-modifier';

import type { ClipSpec } from './clips.ts';

export type Pt3 = [number, number, number];

/** a film's handle on one of its own elements, passed to a sub-component */
export type ElementModifier<E extends Element = HTMLElement> =
  FunctionBasedModifier<{
    Args: { Named: object; Positional: unknown[] };
    Element: E;
  }>;

/** the pose the film speaks in — an orbit rig with a focus on the ground */
export interface Cam {
  /** magnification: 1 fits the whole subject, bigger is tighter */
  dolly: number;
  /** where on the ground the lens aims, world units; 0,0 is the subject's axis */
  fx?: number;
  fz?: number;
  /** how far up the building the lens aims, world units from the rig's mid-height */
  lookY: number;
  /** the frame's off-centre, in fractions of the frame */
  ox?: number;
  /** elevation, degrees */
  pitch: number;
  /** the orbit's azimuth, degrees */
  yaw: number;
}

export type Join =
  | 'blend'
  | 'blur'
  | 'cut'
  | 'defocus'
  | 'dip'
  | 'flash'
  | 'iris'
  | 'luma'
  | 'melt'
  | 'sweep'
  | 'whip'
  | 'wipe';

export type PlateMode = 'clear' | 'lower' | 'plate' | 'point' | 'title';

/**
 * ONE BEAT IS ONE SHOT. The shot list is data: an agent edits a film by
 * editing this table, and every field is a fact about the shot rather
 * than a keyframe. The one-task behaviours (walk-then-tilt, the follow
 * rule, the trace gate) read their handles from here.
 */
export interface Beat {
  /** no scrim behind the type: the block sits on the picture bare */
  bare?: boolean;
  /** degrees of vertical sway laid over the shot — a drone breathing */
  bob?: number;
  /** the construction clock (page seconds): one number holds it, a pair runs it */
  build?: [number, number] | number;
  /** the fraction of the beat by which a ranged build is FINISHED (default 1) */
  buildBy?: number;
  /** the pose crossed at the head of this beat */
  cam: Cam;
  /** the chapter this belongs to */
  ch: number;
  /** the surroundings: frosted glass (the default), solid, or gone */
  city?: 'glass' | 'off' | 'on';
  /** a video, a still or a freeze of the picture, over the frame for a window on the film's clock */
  clip?: ClipSpec;
  /** CUT to this pose rather than travel to it */
  cut?: boolean;
  /**
   * THE LINEUP: cycle through subjects inside one held shot, a stamp over
   * each. `style` picks a subject by index, `year` sets the clock through
   * the film's own clock; a step with neither shows the standing subject.
   */
  cycle?: { kanji: string; style?: number; year?: number }[];
  /** the colour a 'dip' passes through */
  dipTo?: string;
  /** the model leaves by fading, not by sinking */
  dissolve?: boolean;
  /** a ground-level eye with a wide lens: standing at `at`, walking to `to` */
  eye?: { at: Pt3; fov: number; to?: Pt3 };
  /** while a part is rising, aim at its top and cap the zoom; a name follows that campaign */
  follow?: false | string;
  /** the English of the word, set small under it */
  gloss?: string;
  /** the mood, by name; overrides the chapter's */
  grade?: string;
  /** the field at the edge of the grid */
  grass?: boolean;
  /** how thick the air is, 0 the hour's own and 1 as heavy as it goes */
  haze?: number;
  /** aim: true holds the subject's mid-height, 'top' holds the cut line */
  hold?: boolean | 'top';
  /** times of day to walk across the beat, evenly */
  hours?: number[];
  /** the share of the beat the hours walk across (default 1): with 0.7
   *  the last hour arrives at 70% and holds for the rest */
  hoursOver?: number;
  /** a designed silence: the boundary fades whatever is still speaking */
  hush?: boolean;
  id: string;
  join?: Join;
  /** the key term — a word in any script */
  kanji?: string;
  /** the eyebrow */
  kicker?: string;
  /** ticks spent arriving, before this beat's own first waypoint */
  lead?: number;
  /** the fraction of the beat spent walking before the head goes back */
  lift?: number;
  /** a bolt, this many seconds into the beat */
  lightning?: number;
  /** a named look, when the chapter's is not wanted */
  look?: string;
  /** the stock: a look the page bakes, a .cube under `assets/luts/`, or null for none */
  lut?: null | string;
  /** a label that stands in the scene at the height it names */
  mark?: {
    at?: number;
    bearing: number;
    hold?: number;
    lines: string[];
    r: number;
    size: number;
    to: number;
  };
  /** trims on the page's buses for this beat (0..1) */
  mix?: { music?: number; sfx?: number; voice?: number; wx?: number };
  /** how the front layer is set */
  mode: PlateMode;
  /** a photograph cut in beside the model; `src` resolves under `assets` */
  photo?: { caption: string; credit: string; src: string };
  /** pin the page's pixel ratio for this beat */
  quality?: number;
  /** how hard it rains, over and above the weather preset */
  rain?: number;
  /** a backlight, standing opposite the lens */
  rim?: number;
  /** the word's reading */
  romaji?: string;
  /** up to four short phrases, delivered across the beat against the read */
  says?: string[];
  /** seconds of stillness before a build clock starts moving */
  settle?: number;
  /** type standing out in the world, behind the subject */
  sky?: {
    az?: number;
    dist?: number;
    lines: string[];
    opacity?: number;
    size: number;
    track?: number;
    y: number;
  };
  /** the year the voice says, written enormous in the scene at `at` of the read */
  stamp?: { at?: number; y: number };
  /** which subject stands here, for a scene with several */
  style?: number;
  /** where the sun is for this shot, degrees */
  sun?: { az: number; el: number };
  /** time of day: 0 morning, 1 noon, 2 sunset, 3 night */
  theme?: number;
  /** how long it runs, in TICKS */
  ticks: number;
  /** a point on the subject this beat is naming, world units */
  to?: Pt3;
  /** the pose at its tail; without one the shot holds */
  toCam?: Cam;
  /** lines drawn ON the subject, in world coordinates */
  trace?: { pts: Pt3[]; wide?: boolean }[];
  /** the voice-over — the script, read and not drawn */
  vo?: string;
  /** settled snow and a pinned blizzard; null clears */
  winter?: null | { gust: number; pack: number };
  /** weather: 0 clear, 1 rain, 2 storm, 3 snow */
  wx?: number;
  /** the weather changes at the beat's head even on a flight (no thaw) */
  wxCut?: boolean;
}

export interface Chapter {
  /** the mood the chapter's shots wear unless a beat says otherwise */
  grade?: string;
  /** the stock the chapter's shots wear unless a beat says otherwise */
  lut?: string;
  /** the chapter's numeral, as the film writes it */
  n: string;
  /** the chapter's accent on a light frame, and on a dark one */
  tint?: string;
  tintD?: string;
  title: string;
}

/** a mood, as numbers the glass can take */
export interface FilmGrade {
  bri: number;
  con: number;
  cool: [number, number, number];
  gradeA: number;
  hue: number;
  rake?: number;
  sat: number;
  sep: number;
  vigA: number;
  warm: [number, number, number];
}

/** how a named look is worn: its strength and the artefacts around it */
export interface LookFx {
  amount: number;
  ca?: number;
  grain?: number;
  lift?: number;
  tone?: number;
  vig?: number;
}

/**
 * THE FILM'S OWN CLOCK, when the picture has one (years, for a building
 * that took a century). `tAt` maps the film's unit to page seconds and
 * `yearAt` back; `span` is the ends of the rule the timeline draws.
 */
export interface FilmClock {
  span: [number, number];
  tAt: (unit: number) => number;
  yearAt: (t: number) => number;
}

/**
 * THE PICTURE — what draws the frame. A separate WebGL page in an iframe
 * for both reference films, addressed through about a hundred plain
 * calls; nothing in the construct knows what is behind this interface,
 * and a third film may put a three.js scene or a video here.
 *
 * Required members are the ones every picture must offer for the score
 * to cut it; the rest are honoured when present.
 */
export interface Picture {
  city?(mode: string, alpha?: number): void;
  clearTrace(id: string): void;
  /** the freeze-blend done in the glass; false when the page cannot */
  dissolve(
    kind: 'blend' | 'dip' | 'melt',
    ms?: number,
    live?: boolean,
  ): boolean;
  duck(v: number): void;
  dur: number;
  fade(id: string, opacity: number): void;
  grade(g: FilmGrade, instant?: boolean): void;
  grass?(on: boolean): void;
  haze(v: null | number): void;
  height(): number;
  /** hold the page's own clock: weather, grass, build, lens — the picture stands */
  hold?(v: boolean): void;
  idle(v: boolean): void;
  light(p: null | { az?: number; el?: number }): void;
  lightning(): void;
  looks?(): string[];
  lut?(
    spec: null | {
      amount?: number;
      ca?: number;
      grain?: number;
      lift?: number;
      look?: string;
      tone?: number;
      url?: string;
      vig?: number;
    },
    instant?: boolean,
  ): void;
  mix(
    m: null | { music?: number; sfx?: number; voice?: number; wx?: number },
  ): void;
  modelFade(k: number | null): void;
  outro?(ms?: number): void;
  palette(): {
    accent: string;
    ink: string;
    ink2: string;
    ink3: string;
    paper: string;
    rule: string;
    time: string;
  };
  pause(v: boolean): void;
  perf?(): { cap: number; dpr: number; frameMs: number; pinned: null | number };
  ping(i: number): void;
  plan?(mode: string): void;
  pose(p: {
    az?: number;
    el?: number;
    fov?: null | number;
    fx?: number;
    fz?: number;
    lookY?: number;
    near?: null | Pt3;
    ox?: number;
    oy?: number;
    snap?: boolean;
    zoom?: number;
  }): void;
  project(
    x: number,
    y: number,
    z: number,
  ): { on: boolean; x: number; y: number; z: number };
  quality?(k: null | number): void;
  rain(k: number | null): void;
  rewind(): void;
  rim(k: number | null, back?: boolean): void;
  rising?(id?: string): null | {
    base: number;
    done: boolean;
    id: string;
    k: number;
    rising: boolean;
    top: number;
    y1: number;
  };
  shot?(name: string): void;
  sky(id: string, spec: object, place: object): void;
  snapshot(): string;
  sound(on: boolean): void;
  speaking(): boolean;
  style?(i: number): number;
  styleIndex?(): number;
  sun(): { h: number; on: boolean; w: number; x: number; y: number };
  tag(v: boolean): void;
  theme(i: number, instant?: boolean): void;
  themeDur(s: null | number): void;
  time(v: number): void;
  trace(
    id: string,
    spec: { color?: string; glow?: string; pts: Pt3[]; r?: number },
  ): void;
  traceDraw(id: string, t: number): void;
  traceFade(id: string, k: number): void;
  traceUndraw?(id: string, t: number): void;
  view(): {
    az: number;
    el: number;
    fov: number;
    h: number;
    w: number;
    zoom: number;
  };
  /** a line of narration through the page's own graph, at `gain` (0..1), from `at` seconds in */
  voice(url: string, gain?: number, at?: number): void;
  voicePrime(url: string): void;
  voiceStop(ms?: number): void;
  /** the master fader, 0..1, under the mix and the mute */
  volume?(v: number): void;
  winter(w: null | { gust: number; pack: number }): void;
  wx(i: number, instant?: boolean): void;
  year?(y: number): void;
}

/** the state the score hands the film every frame the shot changes */
export interface ShotState {
  dolly: number;
  look?: { x: number; y: number; z: number };
  pitch: number;
  x: number;
  y: number;
  yaw: number;
}

/**
 * THE FILM'S HANDLES — what the front door and the end card are given,
 * and what a film's own furniture may call. Every one of these is a
 * gesture the player also makes; a block never reaches into the engine.
 */
export interface FilmHandle {
  /** the beat on screen */
  beat: Beat;
  /** open the door, with or without sound */
  begin: (withSound: boolean) => void;
  /** the chapter on screen */
  chapter: Chapter;
  /** cut to a beat's head — an edit, never a seek */
  cutTo: (index: number) => void;
  /** play any join as a pure overlay on whatever is showing — no cut, no snap */
  preview: (join: Join) => void;
  /** the scene is seated behind the door — the buttons may be pressed */
  ready: boolean;
  /** stand the film at a time and draw it (exact); the nearest shot's head (cut) */
  renderAt: (seconds: number) => Promise<void>;
  /** put the door back up */
  restart: () => void;
  /** the whole film's running time, said the way a poster says it */
  runtime: string;
  /** move the playhead: to the time (exact), or to the nearest shot's head (cut) */
  seek: (seconds: number) => void;
  /** open or close the chapter menu */
  toc: () => void;
}
