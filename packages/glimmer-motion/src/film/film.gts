import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import { Choreo, type ChoreoContext } from '../choreo.gts';
import { at } from '../choreo/anchors.ts';
import type { ChoreoRun } from '../choreo/run.ts';
import type { PerformCommand } from '../choreo/types.ts';
import motion from '../motion.ts';
import { Clip } from './clip.gts';
import { type ClipState, resolveClip, type ResolvedClip } from './clips.ts';
import { JOIN_SECS, Joins, STILL_JOINS } from './joins.gts';
import { lerp, luminance, RAD, rgba, smooth, wrapAngle } from './math.ts';
import { Captions, Insert, Stamp, Track } from './overlays.gts';
import { Plate } from './plate.gts';
import { Burst, Menu, Player } from './player.gts';
import { Rail, type RailMark } from './rail.gts';
import { EndCard, Gate } from './titles.gts';
import type {
  Beat,
  Cam,
  Chapter,
  FilmClock,
  FilmGrade,
  FilmHandle,
  Join,
  LookFx,
  Picture,
  ShotState,
} from './types.ts';

/**
 * `<Film>` — a headless cutting room, in which a 3D scene takes the place
 * of the video track.
 *
 * The model is an editor: one clock, a shot list dropped onto it, and
 * components that read the clock — the lens, the joins, the type, the
 * voice, the timeline. The film is a pure function of that clock, which
 * is why a beat can be widened and the type, the voice, the transport
 * and the readout all re-time together. The picture is whatever the film
 * hands in through the `Picture` port; two reference films hand in a
 * WebGL page in an iframe (notes/film-construct.md).
 *
 * THE CAMERA. The score authors the shot and the lens CHASES it: one
 * critically-damped stage here, the page's own chase as the second, so
 * two integrators in series bound the jerk. That is what gives the films
 * their hand-held quality, and it is exactly what forfeits seeking — so
 * a skip here is an edit, never a seek: the score is re-cut from a
 * chapter's head and replays.
 *
 * WHAT THE POSE ARGS MEAN (an orbit rig):
 *   yaw    → the orbit's azimuth, degrees
 *   pitch  → elevation, degrees
 *   dolly  → magnification: 1 fits the subject, bigger is tighter
 *   lookY  → how far up the subject the lens aims, from the rig's mid-height
 *   fx, fz → where on the ground the lens aims
 *   ox     → an off-centre frustum, fractions of the frame
 */

/**
 * ONE TICK IS TWO SECONDS, and every beat is a whole number of them.
 * `@through` splits its clock evenly between waypoints, so a beat buys
 * the screen time it wants by contributing that many waypoints to the
 * path — and a beat that wants to HOLD contributes the same pose several
 * times over, which a Catmull-Rom spline comes smoothly to rest on.
 */
export const TICK = 2;

/**
 * `?awake` keeps the loops running in a document that reports itself
 * hidden — an embedded preview pane, a headless runner — where the idle
 * gate would otherwise (correctly) stop the film dead. Tooling only.
 */
const AWAKE = new URLSearchParams(window.location.search).has('awake');

/** how much each mood brightens the frame, for judging the ink against it */
const GRADE_LUM: Record<string, number> = {
  amber: 1.08,
  chalk: 1.27,
  ink: 1.0,
  iron: 0.9,
  plate: 1.09,
};

export interface FilmSignature {
  Args: {
    /** the editorial accent on a dark frame, and on a light one (the scene's own palette when unset) */
    accent?: { dark: string; light?: string };
    /** where the film's own files live: `vo/<id>.mp3`, `luts/*.cube`, photographs */
    assets: string;
    /** the shot list */
    beats: Beat[];
    /** which cut of the film this is: logged at boot, shown under `?debug` */
    build?: string;
    chapters: Chapter[];
    /** how much of a frosted city a film frame can carry (the page's own is 0.30) */
    cityGlass?: number;
    /** the film's own clock, when the picture keeps one (years) */
    clock?: FilmClock;
    /** how much a passing cloud thickens the air */
    cloudHaze?: number;
    /** mounted in a page's iframe: no door, no transport, begins muted */
    embed?: boolean;
    /** how much each mood brightens the frame — see `wear` */
    gradeLum?: Record<string, number>;
    /** the moods, as numbers the glass can take */
    grades?: Record<string, FilmGrade>;
    /** the seam a beat gets when it names none */
    join?: Join;
    /** how each named look is worn */
    lookFx?: Record<string, LookFx>;
    /** how much of a stock the picture wears when a beat names one */
    lutAmount?: number;
    /** the chapter menu's second line */
    menuSub?: string;
    /** the film's name, as the menu heads it */
    menuTitle: string;
    /** a short name for the film (a body class, the boot log) */
    name: string;
    /** the air of a shot has been applied: grade, sun, weather — a hook for what the construct does not know */
    onAir?: (beat: Beat, picture: Picture, hard: boolean) => void;
    /** a beat has landed — a hook for what the construct does not know */
    onBeat?: (beat: Beat, picture: Picture) => void;
    /** how the door is lit: the hour and the key light, degrees */
    poster?: { light?: { az: number; el: number }; theme?: number };
    /**
     * THE RAIL — the film on one line, on the picture: chapters as dots
     * on a rule, the head riding it, the year when the rule is a clock.
     * It is the second film's transport and not every film's: a film
     * whose own bar is the whole story of its progress says `false` and
     * keeps the floating player alone.
     */
    rail?: boolean;
    /** the rig's mid-height: `lookY` is world height minus this */
    rigMid?: number;
    /** told once when the picture arrives, before the door: what it should show */
    seat?: (picture: Picture) => void;
    /**
     * HOW THE FILM SEEKS — the fork everything hangs on.
     *
     * `cut` (the default) is the hand-held film: a cascaded spring chases
     * the score, which is what gives the lens its sway and its arrival at
     * pace, and exactly what forfeits random access — a spring's state is
     * its history, so a skip re-cuts the score from a chapter's head.
     *
     * `exact` makes the whole film a pure function of one clock: no
     * integrator in the pose path, the beat in force derived from the
     * time, the seams driven by it, the type's run seeked to it. Scrub
     * anywhere and the frame is correct; `renderAt(t)` on a fresh page is
     * the same frame as playing there. The price is the hand: the lens
     * follows the spline with a deterministic breath instead of a spring,
     * and every seam holds a still of the outgoing frame (a read-back per
     * cut) because the page's own dissolves run on their own clock.
     */
    seek?: 'cut' | 'exact';
    /** the picture's page, mounted in an iframe */
    src: string;
    /** the page's clock at which the subject stands whole */
    standing: number;
    /** the iframe's accessible name */
    title: string;
    /** the level each line was mixed to (0..1) */
    voGain?: Record<string, number>;
    /** what each read actually runs, seconds, measured — never estimated */
    voSecs?: Record<string, number>;
    /** how type standing out in the world is set */
    worldType?: { family?: string; track?: number; weight?: number };
  };
  Blocks: {
    /** under the stage, outside the picture: a wall plate, a cutting room */
    default: [FilmHandle];
    /** the back matter, inside the end card */
    end: [FilmHandle];
    /** the front matter, on the door */
    gate: [FilmHandle];
  };
}

export class Film extends Component<FilmSignature> {
  /* ---- what the film was handed ------------------------------------ */
  /** the whole shot list */
  private get all(): Beat[] {
    return this.args.beats;
  }

  private get chapters(): Chapter[] {
    return this.args.chapters;
  }

  private get voSecs(): Record<string, number> {
    return this.args.voSecs ?? {};
  }

  private get voGain(): Record<string, number> {
    return this.args.voGain ?? {};
  }

  private get grades(): Record<string, FilmGrade> {
    return this.args.grades ?? {};
  }

  private get lookFx(): Record<string, LookFx> {
    return this.args.lookFx ?? {};
  }

  private get lutAmount(): number {
    return this.args.lutAmount ?? 0.52;
  }

  private get defaultJoin(): Join {
    return this.args.join ?? 'dip';
  }

  /** how much of a frosted city a film frame can carry */
  private get cityGlass(): number {
    return this.args.cityGlass ?? 0.16;
  }

  /** the rig's mid-height: `lookY` is world height minus this */
  private get rigMid(): number {
    return this.args.rigMid ?? 6.6;
  }

  /** how much the passing cloud thickens the air */
  private get cloudHaze(): number {
    return this.args.cloudHaze ?? 0.09;
  }

  /** the face type in the world is set in; a film that names none of it
   *  leaves the page's own */
  private get worldFamily(): string | undefined {
    const w = this.args.worldType;
    return w
      ? w.family
      : 'Archivo, "Helvetica Neue", Helvetica, Arial, sans-serif';
  }

  private get worldWeight(): number | undefined {
    const w = this.args.worldType;
    return w ? w.weight : 800;
  }

  private get worldTrack(): number {
    return this.args.worldType?.track ?? 0.02;
  }

  /** the editorial accent: the film's own, or the scene's palette by day */
  private accentFor(dark: boolean, scene?: string): string {
    const a = this.args.accent ?? { dark: '#d9b44a', light: '#8f6b1f' };
    return dark ? a.dark : (a.light ?? scene ?? '#8f6b1f');
  }

  /** the film's handles, as the door and the card are given them */
  get handle(): FilmHandle {
    return {
      beat: this.beat,
      begin: this.begin,
      chapter: this.chapter,
      cutTo: this.pick,
      preview: this.preview,
      ready: this.ready,
      renderAt: this.renderAt,
      restart: this.restart,
      runtime: this.runtime,
      seek: this.seek,
      toc: this.toc,
    };
  }

  /* ---- THE CLOCK, when the film is exact ---------------------------- *
   * One number, seconds into the whole film. The frame loop advances it
   * while playing; a scrub sets it; everything else is derived from it —
   * the beat in force, the seam in progress, the score's and the type's
   * run times, the pose. Nothing below accumulates.
   * ------------------------------------------------------------------ */
  private get exact(): boolean {
    return this.args.seek === 'exact';
  }

  /** the master clock: seconds into the whole film (exact mode) */
  private t = 0;
  /** a seek happened since the last fold: it lands instantly, seam re-made */
  private jumped = false;
  /** the score region's context, read every frame for its current run */
  private scoreCtx: ChoreoContext | null = null;
  private scoreRun: ChoreoRun | null = null;
  /** the type region's context, handed up by the Plate */
  private plateCtx: ChoreoContext | null = null;
  private plateRun: ChoreoRun | null = null;
  /** the element the seam overlays live in, so their animations can be seeked */
  private joinsEl?: HTMLElement;
  /** where the seam on screen began, film seconds, and how long it plays */
  private seamAt = -1;
  private seamLen = 0;
  /** the lead whose air has been applied ahead of its beat */
  private airedFor = -1;
  /** where the sun was before this beat asked, for a deterministic walk */
  private sunFrom: { az: number; el: number } | null = null;

  /* ---- CLIPS --------------------------------------------------------- *
   * A video, a still or a freeze of the picture over the frame, for a
   * window on the film's clock (clips.ts). The state is re-derived every
   * frame; the DOM changes only when the state does; the media element
   * is driven to its source time, never left to its own clock.
   * ------------------------------------------------------------------ */
  /** the clip on screen: which beat's, and how it stands */
  @tracked private clipKey = '';
  @tracked private clipState: ClipState = 'absent';
  /** the picture read back, for a freeze */
  @tracked private clipFreeze = '';
  private clipNow: ResolvedClip | null = null;
  private clipMedia?: HTMLElement;

  private clipEl = modifier((el: HTMLElement) => {
    this.clipMedia = el;
    return () => {
      if (this.clipMedia === el) {
        this.clipMedia = undefined;
      }
    };
  });

  get clipSrc(): string {
    const src = this.clipNow?.spec.src;
    return src ? `${this.args.assets}${src}` : '';
  }

  get clipSpec() {
    return this.clipNow?.spec ?? { kind: 'image' as const };
  }

  /**
   * THE CLIP, EVERY FRAME. Resolve what should be on screen at this film
   * time, land the DOM when that changes (a new window is a new element,
   * so the entrance replays), and drive the media: a playing video is
   * left to run and corrected when it drifts, a paused or scrubbed one
   * is seeked, a held one stands at its out point, a frozen one is left
   * alone. A freeze reads the picture back when its window opens — or,
   * on a seek into it, after the page has been stood at that moment.
   */
  private clips(film: Picture, filmTime: number, jumped: boolean) {
    const found = resolveClip(
      this.all,
      (i) => this.beatStart(i),
      filmTime,
      this.absoluteIndex,
      this.totalSecs,
    );
    const key = found ? `${this.all[found.index]!.id}` : '';
    const was = this.clipNow;
    this.clipNow = found;
    if (key !== this.clipKey) {
      this.clipKey = key;
      this.clipFreeze = '';
      if (found?.spec.kind === 'freeze') {
        /* the picture as it stands at the window's head. A seek into the
           window lands after the head: stand the page there first */
        if (jumped || found.since > 0.1) {
          this.freezeClipAt(found, filmTime);
        }
        const shot = film.snapshot();
        this.clipFreeze = shot.length > 64 ? shot : '';
      }
    }
    const state = found?.state ?? 'absent';
    if (state !== this.clipState) {
      this.clipState = state;
    }
    /* A CLIP'S SOUND NEVER STEPS. The element arrives at zero and is
       eased up to its level, and when its window closes it is eased back
       down before the exit fade takes the element away — a source that
       starts or stops at level is a click, whatever it is playing. */
    if (!found || found.spec.kind !== 'video') {
      const gone = this.clipMedia;
      if (gone instanceof HTMLVideoElement && gone.volume > 0.001) {
        gone.volume = Math.max(0, gone.volume - 0.12);
      }
      return;
    }
    const v = this.clipMedia;
    if (!(v instanceof HTMLVideoElement) || found.source === null) {
      return;
    }
    const level = Math.max(0, Math.min(1, found.spec.volume ?? 0));
    if (was?.index !== found.index) {
      v.volume = 0;
    }
    const closing = found.state !== 'active' ? 0 : level;
    if (Math.abs(v.volume - closing) > 0.002) {
      v.volume = v.volume + (closing - v.volume) * 0.28;
    }
    const rate = found.spec.rate ?? 1;
    const live =
      found.state === 'active' &&
      this.playing &&
      this.scrubAt === null &&
      !jumped;
    if (live) {
      if (v.paused) {
        v.currentTime = found.source;
        v.playbackRate = rate;
        void v.play().catch(() => {});
      } else if (Math.abs(v.currentTime - found.source) > 0.2) {
        v.currentTime = found.source;
      }
    } else {
      if (!v.paused) {
        v.pause();
      }
      if (Math.abs(v.currentTime - found.source) > 0.04) {
        v.currentTime = found.source;
      }
    }
  }

  /**
   * THE PICTURE AT A MOMENT THAT HAS PASSED. A freeze seeked into needs
   * the frame from its window's head: the score is stood there for one
   * evaluation (the camera step reports the pose), the page is posed and
   * clocked to that moment, and the fold's own time is restored after
   * the read-back.
   */
  private freezeClipAt(clip: ResolvedClip, filmTime: number) {
    const film = this.film;
    const run = this.scoreCtx?.run ?? null;
    if (!film || !run) {
      return;
    }
    const head = filmTime - clip.since;
    const b = this.all[clip.index]!;
    const local = Math.min(
      1,
      Math.max(0, (head - this.beatStart(clip.index)) / (b.ticks * TICK)),
    );
    run.pause();
    run.time = head;
    const g = this.goal;
    film.pose({
      az: g.yaw * RAD,
      el: g.pitch * RAD,
      fov: null,
      fx: g.fx ?? 0,
      fz: g.fz ?? 0,
      lookY: g.lookY,
      near: null,
      ox: g.ox ?? 0,
      snap: true,
      zoom: g.dolly,
    });
    if (Array.isArray(b.build)) {
      film.time(
        lerp(
          b.build[0],
          b.build[1],
          smooth(Math.min(1, local / (b.buildBy ?? 1))),
        ),
      );
    }
    run.time = this.exact ? this.t : run.time;
  }

  /**
   * FILM SECONDS AT WHICH A BEAT'S OWN SHOT BEGINS. The cues fire one
   * tick after the beat table says, because the pose-in-force seed
   * occupies the spline's first slot — so the windows the exact clock
   * derives carry the same offset, and the picture and the type agree
   * with the cut film to the frame.
   */
  private beatStart(i: number): number {
    if (i <= 0) {
      return 0;
    }
    return this.secsBefore(i) + (this.all[i]!.lead ?? 0) * TICK + TICK;
  }

  /** the beat in force at a film time */
  private indexAt(t: number): number {
    let i = 0;
    while (i + 1 < this.all.length && this.beatStart(i + 1) <= t) {
      i += 1;
    }
    return i;
  }

  /** the score's region, held so its run can be driven by the clock */
  private grabScore = modifier((_el: Element, [ctx]: [ChoreoContext]) => {
    this.scoreCtx = ctx;
    return () => {
      if (this.scoreCtx === ctx) {
        this.scoreCtx = null;
      }
    };
  });

  /** the type's region, handed up by the Plate */
  private grabPlate = (ctx: ChoreoContext | null) => {
    this.plateCtx = ctx;
  };

  private joinsWrap = modifier((el: HTMLElement) => {
    this.joinsEl = el;
    return () => {
      if (this.joinsEl === el) {
        this.joinsEl = undefined;
      }
    };
  });

  /** the score must stand even while paused: a paused exact film is a still */
  get scoreOn(): boolean {
    return this.playing || this.exact;
  }

  /**
   * SEEK. In exact mode the clock is set and the next fold lands there;
   * in cut mode the nearest shot's head is re-cut to, which is the only
   * honest seek a chased lens has.
   */
  private seek = (seconds: number) => {
    if (!this.exact) {
      let i = 0;
      while (i + 1 < this.all.length && this.secsBefore(i + 1) <= seconds) {
        i += 1;
      }
      this.cutTo(i);
      return;
    }
    const total = this.totalSecs;
    this.t = Math.max(0, Math.min(total, seconds));
    this.jumped = true;
    this.menu = false;
    if (this.ended && this.t < total) {
      this.ended = false;
      this.idled = false;
      this.film?.idle(false);
    }
    if (this.booted && this.film) {
      this.fold();
    }
  };

  /**
   * A STILL AT A TIME, for a capture worker: pause, seek, run one frame
   * of the loop against a zero step, and give the page two frames to
   * draw it. The same code path as playing there — that is the claim.
   */
  private renderAt = async (seconds: number) => {
    if (!this.exact) {
      this.seek(seconds);
      return;
    }
    this.playing = false;
    this.seek(seconds);
    const now = performance.now();
    this.lastTick = now;
    this.tick(now);
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  };

  /**
   * THE FOLD (exact mode): the beat in force is the one whose window
   * holds the clock; entering it — forward by playing, or by a seek in
   * either direction — applies it whole, because every beat asserts its
   * complete state and never inherits. A seek that lands inside a seam
   * re-makes the outgoing frame first, so the seam plays from the middle
   * exactly as it would have played into it.
   */
  private fold() {
    const film = this.film;
    if (!film) {
      return;
    }
    const t = this.t;
    const i = this.indexAt(t);
    const jumped = this.jumped;
    this.jumped = false;
    /* the air of a lead: the sky turns while the lens is still travelling */
    const next = this.all[i + 1];
    if (
      next &&
      (next.lead ?? 0) > 0 &&
      t >= this.secsBefore(i + 1) + TICK &&
      this.airedFor !== i + 1
    ) {
      this.airedFor = i + 1;
      this.applyAir(next, false);
    }
    if (i !== this.beatIndex || jumped) {
      const beat = this.all[i]!;
      const since = t - this.beatStart(i);
      if (jumped) {
        this.settleAir(i);
        this.airedFor = -1;
        this.freeze = '';
      }
      const join =
        beat.cut || beat.join ? (beat.join ?? this.defaultJoin) : null;
      const len = join ? (JOIN_SECS[join] ?? 0) : 0;
      this.seamAt = -1;
      this.seamLen = 0;
      const inSeam = !!join && since < len && i > 0;
      let frozen = false;
      if (inSeam && jumped) {
        frozen = this.refreeze(i - 1);
      }
      if (inSeam) {
        this.seamAt = this.beatStart(i);
        this.seamLen = len;
      }
      this.beatIndex = i;
      this.applyBeat(beat, jumped, { frozen, seam: inSeam, since });
      if (jumped) {
        this.speakAt(beat, since);
      }
    }
    /* the seam on screen is a function of the clock: its animations are
       paused and stood at the time the seam has been playing */
    if (this.seamAt >= 0) {
      const ms = Math.max(0, (t - this.seamAt) * 1000);
      for (const a of this.joinsEl?.getAnimations({ subtree: true }) ?? []) {
        a.pause();
        a.currentTime = ms;
      }
      if (t - this.seamAt > this.seamLen + 0.3 || t < this.seamAt) {
        this.seamAt = -1;
        this.joinKind = '';
      }
    }
    /* the runs are driven, not played: the score's to the film's clock,
       the type's to the beat's */
    const run = this.scoreCtx?.run ?? null;
    if (run !== this.scoreRun) {
      this.scoreRun = run;
      run?.pause();
    }
    if (run) {
      run.time = t;
    }
    const plate = this.plateCtx?.run ?? null;
    if (plate !== this.plateRun) {
      this.plateRun = plate;
      plate?.pause();
    }
    if (plate) {
      plate.time = Math.max(0, t - this.beatStart(i));
    }
    if (t >= this.totalSecs && !this.ended) {
      this.end();
    }
  }

  /**
   * THE OUTGOING FRAME, RE-MADE. A seek into a seam has no still of the
   * shot before it, so the page is stood at that shot's tail — its clock,
   * its hour, its weather, its pose — and read back once, before the
   * incoming beat is applied over it.
   */
  private refreeze(prev: number): boolean {
    const film = this.film;
    const b = this.all[prev];
    if (!film || !b) {
      return false;
    }
    this.settleAir(prev);
    if (film.style && film.styleIndex && film.styleIndex() !== (b.style ?? 0)) {
      film.style(b.style ?? 0);
    }
    film.time(
      Array.isArray(b.build) ? b.build[1] : (b.build ?? this.args.standing),
    );
    film.modelFade(b.dissolve ? 0 : 1);
    const tail = this.tailFor(prev);
    film.pose({
      az: tail.yaw * RAD,
      el: tail.pitch * RAD,
      fov: null,
      fx: tail.fx ?? 0,
      fz: tail.fz ?? 0,
      lookY: tail.lookY,
      near: null,
      ox: tail.ox ?? 0,
      snap: true,
      zoom: tail.dolly,
    });
    const shot = film.snapshot();
    this.freeze = shot.length > 64 ? shot : '';
    return !!this.freeze;
  }

  /** a line, from the middle: what a seek owes the voice */
  private speakAt(beat: Beat, since: number) {
    this.hush();
    if (!beat.vo || !this.sound) {
      this.film?.duck(1);
      return;
    }
    const read = this.voSecs[beat.id] ?? beat.ticks * TICK * 0.66;
    if (since < read - 0.3) {
      this.film?.voice(this.voSrc(beat), this.voGain[beat.id] ?? 1, since);
      this.primeNext(beat);
    } else {
      this.film?.duck(1);
    }
  }

  /**
   * THE SEAM, EXACT. Every join that carries the outgoing frame carries it
   * as a still in the DOM — the page's own dissolves run on the page's
   * clock and cannot be stood at a time — and the whip, which is the
   * chaser's, becomes a cut. The overlay is then driven by the fold.
   */
  private seamExact(
    film: Picture,
    beat: Beat,
    join: Join,
    seam?: { frozen: boolean; seam: boolean; since: number },
  ) {
    const wants = seam ? seam.seam : true;
    const stills =
      join !== 'cut' && join !== 'flash' && join !== 'sweep' && join !== 'whip';
    if (wants && stills && !seam?.frozen) {
      const shot = film.snapshot();
      this.freeze = shot.length > 64 ? shot : '';
    }
    if (!wants) {
      this.freeze = '';
    }
    if (beat.cut || join === 'wipe' || join === 'whip') {
      this.snap(beat.cam);
    }
    if (!wants) {
      return;
    }
    switch (join) {
      case 'cut':
      case 'whip':
        break;
      case 'dip':
        this.dipColor = beat.dipTo ?? '#0d0905';
        this.play('dip');
        break;
      case 'flash':
        this.play('flash');
        break;
      case 'sweep':
        this.lightSweep(film, beat);
        break;
      case 'defocus':
        if (this.freeze) {
          this.play('defocus');
        }
        break;
      case 'iris': {
        if (!this.freeze) {
          break;
        }
        const v = film.view();
        const p = beat.to ? film.project(...beat.to) : undefined;
        const cx = p ? Math.max(12, Math.min(88, (p.x / v.w) * 100)) : 50;
        const cy = p ? Math.max(12, Math.min(88, (p.y / v.h) * 100)) : 50;
        this.irisAt = `--ix:${cx.toFixed(1)}%;--iy:${cy.toFixed(1)}%`;
        this.play('iris');
        break;
      }
      default:
        if (this.freeze) {
          this.play(join);
        }
    }
  }

  /** the last cue has run: hold the pose, settle the music, offer the card */
  private end() {
    this.playing = false;
    this.ended = true;
    /* the voice goes out with the picture, not under it: a line still
       running at the end is faded over a second, never cut */
    this.film?.voiceStop(1000);
    /* AND THE SCORE ENDS WITH IT. Ducking a step left the bed looping
       under the end card for as long as the card was up — a film that
       has finished playing over music that has not. It goes out over
       four seconds, which is long enough to read as an ending and short
       enough that the card is quiet before anybody clicks anything. */
    if (this.film?.outro) {
      this.film.outro(4200);
    } else {
      this.film?.duck(0.35);
    }
  }

  /** the beat on screen; the score names it, the front layer renders it */
  @tracked private beatIndex = 0;
  @tracked private playing = true;
  /** bumping this edits the score, which is how a finite film loops */
  @tracked private lap = 0;
  @tracked private booted = false;
  /** which seam is playing, and a key that replays it: bumped on every cut */
  @tracked private joinKind: '' | Join = '';
  @tracked private joinStamp = 0;
  /** the captured outgoing frame every freeze-based join plays with */
  @tracked private freeze = '';
  /** the 'dip' join's veil colour */
  @tracked private dipColor = '#0d0905';
  /** where the iris closes to, as inline custom properties */
  @tracked private irisAt = '';
  /** dev beacon: the first uncaught error, worn on the sleeve */
  @tracked private fault = '';

  /** run a seam's overlay: a new element per cut, from its own first frame */
  private play(kind: Join) {
    this.joinKind = kind;
    this.joinStamp += 1;
  }
  /**
   * THE ENDING. A film that laps back to its own first frame has no
   * ending, and the coda earns one — so when the last cue has run, the
   * run simply stops: the final pose holds, the music settles down a
   * step, and a card offers the way back in. Replay is a choice the
   * viewer makes, never something the clock does to them.
   */
  @tracked private ended = false;
  /**
   * THE YEAR IS THE SUBJECT. A film whose whole argument is that one
   * building took a hundred and forty-four years cannot leave the audience
   * to infer the date from the state of the scaffolding: the year is on
   * screen, and it is on a line from the first stone to the present, so
   * 1954 is not a number but a POSITION — two thirds along a rule that
   * still has a third to run.
   */
  @tracked private yearNow = 1882;
  private yearSent = 0;
  /** whether the announced year is currently seated in the scene */
  private stampOn = false;
  /** the page has been told the picture is static — see the frame loop */
  private idled = false;
  private gradeSent = '';
  private rakeSent = NaN;
  private rakeDeg = 35;
  /** which beat's lightning cue has fired (reset on every beat change) */
  private struck = '';
  /** which of the beat's hours (Beat.hours) is in force; -1 between beats */
  private hourStep = -1;
  /** the next grade goes to the glass without its ease (a still-join) */
  private gradeSnap = false;
  /** the last stock sent to the glass, by name; undefined before the first */
  private lutSent: null | string | undefined = undefined;
  /** the last hour a beat named, so the night can be known without naming it again */
  private hourNow = 0;

  /** the scrub track's width in px, kept by a ResizeObserver */
  private trackW = 0;
  private trackRO?: ResizeObserver;
  /** the chapter fractions the bar is drawn with, computed once */
  private segFr?: { s0: number; sl: number }[];

  private trackWrap = modifier((el: HTMLElement) => {
    this.trackW = el.clientWidth;
    this.trackRO = new ResizeObserver(() => {
      this.trackW = el.clientWidth;
    });
    this.trackRO.observe(el);
    return () => {
      this.trackRO?.disconnect();
      this.trackRO = undefined;
    };
  });

  /**
   * THE KNOB IS THE FILL'S END. The bar is chapters with a gap between
   * them, so the playhead's position is not linear in the playhead's
   * value — a second formula for the knob drifts from the fill inside
   * every segment. This is the one formula: the same fractions the fill
   * uses, over the measured track, with the gaps added back.
   */
  private headPx(prog: number): number {
    const segs = (this.segFr ??= this.playbar.map((c) => {
      const m = /--s0:([\d.]+);--sl:([\d.]+)/.exec(c.style)!;
      return { s0: +m[1]!, sl: +m[2]! };
    }));
    const gap = 2;
    const usable = this.trackW - gap * (segs.length - 1);
    let i = segs.findIndex(
      (s, n) => prog < s.s0 + s.sl || n === segs.length - 1,
    );
    if (i < 0) {
      i = segs.length - 1;
    }
    const s = segs[i]!;
    const f = Math.max(0, Math.min(1, (prog - s.s0) / s.sl));
    return (s.s0 + f * s.sl) * usable + i * gap;
  }
  /** which tower the lineup's metronome is on; -1 between lineups */
  @tracked private cycleStep = -1;

  private film?: Picture;
  private frameEl?: HTMLElement;
  private lineEl?: SVGLineElement;
  private dotEl?: SVGCircleElement;
  private tetherEl?: SVGLineElement;
  private dim?: HTMLElement;
  /** the dim's own value, chased rather than cut so it never snaps on */
  private dimNow = 0;
  private plateEl?: HTMLElement;
  private rowEls: HTMLElement[] = [];
  private raf = 0;
  private lastTick = 0;
  /** when the current beat was entered, for the clocks it owns */
  private beatAt = 0;

  /** where the beat's sky word was planted, in world azimuth */
  private skyAz = 0;

  /** the azimuth the mark word is planted on, behind the building */
  private markAz = 0;
  /** a sideways nudge in world units, for a word too short to centre */
  private markOff = 0;
  /** the height the word rises FROM — set when it actually arrives */
  private markFrom = 2.6;
  private markSeated = false;

  /** the last pose actually pushed — the final smoothing stage */
  private sent?: {
    az: number;
    el: number;
    fx: number;
    fz: number;
    lookY: number;
    ox: number;
    zoom: number;
  };

  /** the light in force, and the light the beat asked for */
  private sunNow: { az: number; el: number } | null = null;
  private sunGoal: { az: number; el: number } | null = null;

  /* ---- the player ------------------------------------------------- *
   * A film owes its viewer the controls every other film has: a
   * playhead you can put your hand on, chapters you can see coming, a
   * clock, and a way to make it the whole screen. It also owes them the
   * PICTURE — so the whole apparatus stands down when nobody is
   * touching it and comes back on the first movement.
   * ------------------------------------------------------------------ */
  @tracked private idle = false;
  /** the fraction the hand is holding while scrubbing, else null */
  @tracked private scrubAt: number | null = null;
  /** the fraction under a resting pointer on the bar, else null */
  @tracked private hoverAt: number | null = null;
  /** the master fader, 0..1, remembered across visits */
  @tracked private vol = Film.savedVol();
  /** the centre-screen glyph that confirms a play or a pause */
  @tracked private burst: '' | 'play' | 'pause' = '';
  /** the viewer's pause: the run, the page and the beat clock all hold */
  @tracked private paused = false;
  private pausedAt = 0;
  /** the lap whose head beat the cut itself already applied */
  private primedLap = -1;
  /** the bar's own element, for the slider's live value */
  private scrubEl?: HTMLElement;
  private shownPct = -1;
  @tracked private clock = '0:00';
  @tracked private full = false;
  private idleTimer = 0;
  private shownSec = -1;

  /** the whole film, in seconds, leads included */
  private get totalSecs(): number {
    return (
      this.all.reduce(
        (n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)),
        0,
      ) * TICK
    );
  }

  private secsBefore(index: number): number {
    return (
      this.all
        .slice(0, index)
        .reduce((n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)), 0) *
      TICK
    );
  }

  /** one segment per chapter, sized and placed in whole-film fractions */
  get playbar() {
    const total = this.totalSecs;
    return this.chapterHeads.map((head, i) => {
      const end = this.chapterHeads[i + 1] ?? this.all.length;
      const ch = this.chapters[this.all[head]!.ch] ?? this.chapters[0]!;
      const s0 = this.secsBefore(head) / total;
      const sl = (this.secsBefore(end) - this.secsBefore(head)) / total;
      return {
        head,
        n: ch.n,
        style: `flex:${sl};--s0:${s0.toFixed(5)};--sl:${sl.toFixed(5)}`,
        title: ch.title,
      };
    });
  }

  private static mmss(s: number): string {
    const m = Math.floor(Math.max(0, s) / 60);
    return `${m}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  }

  get duration(): string {
    return Film.mmss(this.totalSecs);
  }

  /**
   * What the hand is pointing at — resting on the bar or dragging it:
   * the chapter under it and the time, on two lines, the way every
   * player's hover bubble does. A drag wins over a hover.
   */
  get tip(): { ch: string; t: string } | null {
    const at = this.scrubAt ?? this.hoverAt;
    if (at === null) {
      return null;
    }
    const want = at * this.totalSecs;
    let i = 0;
    while (i + 1 < this.all.length && this.secsBefore(i + 1) <= want) {
      i += 1;
    }
    const ch = this.chapters[this.all[i]!.ch] ?? this.chapters[0]!;
    return { ch: `${ch.n} ${ch.title}`, t: Film.mmss(want) };
  }

  /** rolling AND not held by the viewer: what the play button shows */
  get live(): boolean {
    return this.playing && !this.paused;
  }

  /** the fader's setting, as it was left last time — one setting for
   *  every film, the way a viewer's volume is theirs and not the film's */
  private static savedVol(): number {
    try {
      const v = Number(window.localStorage.getItem('cf-vol'));
      return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  }

  /** sound on, and the fader up: the speaker glyph's three states */
  get loud(): 'high' | 'low' | 'off' {
    if (!this.sound || this.vol <= 0) {
      return 'off';
    }
    return this.vol < 0.5 ? 'low' : 'high';
  }

  get volStyle(): string {
    return `--cf-vol:${this.vol.toFixed(2)}`;
  }

  /**
   * THE FADER. Dragging it up while muted unmutes, because that is what
   * the hand means; the value is the page's master gain, under the mix
   * and the mute, and it is remembered for the next visit.
   */
  private fade = (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    this.vol = v;
    this.film?.volume?.(v);
    try {
      window.localStorage.setItem('cf-vol', v.toFixed(2));
    } catch {
      /* private mode: the fader just does not remember */
    }
    if (v > 0 && !this.sound) {
      this.hear();
    }
  };

  /** the glyph that flashes in the middle of the picture on play/pause */
  private pop(kind: 'pause' | 'play') {
    if (this.gate || this.ended) {
      return;
    }
    this.burst = '';
    requestAnimationFrame(() => {
      this.burst = kind;
    });
  }

  private burstDone = () => {
    this.burst = '';
  };

  /**
   * A tap on the picture is play/pause and two taps are full screen —
   * the grammar of every player since the first one. The controls, the
   * door, the end card, the rail and the menu keep their own clicks.
   */
  private static onGlass(e: Event): boolean {
    const t = e.target as Element | null;
    return !t?.closest(
      'button, a, input, .cf-player, .cf-menu, .cf-gate, .cf-rail',
    );
  }

  private tap = (e: Event) => {
    if (this.gate || this.ended || this.menu || !Film.onGlass(e)) {
      return;
    }
    this.toggle();
  };

  private tapTwice = (e: Event) => {
    if (this.gate || this.ended || this.menu || !Film.onGlass(e)) {
      return;
    }
    this.screen();
  };

  /** the bar's own element, for the slider's live value */
  private slider = modifier((el: HTMLElement) => {
    this.scrubEl = el;
    return () => {
      this.scrubEl = undefined;
    };
  });

  private wake = () => {
    if (this.idle) {
      this.idle = false;
    }
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      /* never hide the controls out from under a hand that is using them */
      if (this.scrubAt === null && !this.menu && this.live) {
        this.idle = true;
      }
    }, 2600);
  };

  private scrubFrom(e: PointerEvent): number {
    const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - el.left) / el.width));
  }

  /**
   * The bubble and the ghost fill follow the pointer, not the playhead:
   * the bubble's x in pixels (held off the edges so it never clips) and
   * the hover fraction, both as properties, both without a re-render.
   */
  private point(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const at = r.width > 0 ? x / r.width : 0;
    const pad = Math.min(56, r.width / 2);
    const st = this.pageEl?.style;
    st?.setProperty(
      '--cf-tipx',
      Math.max(pad, Math.min(r.width - pad, x)).toFixed(1),
    );
    st?.setProperty('--cf-hov', at.toFixed(5));
    return at;
  }

  private scrubDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.scrubAt = this.point(e);
  };

  private scrubMove = (e: PointerEvent) => {
    const at = this.point(e);
    if (this.scrubAt !== null) {
      this.scrubAt = at;
      /* an exact film follows the hand: the picture IS the tip */
      if (this.exact) {
        this.seek(this.barSecs(this.scrubAt));
      }
    } else if (e.pointerType !== 'touch') {
      this.hoverAt = at;
    }
  };

  private scrubLeave = () => {
    this.hoverAt = null;
    this.pageEl?.style.setProperty('--cf-hov', '0');
  };

  /**
   * THE PLAYHEAD SNAPS TO A SHOT, because this film cannot seek: the
   * lens is an integrator and a run dropped into its own middle arrives
   * with the wrong velocity (docs/choreo-splices.md). So the drag reads
   * as time, the label names the shot under the hand, and the release
   * RE-CUTS from that shot's head — which is the same edit the chapter
   * buttons and the arrow keys make.
   */
  /**
   * A HAND ON THE BAR NEVER LANDS ON THE CARD. The bar's right edge is
   * the film's last second, and a click there — or a drag that ran off
   * the end — seeks to the total, which is the ending itself: the card
   * came up under a hand that wanted the last shot. The bar stops two
   * seconds short; the ending is reached by playing to it.
   */
  private barSecs(at: number): number {
    return Math.min(at * this.totalSecs, Math.max(0, this.totalSecs - 2));
  }

  private scrubUp = (e: PointerEvent) => {
    const at = this.scrubAt ?? this.scrubFrom(e);
    this.scrubAt = null;
    this.hoverAt = null;
    this.pageEl?.style.setProperty('--cf-hov', '0');
    this.seek(this.barSecs(at));
  };

  private screen = () => {
    const el = this.pageEl ?? this.frameEl;
    if (!el) {
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  };

  private fullChange = () => {
    this.full = !!document.fullscreenElement;
  };

  /**
   * THE POINTER MOVES THE WORLD A LITTLE.
   *
   * A film that cannot be touched is a video, and the whole argument
   * here is that this is a scene. So the cursor gets a few degrees of
   * lean: the lens takes a fraction of it (real parallax — the building
   * and the hills separate) and the type planes take more of it in the
   * other direction, each layer by its own depth. It is small enough to
   * be felt rather than played with, and damped, so it never fights the
   * shot the score is composing.
   */
  private lean = { x: 0, y: 0 };
  private leanTo = { x: 0, y: 0 };

  private aim = (e: PointerEvent) => {
    const el = this.pageEl ?? this.frameEl;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    this.leanTo.x = Math.max(
      -1,
      Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1),
    );
    this.leanTo.y = Math.max(
      -1,
      Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1),
    );
  };

  /** the haze the beat asked for — the weather drift breathes around it */
  private hazeBase: number | null = null;

  /* the score's goal, and the two stages that chase it */
  private goal: Cam = { ...this.all[0]!.cam };
  private mid: Cam = { ...this.all[0]!.cam };
  private midV = { dolly: 0, fx: 0, fz: 0, lookY: 0, ox: 0, pitch: 0, yaw: 0 };
  private now: Cam = { ...this.all[0]!.cam };
  private nowV = { dolly: 0, fx: 0, fz: 0, lookY: 0, ox: 0, pitch: 0, yaw: 0 };

  /** the world-layer plane's own fade, so a chapter's type breathes in */
  private skyOn = 0;
  /** the time of day the furniture is currently dressed for */
  private wearing = '';
  /** the cast-shadow offset the type is currently wearing, px */
  private shadow = { x: 0, y: 0 };
  private pageEl?: HTMLElement;

  /**
   * WHERE THE CUT STARTS — the arrow keys' one piece of state.
   *
   * A film this long is unwatchable without chapter skip, and seeking a run
   * that carries an integrator is not honest (the chaser's pose depends on
   * its history, which is the price Drift's doctrine names out loud). So
   * skipping RE-CUTS instead of seeking: the beat list is sliced here, the
   * path and the cues are both derived from that list, and the score the
   * region sees is a different, shorter film. An edited timeline replays
   * from its own head, which is exactly the behaviour wanted — and it is
   * the same move Sylva's lap makes to loop.
   *
   * `?from=N` seeds it, so a shot can be linked to.
   */
  @tracked private from = (() => {
    const q = new URLSearchParams(window.location.search).get('from');
    const n = q ? Number(q) : 0;
    return Number.isFinite(n) && n > 0 ? Math.min(n, this.all.length - 1) : 0;
  })();

  /** sound is off until asked for: nobody's first second should be音 */
  @tracked private sound = false;

  /**
   * THE GATE. This film is narrated, and narration behind a mute button
   * is a film shown with the projector lamp off — so the front door asks.
   * One held frame, one choice, and the choice IS the user gesture that
   * autoplay policy wants anyway: the browser unlocks audio on the same
   * click that starts the picture. Museums have worked this way forever.
   *
   * `?from` skips it (an authoring link wants the shot, not the lobby)
   * and so does embedding.
   */
  @tracked private gate = false;
  /** the scene is loaded and seated behind the gate — the door can open */
  @tracked private ready = false;

  /**
   * One pass BEHIND `booted`, on purpose. A region's first render
   * collects no score, so anything standing in it on that pass — the
   * first beat's type, a head photo — was never inserted and never
   * animates. Content mounts on this flag instead, which flips a tick
   * later: the same render that gives the score its first real pass
   * hands the front layer a genuine insertion, and the opening beat's
   * type is DELIVERED like every other beat's instead of being found
   * already on the glass.
   */
  @tracked private rolling = false;

  get beats(): Beat[] {
    return this.from > 0 && !this.exact ? this.all.slice(this.from) : this.all;
  }

  /** the first beat of each chapter, in whole-film indices */
  get chapterHeads(): number[] {
    const heads: number[] = [];
    this.all.forEach((b, i) => {
      if (
        heads.length === 0 ||
        this.all[heads[heads.length - 1]!]!.ch !== b.ch
      ) {
        heads.push(i);
      }
    });
    return heads;
  }

  /** where we are in the WHOLE film, not the current cut */
  get absoluteIndex(): number {
    return this.from + this.beatIndex;
  }

  get beat(): Beat {
    return this.beats[this.beatIndex] ?? this.beats[0]!;
  }

  /**
   * CAPTIONS. `?subs` seeds them on; CC toggles them.
   *
   * They are the narration, printed. That makes them two things at once
   * and both are wanted: an accessibility track for anyone who cannot or
   * would rather not hear the voice, and — before any voice exists — the
   * only reliable way to find out that a line is two seconds too long for
   * the shot it is sitting on.
   */
  @tracked private subsOn = new URLSearchParams(window.location.search).has(
    'subs',
  );

  get subs(): boolean {
    return this.subsOn;
  }

  private cc = () => {
    this.subsOn = !this.subsOn;
  };

  get grade(): string {
    return this.beat.grade ?? this.chapter.grade ?? 'amber';
  }

  get chapter() {
    return this.chapters[this.beat.ch] ?? this.chapters[0]!;
  }

  get embed(): boolean {
    /* the demo page mounts the theater route in an iframe with ?embed —
       Sylva's pattern: the gate, the transport and the dive stand down
       and the film begins muted */
    return (
      (this.args.embed ?? false) || /[?&]embed\b/.test(window.location.search)
    );
  }

  /** `?debug` puts the build stamp in the corner — see `@build` */
  get debug(): boolean {
    return /[?&]debug\b/.test(window.location.search);
  }

  get build(): string {
    return this.args.build ?? '';
  }

  get src(): string {
    return `${this.args.src}?host${AWAKE ? '&awake' : ''}`;
  }

  get photoSrc(): string {
    return `${this.args.assets}${this.beat.photo?.src ?? ''}`;
  }

  /** a photograph that failed to load is no photograph — drop the plate */
  private lost = new Set<string>();
  @tracked private lostStamp = 0;

  get hasPhoto(): boolean {
    const p = this.beat.photo;
    return !!p && this.lostStamp >= 0 && !this.lost.has(p.src);
  }

  private missing = () => {
    const p = this.beat.photo;
    if (p) {
      this.lost.add(p.src);
      this.lostStamp += 1;
    }
  };

  /** a fresh name per lap: an edited score replays, a restarted one fights */
  get filmName(): string {
    return `film-${this.lap}`;
  }

  /**
   * The pose the score OPENS on, declared to the region — without it the
   * first spline segment travels in from the library's default rig, a
   * two-second bounce every cold boot wore before its first real frame.
   */
  get openPose() {
    const c = this.beats[0]!.cam;
    return {
      dolly: c.dolly,
      look: { x: c.fx ?? 0, y: c.lookY, z: c.fz ?? 0 },
      pitch: c.pitch,
      x: c.ox ?? 0,
      y: 0,
      yaw: c.yaw,
    };
  }

  get filmSeconds(): number {
    return (
      this.beats.reduce(
        (n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)),
        0,
      ) * TICK
    );
  }

  /**
   * THE WHOLE FILM IS ONE CAMERA STEP.
   *
   * Every beat contributes `ticks` waypoints: a moving beat is sampled from
   * its head pose to its tail, a holding beat repeats its pose, and the
   * spline runs through the lot on one clock. So the shot list is a path
   * rather than a playlist, the camera crosses each mark with velocity
   * instead of arriving at it, and a hold is genuinely still without
   * anything having stopped.
   */
  /**
   * WHERE A SHOT ENDS — the beat's authored tail, floored so it always
   * reads as a move, and clamped so it never travels past the pose the
   * next shot begins on. Shared by the path (which lerps its waypoints
   * across it) and by the LAUNCH: a cut hands the chaser this shot's own
   * speed, so the lens is already travelling when the cut lands rather
   * than easing up from a standstill.
   */
  private tailFor(bi: number): Cam {
    const beats = this.beats;
    const b = beats[bi]!;
    const drift = b.toCam ?? {
      ...b.cam,
      dolly: b.cam.dolly * 1.05,
      pitch: b.cam.pitch + 1.4,
      yaw: b.cam.yaw + 6,
    };
    /**
     * A SHOT MUST MOVE ON SCREEN, not on paper.
     *
     * Frame-differencing a screen capture of the cut said it plainly:
     * outside the seams, whole minutes of this film change by about
     * 5/255 per SECOND — 0.08 per frame, which is nothing at all. The
     * authored tails looked like moves in the score (four to eight
     * degrees of orbit, three per cent of push) and read as STILLS in
     * the picture, because an orbit barely displaces the subject it is
     * aimed at and two chase stages low-pass whatever is left.
     *
     * So a tail is a DIRECTION and a floor, not a distance: what the
     * beat asks for is honoured, and anything slower than a real slow
     * move is stretched up to one. The floors are per second, so a
     * long hold travels further than a short one and every shot drifts
     * at the same speed. The push does most of the work — a scale
     * change moves every pixel and the aim keeps the subject centred —
     * and the orbit gives the background its parallax.
     *
     * A shot that ENDS AT A SEAM may be stretched freely: nothing
     * crosses a cut, so the far side is a different shot and cannot be
     * bounced into. Inside a continuous run the next beat's head is
     * this same lens still travelling, so the stretch stops there —
     * landing exactly on the next head is the smoothest tail there is
     * (the spline crosses it without a corner), and passing it is what
     * makes the camera arrive, back up and go again.
     *
     * Pitch carries a floor too, because orbit alone can fail to READ:
     * the worm's-eye on the stone base moves two degrees a second and
     * changes almost nothing on screen, since a flat wall aimed at
     * from a fixed height looks the same from either side of it. A
     * little tilt moves the whole frame.
     */
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
      /* the direction is the beat's own, or the next shot's if the
         beat asked for nothing at all */
      const way = d !== 0 ? sgn(d) : nose !== 0 ? sgn(nose) : 1;
      /**
       * NEVER TRAVEL PAST WHERE THE NEXT SHOT BEGINS. Inside a run
       * that would make the camera arrive, back up and go again. At a
       * CUT it is worse, and it is what chapter four was doing: the
       * details sit eight or ten degrees apart, the floor asked for
       * twenty-two, so every shot orbited past its successor's pose
       * and the cut jumped BACKWARDS into it — a film that appears to
       * be running one section behind its own captions.
       */
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
    /**
     * AND A PAN. Orbit, push and tilt all move the camera AROUND the
     * subject; a lateral drift moves the subject across the frame,
     * which is the one Ken Burns move the others cannot fake — it
     * changes the composition rather than the view. A few hundredths of
     * the frustum over a shot is enough to feel: the building leaves
     * the middle, or arrives in it, while everything else is happening.
     */
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

  get path() {
    const pts: {
      cut?: boolean;
      dolly: number;
      look: { x: number; y: number; z: number };
      pitch: number;
      x: number;
      y: number;
      yaw: number;
    }[] = [];
    const beats = this.beats;
    for (const [bi, b] of beats.entries()) {
      /**
       * A CUT BEAT'S HEAD IS A SPLICE. The library samples each side as
       * its own clamped shot and steps across the seam at this waypoint's
       * own instant (docs/choreo-splices.md) — no enforced holds, no
       * ticks spent parked, no glide across the jump. A re-cut score
       * (chapter skip) splices its very first waypoint too, so a skip
       * opens inside its shot instead of travelling in from wherever the
       * last run left the lens.
       */
      const splice = b.cut === true || (bi === 0 && this.from > 0);
      const to = this.tailFor(bi);
      /**
       * A HOLD BREATHES. Before the splices, every "held" shot secretly
       * lived on the one spline's residual sway; clamped shots took that
       * away and the holds went DEAD — three static slides in the first
       * minute. A shot with no authored tail now drifts on its own: a
       * few degrees of orbit and a whisper of push over its whole
       * length, too slow to read as a move and just enough that the
       * frame is alive. An authored toCam always wins.
       */
      /* THE ARRIVAL. A lead spends its ticks travelling from wherever
         the last shot finished to this beat's own head, so a chapter
         change is a move rather than a jump. It cannot apply to the
         first beat of a cut: there is nothing behind it to leave. */
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
        /**
         * ONE CURVE, NOT FIVE INTERPOLATIONS.
         *
         * A shot is a single move from one pose to another, and it is
         * described here by exactly two poses: the beat's head and the
         * tail computed above. The points between them are samples of
         * that one line — collinear by construction, evenly spaced, one
         * per tick because the cue clock counts ticks — so the spline
         * has nothing to invent between them and no join to round off.
         *
         * They were briefly spaced on a smoothstep, to put the speed in
         * the middle of the shot. That is the right INSTINCT and the
         * wrong place for it: uneven spacing makes a Catmull-Rom
         * overshoot at every sample, so a move that should read as one
         * gesture reads as five corrections. The easing belongs to the
         * chaser, which is a physical system and cannot overshoot into
         * a corner, and to the shot's own head and tail.
         */
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
   * Each beat's entrance, as a delay into the one camera step — offset
   * one tick, because the pose-in-force seed occupies the spline's first
   * slot: waypoint k is crossed at (k+1) slots, not k. The old uniform
   * skew was invisible (camera and cues equally late, a constant the
   * chaser's own lag swallowed); a SPLICE made it audible — the snap
   * fired two seconds before the goal stepped, and the chaser spent the
   * gap dragged back toward the old shot. Cue 0 stays at zero: the boot
   * and every re-cut apply their head beat by hand, and its immediate
   * re-fire has always been the first cue's job.
   */
  get cues() {
    let t = 0;
    const out: { action: string; delay: number; index: string }[] = [];
    this.beats.forEach((b, i) => {
      const lead = i === 0 ? 0 : (b.lead ?? 0);
      /**
       * The sky turns while the lens is still travelling: the air cue
       * fires as the sweep BEGINS and the beat's own cue when it lands.
       *
       * (It was briefly moved two ticks earlier, so the hour changed
       * under the end of the previous passage. It reads badly — the
       * light goes while you are still looking at a shot composed for
       * the old light, which is not anticipation, just a mismatch. The
       * change belongs to the move.)
       */
      if (lead > 0) {
        out.push({
          action: 'air',
          delay: t + TICK,
          index: String(i),
        });
      }
      const at = t + lead * TICK;
      t = at + b.ticks * TICK;
      /* a Perform target is a NAME, and a beat's name is its place in the
         script — the index, as a string, so the cue and the array agree */
      out.push({
        action: 'beat',
        delay: at === 0 ? 0 : at + TICK,
        index: String(i),
      });
    });
    return out;
  }

  /**
   * THE TRANSPORT — a broadcast bar, not a thermometer. One segment per
   * chapter, sized by the chapter's actual running time, filled by
   * WHOLE-film progress (the old bar measured the current cut, so a
   * skip made it lie), and clickable: the segments are the same re-cut
   * the menu and the arrows perform.
   */
  /**
   * ONE TIMELINE, NOT TWO.
   *
   * The corner carried a strip of chapter segments beside a rule of years:
   * two timelines of the same film, at two different scales, in two
   * different shapes, six inches apart. So the chapters are ON the years
   * now — each one a dot at the year it opens, so the gap between THE SITE
   * and SILENCE is fifty-four years wide and the gap between the last two
   * is a decade, which is the fact the film is about. The dots are still
   * the doors into the chapters.
   */
  get transport(): RailMark[] {
    const here = this.absoluteIndex;
    const clock = this.args.clock;
    const total = this.totalSecs;
    return this.contents.map((c) => {
      const b = this.all[c.head]!;
      let at: number;
      let label: string | undefined;
      if (clock) {
        /* a chapter is a dot at the year it opens, so the gap between two
           chapters is the fact the film is about */
        const y = clock.yearAt(
          Array.isArray(b.build) ? b.build[0] : (b.build ?? 0),
        );
        const [a, z] = clock.span;
        at = Math.max(0, Math.min(1, (y - a) / (z - a)));
        label = String(Math.floor(y));
      } else {
        at = this.secsBefore(c.head) / total;
      }
      return {
        at,
        done: here >= c.head,
        head: c.head,
        here: c.here,
        label,
        n: c.n,
        title: c.title,
      };
    });
  }

  /** the ends of the rule, when it is a clock */
  get railLabels(): [string, string] | undefined {
    const span = this.args.clock?.span;
    return span ? [String(span[0]), String(span[1])] : undefined;
  }

  /** the rail is on unless the film says otherwise */
  get railOn(): boolean {
    return this.args.rail ?? true;
  }

  get railReadout(): string {
    return this.args.clock ? String(this.yearNow) : '';
  }

  /**
   * WHEN EACH CUE LANDS — paced against the voice, not the clock.
   *
   * The phrases used to arrive on four fixed delays, which meant a
   * fourteen-second beat finished its type with five seconds of dead air
   * and a short one crowded the read. So the cues spread themselves: the
   * first lands early, the last lands as the measured line is finishing
   * (`VO_SECS`), and a beat with no recording paces against two thirds of
   * its own length, which is where a read for it would sit anyway.
   */
  /**
   * THE TRANSITION FIRST, THEN THE TYPE. A setting that arrives while the
   * seam is still on screen is read against two pictures at once. The
   * block waits for the incoming join to finish and a breath more, then
   * enters in its order: kicker, glyph, reading — and the lines after.
   */
  get typeAt(): number[] {
    /* the type waits for the SEAM to finish, and an unnamed join is the
       default one — reading '' here meant every default cut typed straight
       through its own transition */
    const wait = (JOIN_SECS[this.beat.join ?? this.defaultJoin] ?? 0) + 0.45;
    return [wait, wait + 0.12, wait + 0.36];
  }

  get sayAt(): number[] {
    const b = this.beat;
    const n = b.says?.length ?? 0;
    const dur = b.ticks * TICK;
    const vo = this.voSecs[b.id];
    const first = this.typeAt[2]! + 0.3;
    /* land the last cue on the line's last breath, never inside the
       beat's own exit */
    const last = Math.max(
      first + 0.8,
      Math.min(vo ? vo - 0.4 : dur * 0.66, dur - 1.4),
    );
    return [0, 1, 2, 3].map((i) =>
      n <= 1 ? first : first + (Math.min(i, n - 1) * (last - first)) / (n - 1),
    );
  }

  /**
   * Thai and Khmer are not kanji: their ascenders, vowel marks and
   * subscripts stand far outside a CJK-tuned glyph box, so at the kanji
   * size they collide with the kicker above and the reading below. Tall
   * scripts take a reduced setting with real leading.
   */
  /**
   * HOW MANY CHARACTERS HAVE TO FIT. A vertical setting is as tall as
   * its string, and 一国一城令 is five glyphs — at the plate's own size
   * that column runs off the top of the frame and the film crops its
   * own title. The count goes to CSS, which sizes the column to the
   * height available rather than to a number somebody typed once while
   * looking at a three-glyph word.
   */
  get glyphFit(): string {
    return `--cf-glyphs:${Math.max(2, [...(this.beat.kanji ?? '')].length)}`;
  }

  get glyphTone(): string {
    const k = this.beat.kanji ?? '';
    if (/[A-Za-zÀ-ÿ]/.test(k)) {
      return 'is-latin';
    }
    return /[฀-๿ក-៿]/.test(k) ? 'is-tall' : '';
  }

  /** the lineup's current kanji; empty between lineups */
  get stamp(): string {
    const c = this.beat.cycle;
    return c && this.cycleStep >= 0 ? (c[this.cycleStep]?.kanji ?? '') : '';
  }

  /**
   * THE POSTER IS AN EVENING (by default). The film proper opens in the
   * morning, so the door stands in the last of the light with a long hard
   * shadow across the empty half of the frame; pressing it turns the day
   * over. The film may dress its door otherwise (`@poster`).
   */
  private dressPoster(film: Picture) {
    const p = this.args.poster ?? {};
    film.theme(p.theme ?? 2, true);
    const l = p.light ?? { az: -105, el: 21 };
    film.light({ az: l.az * RAD, el: l.el * RAD });
  }

  private mount = modifier((el: HTMLElement) => {
    /* which cut is actually in the browser, said out loud once */
    console.info(`film ${this.args.name}: ${this.args.build ?? ''}`);
    this.frameEl = el;
    this.pageEl = el.closest('.cf-page') as HTMLElement;
    window.addEventListener('keydown', this.key);
    window.addEventListener('pointermove', this.aim);
    window.addEventListener('pointermove', this.wake);
    window.addEventListener('wheel', this.wake, { passive: true });
    document.addEventListener('fullscreenchange', this.fullChange);
    /* NOT this.wake() — a modifier runs INSIDE the render pass, and
       `idle` is read by the template in that same computation; writing
       it here is a backtracking rerender, which Ember asserts on and
       which takes the whole pass (and the film) down with it. The timer
       is armed from a timeout instead, which is outside it. */
    window.setTimeout(() => {
      if (this.booted) {
        this.wake();
      }
    }, 0);
    window.addEventListener('error', this.trip);
    window.addEventListener('unhandledrejection', this.trip);
    const frame = el.querySelector('iframe');
    if (!frame) {
      return;
    }
    /* a film owns the whole frame: the app's bar and footer step out
       entirely rather than fading, because unlike Sylva's theater there
       is no lockup here that wants to stay superimposed */
    document.body.classList.add(this.embed ? 'cf-embedded' : 'cf-film');
    /* only ever gate a film that has not begun: a dev-mode template swap
       re-runs this modifier on the SAME instance, and resurrecting the
       door over a running film left its buttons answering to a guard
       that told them the film had already started — because it had */
    this.gate = !this.embed && this.from === 0 && !this.booted;
    const onLoad = () => {
      const w = (frame as HTMLIFrameElement).contentWindow as unknown as {
        __film?: Picture;
      } | null;
      if (!w?.__film) {
        return;
      }
      this.film = w.__film;
      this.film.volume?.(this.vol);
      /* a RUNNING film needs nothing from the door. This path re-fires
         whenever the modifier re-installs (it reads tracked state), and
         re-seating here yanked the lens back to the cut's head. */
      if (this.booted) {
        return;
      }
      try {
        /* the page opens on an empty site — its own clock is at zero —
           and most of this film is about a finished building. Standing it
           up before the first beat runs means a beat only ever has to say
           what it CHANGES, which is also what makes `?from` land on a
           real shot rather than on a field. */
        w.__film.time(this.args.standing);
        /* whatever the picture needs told once — the plan off, the city
           on — is the film's own */
        this.args.seat?.(w.__film);
        /* THE POSTER IS AN EVENING. The film proper opens in the morning
           — so the door stands in the last of the light, and pressing it
           turns the day over: the sky crossfades to nine o'clock while
           the lens flies out of the poster's circuit. Two things the
           viewer did not ask for, both answering the same click. */
        this.dressPoster(w.__film);
        /* seat the lens where the film opens, so the first frame is the
           shot and not a swing towards it */
        this.snap(this.beats[0]!.cam);
      } finally {
        /* the door unlocks NO MATTER WHAT the seating did: a gate whose
           buttons can be stranded disabled by a throw above is a locked
           theatre with the lights on */
        this.ready = true;
      }
      if (this.gate) {
        /* a click that arrived while the scene was still loading was a
           decision, not a miss — honour it now */
        if (this.wanted !== undefined) {
          this.begin(this.wanted);
          return;
        }
        this.posterAt = 0;
        this.posterRaf ??= requestAnimationFrame(this.poster);
        return;
      }
      /* IDEMPOTENT, or nothing. This load path re-runs whenever the
         modifier does (a booted flip re-renders the stage), and an
         unconditional begin(false) here reached the already-booted
         branch and TOGGLED THE SOUND BACK OFF — the "with sound" click
         un-clicking itself one pass later. Only a film that has not
         begun may be begun on its behalf. */
      /**
       * ONLY A FILM WITH NO DOOR STARTS ITSELF. The embed has no gate by
       * design and a deep link has already chosen its shot; the theater
       * route at the top has a front door, and a door that opens itself
       * on a fast (or cached) load is a film that started without being
       * asked — which is how the poster's own circuit got two seconds
       * and then vanished.
       */
      /* ...and it starts WITH sound: the mix is part of the film, and a
         frame with no transport has no way to turn it on. Where the
         browser withholds audio until a gesture, the graph simply waits
         for one; the picture does not. */
      if (!this.booted && (this.embed || this.from > 0)) {
        this.begin(true);
      }
    };
    frame.addEventListener('load', onLoad);
    /* a cached iframe can be complete before the listener is attached —
       but never boot from inside the mount modifier itself: this runs
       during the render pass, and a `booted` flipped here renders the
       score region in the SAME pass, where the rig is not an insertion
       and the whole run resolves to nothing. A timeout puts the flip in
       its own pass, which is what the load event gives the slow path. */
    let bootTimer = 0;
    if (
      (frame as HTMLIFrameElement).contentDocument?.readyState === 'complete'
    ) {
      bootTimer = window.setTimeout(onLoad, 0);
    }
    /**
     * THE LOOP COMES BACK. This modifier reads tracked state (`from`,
     * `booted`), so it re-installs on every re-cut and on the boot
     * itself — and its own cleanup below cancels the frame loop each
     * time. The old code got away with it because the load path
     * re-booted the world wholesale; now that a running film is left
     * alone, the re-install has to hand back the one thing it took.
     */
    if (this.booted) {
      /* the cleanup nulled the bridge as well; take it straight back
         rather than waiting a tick for the load path */
      const w = (frame as HTMLIFrameElement).contentWindow as unknown as {
        __film?: Picture;
      } | null;
      if (w?.__film) {
        this.film = w.__film;
        this.film.volume?.(this.vol);
      }
      cancelAnimationFrame(this.raf);
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    return () => {
      cancelAnimationFrame(this.raf);
      window.clearTimeout(bootTimer);
      window.removeEventListener('keydown', this.key);
      window.removeEventListener('error', this.trip);
      window.removeEventListener('unhandledrejection', this.trip);
      window.removeEventListener('pointermove', this.aim);
      window.removeEventListener('pointermove', this.wake);
      window.removeEventListener('wheel', this.wake);
      document.removeEventListener('fullscreenchange', this.fullChange);
      window.clearTimeout(this.idleTimer);
      frame.removeEventListener('load', onLoad);
      document.body.classList.remove('cf-film', 'cf-embedded');
      this.film = undefined;
    };
  });

  private trackEls = modifier((el: SVGSVGElement) => {
    this.lineEl = el.querySelector('line.cf-leader') as SVGLineElement;
    this.tetherEl = el.querySelector('line.cf-tether') as SVGLineElement;
    this.dotEl = el.querySelector('circle') as SVGCircleElement;
  });

  private dimEl = modifier((el: HTMLElement) => {
    this.dim = el;
    return () => {
      if (this.dim === el) {
        this.dim = undefined;
      }
    };
  });

  /**
   * A JOIN OVERLAY LIVES EXACTLY AS LONG AS ITS ANIMATION.
   *
   * Every join paints the outgoing frame over the film and gets out of
   * the way — and "gets out of the way" was left to each overlay's own
   * last keyframe. The wipe's is a swept MASK, not an opacity, so when
   * it finished the element stayed at opacity 1 with a mask that did
   * not, in fact, hide it: a full-screen still of the previous shot sat
   * on top of the picture for the rest of the chapter. The camera went
   * on moving underneath, the captions went on changing, and the film
   * looked frozen one section behind itself — which is exactly what it
   * was. (It also explains a whole afternoon of "these shots barely
   * move": some of those frames were photographs.)
   *
   * So the overlay retires itself the moment its animation ends, and
   * the next cut builds a fresh one. No join can outlive its own play.
   */
  private retire = modifier((el: HTMLElement) => {
    const done = () => {
      el.style.display = 'none';
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
    /* a still that never animates at all (reduced motion, a dropped
       stylesheet) must not become a permanent lid either */
    const failsafe = window.setTimeout(done, 1400);
    return () => {
      window.clearTimeout(failsafe);
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
    };
  });

  private plate = modifier((el: HTMLElement) => {
    this.plateEl = el;
    /* the rows, nearest plane last — the big glyph is the near one */
    this.rowEls = [...el.children] as HTMLElement[];
    return () => {
      if (this.plateEl === el) {
        this.plateEl = undefined;
        this.rowEls = [];
      }
    };
  });

  private snap(c: Cam, launch?: Cam, secs?: number) {
    this.goal = { ...c };
    this.mid = { ...c };
    this.now = { ...c };
    /**
     * A CUT LANDS ON A MOVING CAMERA.
     *
     * Snapping used to zero the chaser's velocity, so every cut arrived
     * at a standstill and eased up into its move — the one thing a cut
     * must never do, because the ease-in is the join announcing itself.
     * An operator does not stop between shots; the next shot is already
     * running when the frame changes. So the chaser is handed the
     * incoming shot's OWN speed (its whole travel over its whole
     * length) and starts at pace.
     */
    for (const k of [
      'dolly',
      'fx',
      'fz',
      'lookY',
      'ox',
      'pitch',
      'yaw',
    ] as const) {
      const a = c[k] ?? 0;
      const b = launch ? (launch[k] ?? 0) : a;
      /**
       * AND IT IS A NUDGE, NOT A LAUNCH.
       *
       * The chaser is handed the incoming shot's own speed so the cut
       * lands on a moving camera rather than a standstill. But the spring
       * is pulling toward the shot's HEAD while that speed points at its
       * TAIL, so the whole of it has to be absorbed and given back — and
       * once the stiffness came down to 3.9 there was not enough spring
       * left to absorb it: the lens ran past its own opening frame and
       * came back, which is the bounce at every cut. Roughly half the
       * speed still reads as an operator already moving, and the return
       * is inside the first breath of the shot instead of on top of it.
       */
      /* BOTH stages of the cascade get the shot's own speed. Handing it
         only to the first one left the second accelerating from rest,
         which reads as a short ease-in at every cut — and reads worst
         where the new shot orbits the OTHER WAY, because the lens
         appears to hesitate before changing its mind. */
      this.midV[k] = secs ? ((b - a) / secs) * 0.45 : 0;
      this.nowV[k] = this.midV[k];
    }
    this.sent = undefined;
    this.film?.pose({
      az: c.yaw * RAD,
      el: c.pitch * RAD,
      fx: c.fx ?? 0,
      fz: c.fz ?? 0,
      lookY: c.lookY,
      ox: c.ox ?? 0,
      snap: true,
      zoom: c.dolly,
    });
  }

  /**
   * THE WHIP. A 'whip' join does not snap: the goal steps across the
   * seam (the splice does that) and the chaser races it on a briefly
   * stiff spring — a fast, smooth tween between the shots that is over
   * in a third of a second and never reads as a glide. While it runs,
   * the spring is ~3× its documentary stiffness; then the hand relaxes.
   */
  private whipUntil = 0;

  /**
   * One critically-damped stage. The page's own chase is the second, which
   * is the whole cascade argument getting made for free by the fact that the
   * scene lives in another document.
   */
  private chase(dt: number) {
    /* softer than it was: the lens is an operator's hand, not a servo.
       Lower stiffness filters the spline's residual sway before the
       page's own chase filters it again — except mid-whip, when the
       hand is deliberately fast (see whipUntil). */
    /* SLOWER. At 5.2 the chaser was arriving at its pose about a third of
       the way into the beat and then holding, which reads as a film that
       hurries to its composition and waits — the opposite of a building
       that took a century. At 3.9 the move is still arriving as the last
       cue lands, so every shot is travelling for as long as it is on. */
    const w = this.whipUntil > performance.now() ? 11 : 3.9;
    for (const k of [
      'dolly',
      'fx',
      'fz',
      'lookY',
      'ox',
      'pitch',
      'yaw',
    ] as const) {
      const g = this.goal[k] ?? 0;
      const m = this.mid[k] ?? 0;
      const v = this.midV[k] + (w * w * (g - m) - 2 * w * this.midV[k]) * dt;
      this.midV[k] = v;
      const next = m + v * dt;
      this.mid[k] = next;
      this.now[k] = next;
    }
  }

  /**
   * THE POSTER TURNS.
   *
   * A still frame behind a title is indistinguishable from a JPEG, and
   * this whole film's argument is that it is not one. So while the door
   * is up the lens makes a slow circuit of the opening pose — a few
   * degrees either side, breathing in and out — which says "live 3D"
   * before a word is read and costs one rAF. It hands over on the
   * click: the film does not snap away from the poster, it flies from
   * wherever the circuit had reached.
   */
  private poster = (stamp: number) => {
    if (!this.gate || this.booted) {
      this.posterRaf = undefined;
      return;
    }
    this.posterRaf = requestAnimationFrame(this.poster);
    const film = this.film;
    if (!film) {
      return;
    }
    if (!this.posterAt) {
      this.posterAt = stamp;
    }
    const t = (stamp - this.posterAt) / 1000;
    const c = this.beats[0]!.cam;
    /* THREE-QUARTERS ON, and swinging. Dead in front of a building is
       an elevation drawing; the corner is where a tower shows you that
       it has depth — two faces, two eave lines, and a shadow that
       reads. The swing is slow and even, side to side, so the frame is
       never still and never travelling anywhere either. */
    /* THE POSTER IS CLOSE. The film's opening frame is as wide as the
       lens goes, which is right for a first shot and wrong for a
       poster: the door should show the building at a size worth
       pressing play for, and the press then RECOILS — a fast pull back
       out to the wide opening frame, from which the film's own slow
       push begins. */
    const pose = {
      dolly: c.dolly * (2.25 + 0.09 * Math.sin(t * 0.11 + 1.1)),
      lookY: c.lookY + 1.4 + 0.6 * Math.sin(t * 0.15),
      /* the two halves of the poster lean back toward the middle: the
         building comes in off the left edge, the wordmark off the right,
         and the gap between them is the composition */
      ox: (c.ox ?? 0) * 0.66,
      pitch: c.pitch + 2.4 + 1.4 * Math.sin(t * 0.13),
      yaw: c.yaw + 34 + 11 * Math.sin(t * 0.2),
    };
    film.pose({
      az: pose.yaw * RAD,
      el: pose.pitch * RAD,
      fx: c.fx ?? 0,
      fz: c.fz ?? 0,
      lookY: pose.lookY,
      ox: pose.ox,
      zoom: pose.dolly,
    });
    this.posterPose = pose;
  };

  private posterRaf?: number;
  private posterAt = 0;
  /** where the poster's circuit had reached when the door was answered */
  private posterPose?: Cam;

  /**
   * ONE SETTING AT A TIME, AND THIS TIME IT IS GUARANTEED.
   *
   * The hand-off is a leaver and an arriver sharing the corner for half
   * a second, which is the design. But a leaver whose exit never
   * completes just stays — and a block from the first beat was still
   * standing at full strength eight beats later, with two settings of
   * different chapters overprinting each other. Whatever strands it (a
   * removal that waits on a cue the outgoing beat never had), the rule
   * the film states out loud in its own comment is worth enforcing
   * rather than trusting: any block that is not the current one and has
   * outstayed the longest hand-off is taken off the glass.
   */
  private sweepBlocks(now: number) {
    /* the type layer is a sibling of the frame, not a child of it — the
       first version of this looked for it inside the wrong element and
       swept nothing, which is how three chapters' settings came to be on
       screen at once */
    const root = this.pageEl ?? this.frameEl ?? document.body;
    const blocks = root.querySelectorAll<HTMLElement>('.cf-type .cf-block');
    if (blocks.length < 2) {
      return;
    }
    for (let i = 0; i < blocks.length - 1; i++) {
      const el = blocks[i]!;
      const seen = Number(el.dataset['cfSeen'] ?? 0);
      /* two is a hand-off and gets its half second; three is a leak, and
         everything but the newest goes now */
      if (blocks.length > 2 || (seen && now - seen > 900)) {
        el.remove();
      } else if (!seen) {
        el.dataset['cfSeen'] = String(now);
      }
    }
  }

  private frame = (stamp: number) => {
    this.raf = requestAnimationFrame(this.frame);
    this.tick(stamp);
  };

  private tick(stamp: number) {
    this.sweepBlocks(stamp);
    const film = this.film;
    if (!film) {
      return;
    }
    /* A HIDDEN TAB DOES NO WORK. And once the end card is up nothing under
       it will change again: the page is told so and stops drawing the
       finished building into a frame nobody composites. */
    if (document.hidden && !AWAKE) {
      return;
    }
    if (this.ended) {
      if (!this.idled) {
        film.idle(true);
        this.idled = true;
      }
      return;
    }
    if (this.idled) {
      film.idle(false);
      this.idled = false;
    }
    /* held by the viewer: nothing advances, nothing is written. An exact
       film keeps deriving — its clock is the only thing that stops — so
       a scrub under a hold still draws the frame under the hand. */
    if (this.paused && !this.exact) {
      this.lastTick = stamp;
      return;
    }
    const dt = Math.min(
      0.08,
      this.lastTick ? (stamp - this.lastTick) / 1000 : 0,
    );
    this.lastTick = stamp;

    /* THE CLOCK. An exact film advances one number and derives the rest;
       a cut film reads the wall and the beat it was last handed. */
    const jumpedNow = this.jumped;
    if (this.exact) {
      if (this.playing && this.rolling && !this.paused) {
        this.t = Math.min(this.totalSecs, this.t + dt);
      }
      this.fold();
      if (this.ended) {
        return;
      }
    }
    const since = this.exact
      ? this.t - this.beatStart(this.absoluteIndex)
      : (stamp - this.beatAt) / 1000;

    if (this.exact) {
      /* no integrator in the pose path: the lens IS the spline */
      this.now = { ...this.goal };
    } else {
      this.chase(dt);
    }
    /* a chaser lands on a millionth of a pixel rather than on zero, and an
       off-centre frustum that is never quite centred keeps the projection
       matrix rebuilt every frame for nothing — so zero means zero */
    const k = Math.min(1, dt * 1.8);
    this.lean.x += (this.leanTo.x - this.lean.x) * k;
    this.lean.y += (this.leanTo.y - this.lean.y) * k;
    /**
     * EVERY SHOT IS FLOWN. The sway started as a comparison-chapter
     * idea and belongs to the whole film: a camera that holds perfectly
     * still is a render, and a degree of drift costs nothing and says
     * "somebody is holding this" in every shot.
     *
     * It is divided by the lens, though. A degree of tilt at a 4x
     * close-up throws the frame around; the same degree on a wide is a
     * breath. So the amplitude is scaled down as the shot gets tighter
     * and a beat can still ask for more of it (the drone chapter does).
     */
    const air =
      (this.beat.bob ?? 0.5) / Math.max(0.8, Math.min(3, this.now.dolly));
    const flown = Math.min(1, Math.max(0, since / (this.beat.ticks * TICK)));
    /* ONE breath across the shot, faded in and out at the ends so the
       sway never starts or stops abruptly. Three half-cycles of it (the
       first attempt) is not a drone in the air, it is a hand shaking —
       and on top of a move that is already covering ground it reads as
       the whole shot being unsteady. */
    const bob =
      air *
      Math.sin(flown * Math.PI * 1.6) *
      smooth(Math.min(1, flown / 0.18)) *
      smooth(Math.min(1, (1 - flown) / 0.18));
    /* the aim, when the shot asks to stay on the subject (Beat.hold):
       the MIDDLE of whatever is standing, in the rig's own coordinates
       — half the built height, so a crane can go anywhere and the
       building stays centred on the way */
    /* a held shot on the whole building aims at half of what stands; a
       held shot on a POINT (a finial, a cross) keeps the aim it was given */
    const rise = this.followRise(film, dt);
    const lookY = rise
      ? rise.lookY
      : this.beat.hold === 'top'
        ? /* the cut line, kept a little above centre, never under the ground */
          Math.max(1.4, film.height() * 0.62) - this.rigMid
        : this.beat.hold && !this.beat.to
          ? film.height() * 0.5 - this.rigMid
          : this.now.lookY;
    const ox = Math.abs(this.now.ox ?? 0) < 1e-4 ? 0 : this.now.ox!;
    /**
     * ONE LAST FILTER BEFORE THE GLASS.
     *
     * Everything upstream is smooth on its own — a spline, a spring,
     * the scene's own chase — but they are SUMMED here, along with the
     * bob and the pointer's lean, and a sum of smooth things is only as
     * smooth as its roughest term. A short one-pole on the pose that
     * actually ships takes the last of it out.
     *
     * It must never soften a CUT, though: a filter that carries sixty
     * milliseconds of the outgoing shot into the incoming one turns
     * every edit into a tiny dissolve. The snap clears it, so the first
     * frame of a new building is exactly the new building.
     */
    /**
     * THE HAND ON THE STICKS.
     *
     * Three sines at unrelated rates, summed and scaled by the lens:
     * about a sixth of a degree of wander on a wide shot and a fraction
     * of that on a close-up, plus a breath of it in the zoom. It is
     * deterministic (no RNG, so no frame ever jumps), continuous (no
     * discontinuity to catch the eye), and slower than a shake — this
     * is the drift of somebody holding a machine steady, not a handheld
     * effect. Turn it off by setting HAND to 0.
     */
    /* on the film's clock when the film is exact, so the breath is the
       same breath at the same frame every time */
    const clock = this.exact ? this.t : stamp / 1000;
    const wander = (a: number, b: number, c: number) =>
      Math.sin(clock * a) * 0.6 +
      Math.sin(clock * b) * 0.3 +
      Math.sin(clock * c) * 0.1;
    const HAND = 0.17;
    const hand = HAND / Math.max(0.8, Math.min(3.4, this.now.dolly));
    const want = {
      /* the lens leans into the cursor: a couple of degrees of orbit and
         a hand's width of height, which is enough for the hills to move
         against the building and nowhere near enough to fight the shot */
      /* MOSTLY TILT. A machine in the air holds its heading far better
         than it holds its nose: yaw is what the operator is steering and
         pitch is what the wind is doing to it. So the wander is nearly
         all in the tilt, with a quarter of it in the orbit to keep the
         two from looking mechanically separate. */
      az:
        (this.now.yaw +
          this.lean.x * 0.8 +
          hand * 0.25 * wander(0.37, 0.93, 2.11)) *
        RAD,
      el:
        (this.now.pitch -
          this.lean.y * 0.5 +
          bob +
          hand * 1.2 * wander(0.29, 1.07, 1.83)) *
        RAD,
      fx: this.now.fx ?? 0,
      fz: this.now.fz ?? 0,
      lookY: lookY + this.lean.y * 0.3 + (this.beat.hold ? 0 : bob * 0.3),
      ox: ox - this.lean.x * 0.012,
      zoom:
        Math.min(this.now.dolly, rise?.zoom ?? Infinity) *
        (1 + 0.0011 * wander(0.23, 0.71, 1.51)),
    };
    /* and the send is filtered a little harder, so nothing the spring
       does arrives at the page as a step */
    const g = Math.min(1, dt * 12);
    const sent = this.exact ? { ...want } : (this.sent ?? { ...want });
    if (!this.exact) {
      sent.az += (want.az - sent.az) * g;
      sent.el += (want.el - sent.el) * g;
      sent.fx += (want.fx - sent.fx) * g;
      sent.fz += (want.fz - sent.fz) * g;
      sent.lookY += (want.lookY - sent.lookY) * g;
      sent.ox += (want.ox - sent.ox) * g;
      sent.zoom += (want.zoom - sent.zoom) * g;
    }
    this.sent = sent;
    const eye = this.beat.eye;
    /* the two halves of a ground shot (Beat.lift): the feet finish before
       the head starts, with a beat of stillness between them */
    const lift = Math.max(0, Math.min(0.9, this.beat.lift ?? 0));
    const walk = eye?.to
      ? (smooth(lift > 0 ? Math.min(1, flown / lift) : flown) as number)
      : 0;
    if (lift > 0 && this.beat.toCam) {
      const from = this.beat.cam;
      const to = this.beat.toCam;
      const tilt = smooth(
        Math.max(0, Math.min(1, (flown - lift) / Math.max(0.1, 1 - lift))),
      ) as number;
      /* the aim is driven straight from the beat on a lifted shot: the
         spring is the wrong instrument for a head that has to hold still
         and then move, and these shots never dolly while they tilt */
      sent.lookY = lerp(from.lookY ?? 0, to.lookY ?? 0, tilt) + bob * 0.3;
      sent.el = lerp(from.pitch, to.pitch, tilt) * RAD + bob * 0.5 * RAD;
    }
    film.pose({
      ...sent,
      /* and the page's own chase is stood down too: two integrators is
         two histories, and an exact film has none */
      snap: this.exact ? true : undefined,
      fov: eye ? eye.fov : null,
      near: eye
        ? [
            lerp(eye.at[0], (eye.to ?? eye.at)[0], walk),
            lerp(eye.at[1], (eye.to ?? eye.at)[1], walk),
            lerp(eye.at[2], (eye.to ?? eye.at)[2], walk),
          ]
        : null,
    });
    /* the mood and the sun's rake go to the glass only when they change:
       the page eases between them itself, so this is a target, not a frame */
    const mood = this.grade;
    const snap = this.gradeSnap;
    if (mood !== this.gradeSent || this.rakeDeg !== this.rakeSent) {
      const spec = this.grades[mood] ?? this.grades['amber']!;
      film.grade({ ...spec, rake: this.rakeDeg * RAD }, snap);
      this.gradeSnap = false;
      this.gradeSent = mood;
      this.rakeSent = this.rakeDeg;
    }
    /* the stock rides beside the mood: a name the page bakes, or a .cube
       under `assets/luts/`, crossfaded in the glass */
    const b = this.beat;
    /* a film that names no stock gets none: the grade alone is a look */
    const chapLut = this.chapters[b.ch ?? 0]?.lut ?? null;
    const lutName = b.lut === null ? null : (b.lut ?? b.look ?? chapLut);
    if (lutName !== this.lutSent && film.lut) {
      const fx = this.lookFx[lutName ?? ''];
      film.lut(
        lutName === null
          ? null
          : lutName.includes('.')
            ? {
                amount: this.lutAmount,
                url: `${this.args.assets}luts/${lutName}`,
              }
            : { ...(fx ?? { amount: this.lutAmount }), look: lutName },
        snap,
      );
      this.lutSent = lutName;
    }
    /* walk the key light to the shot's own sun — the short way round,
       over about a second and a half */
    const goal = this.sunGoal;
    if (this.exact) {
      /* the walk is a function of the beat's clock: from where the last
         beat left the light to where this one asks, over a second and a
         half, the short way round */
      if (goal) {
        const from = this.sunFrom ?? goal;
        const k = smooth(Math.min(1, since / 1.5));
        this.sunNow = {
          az: from.az + wrapAngle(goal.az - from.az) * k,
          el: lerp(from.el, goal.el, k),
        };
        film.light(this.sunNow);
      }
    } else if (goal && this.sunNow) {
      /**
       * AT A RATE, not on a time constant. An eased approach takes the
       * same second and a half whether the sun moves two degrees or
       * fifty-five — and fifty-five degrees in a second and a half is
       * the jarring relight between the construction chapter (near
       * overhead) and the detail chapter (raking). Capping the angular
       * speed makes a small change quick and a big one a proper move,
       * which the chapter's own flight has time for.
       */
      const cap = 0.3 * dt;
      const ease = Math.min(1, dt * 1.6);
      const walk = (from: number, to: number) => {
        const d = (to - from) * ease;
        return from + (Math.abs(d) > cap ? Math.sign(d) * cap : d);
      };
      let d = goal.az - this.sunNow.az;
      while (d > Math.PI) {
        d -= Math.PI * 2;
      }
      while (d < -Math.PI) {
        d += Math.PI * 2;
      }
      this.sunNow.az = walk(this.sunNow.az, this.sunNow.az + d);
      this.sunNow.el = walk(this.sunNow.el, goal.el);
      film.light(this.sunNow);
    }
    this.pageEl?.style.setProperty('--cf-lx', this.lean.x.toFixed(3));
    this.pageEl?.style.setProperty('--cf-ly', this.lean.y.toFixed(3));
    /* THE PLAYHEAD, as a custom property rather than tracked state: it
       changes sixty times a second and nothing about the template's
       shape changes with it, so it must never cause a re-render. */
    const at = this.exact
      ? this.t
      : this.secsBefore(this.absoluteIndex) +
        Math.min(this.beat.ticks * TICK, since);
    const total = this.totalSecs;
    const prog = this.scrubAt ?? Math.min(1, at / total);
    this.pageEl?.style.setProperty('--cf-prog', prog.toFixed(5));
    /* the rail's head rides the film's own clock when it has one, and
       the playhead when it does not */
    if (!this.args.clock) {
      this.pageEl?.style.setProperty('--cf-head', prog.toFixed(5));
    }
    if (this.trackW > 0) {
      this.pageEl?.style.setProperty('--cf-hpx', this.headPx(prog).toFixed(1));
    }
    const pct = Math.round(prog * 100);
    if (pct !== this.shownPct) {
      this.shownPct = pct;
      this.scrubEl?.setAttribute('aria-valuenow', String(pct));
    }
    const sec = Math.floor(at);
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.clock = Film.mmss(at);
    }
    this.clips(film, at, jumpedNow);

    const beat = this.beat;
    /**
     * The beat's own local clock. It is re-based at every beat entrance, so
     * whatever it drifts is bounded by one beat rather than by the film —
     * the same seek-unsafe-but-self-correcting bargain the chaser makes,
     * and for the same reason: these are simulations, not tweens.
     */
    const local = Math.min(1, since / (beat.ticks * TICK));

    /* only while the film is rolling: an ended or gated film must not keep
       driving the last beat's clock, or a restart finds the tower still
       down behind the door */
    if (Array.isArray(beat.build) && this.rolling) {
      /* a settle: the shot is seen standing before the first stone moves */
      const settle = beat.settle ?? 0;
      const span0 = beat.ticks * TICK;
      const bl = Math.max(
        0,
        Math.min(1, (since - settle) / Math.max(0.01, span0 - settle)),
      );
      const t = lerp(
        beat.build[0],
        beat.build[1],
        smooth(Math.min(1, bl / (beat.buildBy ?? 1))),
      );
      film.time(t);
      this.showYear(t);
    } else if (beat.build !== undefined) {
      this.showYear(Array.isArray(beat.build) ? beat.build[0] : beat.build);
    }
    /**
     * The corner empties half a second before the beat changes — and
     * "changes" means the next CUE, not the end of this beat's own
     * ticks. A beat followed by a chapter flight is on screen for its
     * own length PLUS that flight's lead, and measuring against the
     * short number faded the type out early and then held it at zero
     * for the rest of the shot.
     */
    const nextLead = this.all[this.absoluteIndex + 1]?.lead ?? 0;
    const span = (beat.ticks + nextLead) * TICK;
    const left = Math.max(0, span - since);
    const last = !this.all[this.absoluteIndex + 1];
    /* THE TYPE LEAVES BEFORE THE CUT AND DOES NOT COME BACK. The fade is
       written on the block itself, not only on the container: a container
       that snaps back to 1 for the next beat while the old block is still
       standing inside it as a leaver is the flash — the old setting at
       full strength for the length of its exit. With the block at 0 on
       its own inline style, the leaver has nothing to come back to. */
    /* and it does not ARRIVE until the seam is over: the entrance tweens
       apply their from-values when they start, not when the pass starts,
       so for the length of the wait the block would stand at full
       strength over the transition. The block itself is held at 0 until
       the wait is up and rises over the next 0.4 s, under the tweens. */
    const wait = this.typeAt[0]! - 0.05;
    const enter = smooth(Math.max(0, Math.min(1, (since - wait) / 0.4)));
    /* THE LAST BEAT'S TYPE LEAVES BEFORE THE CARD. Its cue landed a slot
       after its nominal start (the spline-seed offset every cue but the
       first carries), so measured on its own clock the beat has a tick
       left when the run's last cue ends the film — and the type was
       standing at full strength when the scrim came. Measure to the
       ending instead: gone half a second before it, over two seconds. */
    const endOff = !this.exact && this.beatIndex === 0 ? 0 : TICK;
    const tailA = this.ended
      ? 0
      : last
        ? smooth(Math.max(0, Math.min(1, (left - endOff - 0.5) / 2.0)))
        : smooth(Math.min(1, left / 1.0));
    const typeA = Math.min(enter, tailA);
    this.pageEl?.style.setProperty('--cf-type-a', typeA.toFixed(3));
    /* THE TITLE HANDS THE FRAME TO THE SUBJECT. The opening card is
       type-first — the study's name at poster size while the lens is
       still far out — and as the push arrives the plate settles to the
       size every other beat's type is set at. One property, eased, held
       for the first breath. */
    const titleK =
      beat.mode === 'title'
        ? smooth(
            Math.max(0, Math.min(1, (since - 1.0) / Math.max(0.5, span - 1.4))),
          )
        : 1;
    this.pageEl?.style.setProperty('--cf-title-k', titleK.toFixed(3));
    /**
     * THE ANNOUNCED YEAR STANDS IN THE PLACE, NOT ON THE GLASS.
     *
     * On the glass it was a caption the size of the frame: nothing could
     * pass in front of it, and it was white whatever the light was doing.
     * As a plane in the scene the building crosses it, the shot moves past
     * it, and it takes its colour from the hour — a warm ink on a bright
     * morning, a pale wash at night — which is the difference between a
     * date that belongs to the picture and one laid over it.
     */
    const stampA = this.stampAt(beat, local) * typeA;
    if (beat.stamp && (stampA > 0.002 || this.stampOn)) {
      this.stampOn = stampA > 0.002;
      const pal = film.palette();
      const night = luminance(pal.paper) < 0.42;
      film.sky(
        'stamp',
        {
          color: night ? 'rgba(247,240,224,0.5)' : 'rgba(62,50,26,0.42)',
          family: this.worldFamily,
          lines: [String(beat.stamp.y)],
          shadow: night ? 'rgba(0,0,0,0.35)' : 'rgba(255,252,244,0.3)',
          shadowBlur: 0.12,
          size: 5.4,
          track: this.worldTrack * 0.5,
          weight: this.worldWeight,
        },
        {
          billboard: true,
          opacity: stampA * 0.9,
          x: -Math.sin(this.skyAz) * 34,
          y: 6.4,
          z: -Math.cos(this.skyAz) * 34,
        },
      );
    }
    if (this.plateEl) {
      this.plateEl.style.opacity = typeA.toFixed(3);
    }
    /* THE HOURS OF A BEAT: a beat can walk the page's times of day across
       its length — the ending goes morning, noon, dusk, night as the
       tower comes down, and stays in the night */
    if (beat.hours?.length && this.rolling) {
      const over = beat.hoursOver ?? 1;
      const hl = Math.min(1, local / over);
      const step = Math.min(
        beat.hours.length - 1,
        Math.floor(hl * beat.hours.length),
      );
      if (step !== this.hourStep) {
        this.hourStep = step;
        /* each hour blends across its whole share of the beat, so the
           day turns rather than steps */
        film.themeDur((beat.ticks * TICK * over) / beat.hours.length);
        film.theme(beat.hours[step]!, false);
      }
    }
    /* THE CHAPTER'S NUMERAL LEAVES WITH THE CHAPTER. It is furniture
       for the passage, not for the beat, so it holds across the shots
       inside a chapter and fades out over the tail of the last one —
       an 02 still sitting in the corner while 03 arrives is the film
       forgetting which chapter it is in. */
    const here = this.absoluteIndex;
    const tail = (this.all[here + 1]?.ch ?? -1) !== beat.ch;
    /* and it gives way while the announced year is standing out in the
       scene: two pale numerals of different sizes in one frame is not a
       texture, it is a collision */
    this.pageEl?.style.setProperty(
      '--cf-ghost-a',
      (
        (tail ? 1 - smooth(Math.max(0, (local - 0.72) / 0.22)) : 1) *
        (1 - this.stampAt(beat, local))
      ).toFixed(3),
    );
    /* the bolt the cut asked for, once per landing on this beat */
    if (
      beat.lightning !== undefined &&
      this.struck !== beat.id &&
      since >= beat.lightning
    ) {
      this.struck = beat.id;
      film.lightning();
    }
    if (beat.dissolve) {
      /* the building goes, the frame stays */
      film.modelFade(1 - smooth(Math.max(0, (local - 0.12) / 0.72)));
    }

    /**
     * WEATHER CROSSES THE SHOT. The scene lights itself beautifully and
     * then holds that light for four minutes, which is the one thing
     * daylight never does. So every beat long enough to notice gets a
     * cloud: the air thickens, a cool shadow passes over the picture,
     * and it clears again before the beat is out. It is one pass, phased
     * off the beat's own place in the script so no two land alike, and
     * it never touches the grade — a chapter's colour is an argument,
     * this is only the sky.
     */
    if (beat.ticks * TICK >= 8) {
      const phase = ((this.beatIndex * 0.37) % 1) * 0.25;
      const w = Math.max(0, Math.min(1, (local - 0.12 - phase) / 0.62));
      const cloud = Math.sin(Math.PI * w) ** 2;
      film.haze((this.hazeBase ?? 0) + this.cloudHaze * cloud);
      this.pageEl?.style.setProperty('--cf-cloud', cloud.toFixed(3));
      this.pageEl?.classList.toggle('is-cloudless', cloud < 0.02);
    } else {
      this.pageEl?.style.setProperty('--cf-cloud', '0');
      this.pageEl?.classList.add('is-cloudless');
    }

    /* the lineup's metronome: the beat divides itself evenly among its
       towers and the last one holds the remainder, so the recap ends
       standing on the film's own subject */
    if (beat.cycle?.length) {
      const step = Math.min(
        beat.cycle.length - 1,
        Math.floor(local * beat.cycle.length),
      );
      if (step !== this.cycleStep) {
        this.cycleStep = step;
        const c = beat.cycle[step]!;
        /* a subject by index (a scene with several), a moment on the
           film's own clock, or simply the standing subject */
        if (c.style !== undefined && film.style && film.styleIndex) {
          if (film.styleIndex() !== c.style) {
            film.style(c.style);
          }
        }
        film.time(
          c.year !== undefined && this.args.clock
            ? this.args.clock.tAt(c.year)
            : this.args.standing,
        );
        /* each stamp lands with the scene's own construction hit; the
           final one — the film's subject — gets the bell */
        film.ping(step < beat.cycle.length - 1 ? 0 : 99);
      }
    }

    /* the world layer fades with the beat rather than cutting with it */
    if (beat.sky) {
      const d = beat.sky.dist ?? 30;
      /**
       * PARALLAX. This used to be placed at `view().az + offset`, which
       * pins the word to the LENS: the camera orbits, the glyph orbits
       * with it, and a hundred feet of type sits perfectly still in the
       * frame — the one thing that tells an eye it is looking at a
       * sticker rather than a place. The angle is now taken once, when
       * the beat lands, and the word stays where it was put: the shot
       * moves past it.
       */
      const a = this.skyAz;
      this.skyOn = this.exact
        ? smooth(Math.min(1, since / 0.62))
        : this.skyOn + (1 - this.skyOn) * Math.min(1, dt * 1.6);
      film.sky(
        'chapter',
        {
          /* HOLLOW, HUGE, AND NEARLY GONE. A filled glyph sharing air
             with the building is a stain on the lens; a hard outline is
             a diagram drawn on the sky. What the shot wants is a word
             the WEATHER is holding — twice the size, a hairline, and
             faint enough that the hill reads straight through it. */
          color: 'rgba(252,247,236,0.34)',
          /* THE YEAR IS THE CENTENARY'S OWN NUMERAL. It was set in the
             page's old-style serif — the typography of the standalone
             study, not of this film — which read as a caption borrowed
             from somewhere else every time a date came up in the sky.
             Heavy grotesque, barely tracked, the way the programme sets
             a date. */
          family: this.worldFamily,
          lines: beat.sky.lines,
          shadow: 'rgba(40,30,14,0.34)',
          shadowBlur: 0.16,
          size: beat.sky.size * 3.4,
          weight: this.worldWeight,
          /* LIGHT, not ink. Drawn in the same warm white the front door
             uses, at a hairline: over this film's grounds a pale
             outline reads as a word held in the air, where a dark one
             reads as a diagram printed on the sky. */
          track: beat.sky.track ?? this.worldTrack,
        },
        {
          billboard: true,
          opacity:
            this.skyOn *
            (beat.sky.opacity ?? 0.4) *
            0.78 *
            smooth(Math.max(0, Math.min(1, (local - 0.16) / 0.16))) *
            (1 - smooth(Math.max(0, Math.min(1, (local - 0.52) / 0.16)))),
          x: -Math.sin(a) * d,
          y: beat.sky.y,
          z: -Math.cos(a) * d,
        },
      );
    } else if (this.skyOn > 0.001) {
      this.skyOn = this.exact
        ? 0
        : this.skyOn + (0 - this.skyOn) * Math.min(1, dt * 2.4);
      film.fade('chapter', this.skyOn);
    }

    this.stageMark(film, beat, local, dt);
    this.trackPoint(film, beat, local, typeA);
    this.traceShape(film, beat, local, dt);
    this.parallax(local);
    this.follow(film);
    this.wear(film);
  }

  /**
   * TYPE THROWS ITS SHADOW WHERE THE BUILDING THROWS ITS OWN.
   *
   * The scene lights itself from a key whose position is a property of the
   * hour, and the tower's cast shadow lies along the ground at whatever
   * diagonal that produces. Type set over the frame with a shadow offset
   * down and right — the default of every drop shadow ever shipped — is
   * lit by a different sun than everything behind it, and the eye reads
   * the mismatch long before it can name it. So the key's own screen
   * position comes back from the scene and the offset is simply the
   * direction away from it. At night, or with the sun behind the lens,
   * there is no honest cast shadow and the type wears none.
   */
  private follow(film: Picture) {
    const el = this.pageEl;
    if (!el) {
      return;
    }
    const s = film.sun();
    const cx = s.w / 2;
    const cy = s.h * 0.55;
    const dx = cx - s.x;
    const dy = cy - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const throwPx = s.on ? 3.2 : 0;
    const nx = (dx / len) * throwPx;
    const ny = (dy / len) * throwPx;
    /* a whole pixel is enough to read and small enough never to smear */
    const q = (v: number) => Math.round(v * 10) / 10;
    if (q(nx) !== this.shadow.x || q(ny) !== this.shadow.y) {
      this.shadow = { x: q(nx), y: q(ny) };
      el.style.setProperty('--cf-shx', `${this.shadow.x}px`);
      el.style.setProperty('--cf-shy', `${this.shadow.y}px`);
      /* the same diagonal, longer, for the graphic rules */
      this.rakeDeg = q(Math.atan2(ny, nx) * 57.2958);
      el.style.setProperty('--cf-rake', `${this.rakeDeg}deg`);
    }
  }

  /**
   * THE FURNITURE WEARS THE SCENE'S PALETTE.
   *
   * The page carries four times of day and swings its whole palette between
   * them, so a scrim and a caption painted in one fixed ochre are correct in
   * exactly one chapter and wrong in the other four — at noon the film's
   * warm paper sits on a cool scene like a sticker. The scene already
   * publishes its ink as CSS variables, so the film simply reads them and
   * dresses itself the same, once per change rather than once per frame.
   */
  private wear(film: Picture) {
    const p = film.palette();
    if (!p.time) {
      return;
    }
    /**
     * THE INK IS JUDGED AGAINST WHAT IS ACTUALLY ON SCREEN. The paper
     * alone lied: a noon paper under a heavy grade, a dim, and thick
     * haze is a DARK frame wearing a light theme, and dark ink on it
     * disappears. So the measured luminance is discounted by the
     * grade's own brightness, by whether this beat runs the dim, and
     * by its haze — and the type flips to light whenever the frame it
     * sits on has genuinely gone dark, not merely when the clock says
     * night.
     */
    const GB = this.args.gradeLum ?? GRADE_LUM;
    const beat = this.beat;
    const dimmed = beat.trace || beat.to ? 0.74 : 1;
    const eff =
      luminance(p.paper) *
      (GB[this.grade] ?? 1) *
      dimmed *
      (1 - 0.25 * (beat.haze ?? 0));
    const dark = eff < 0.42;
    const ch = this.chapters[this.beat.ch ?? 0] ?? this.chapters[0]!;
    const sig = `${p.time}${dark ? '#d' : '#l'}${ch.n}`;
    if (sig === this.wearing) {
      return;
    }
    this.wearing = sig;
    const el = this.pageEl;
    if (!el) {
      return;
    }
    el.style.setProperty('--cf-paper', p.paper);
    el.style.setProperty('--cf-paper-a', rgba(p.paper, 0.94));
    el.style.setProperty('--cf-paper-b', rgba(p.paper, 0.76));
    el.style.setProperty('--cf-paper-c', rgba(p.paper, 0));
    /**
     * WHEN THE GROUND GOES DARK, THE TYPE GOES LIGHT.
     *
     * The scrims are mixed from the scene's own paper, so at night they
     * are a dark wash — and dark ink on a dark wash is unreadable however
     * carefully the scrim was tuned. Rather than hand-pick a palette per
     * hour, the ink is DERIVED — from the frame's effective luminance,
     * computed above. One rule, right for all four hours, every grade,
     * and any theme anybody adds later.
     */
    el.classList.toggle('is-dark', dark);
    el.style.setProperty('--cf-ink', dark ? '#f7f0e0' : p.ink);
    el.style.setProperty('--cf-ink2', dark ? '#bdb3a0' : p.ink2);
    el.style.setProperty('--cf-ink3', dark ? '#e6dcc8' : p.ink3);
    /* gold, not amber: the liturgical metal, by day and under floodlight */
    el.style.setProperty('--cf-accent', this.accentFor(dark, p.accent));
    el.style.setProperty('--cf-rule', p.rule);
    /* the chapter's own colour, which every piece of type in the
       information layer is set in (see this.chapters) */
    el.style.setProperty(
      '--cf-chap',
      (dark ? ch.tintD : ch.tint) ?? this.accentFor(dark, p.accent),
    );
  }

  /**
   * PLANES, MOVING AT THEIR OWN RATES.
   *
   * The world layer parallaxes because it is genuinely out in the scene at
   * different distances. The front layer has no depth to borrow, so it is
   * given one: over the life of a beat each row drifts and scales on its
   * own rate, the big glyph fastest and nearest, the small print slowest
   * and furthest, so the type reads as a set of planes rather than a
   * sheet. It is the oldest trick in motion graphics and it is here for
   * the oldest reason — a still caption over a moving picture looks
   * pasted on, and a caption that moves WITH the picture looks composited
   * into it.
   *
   * It runs on the beat's own clock rather than Motion's, deliberately:
   * the entrances belong to the score and this belongs to the shot, and
   * putting the two on one timeline would mean the drift restarting every
   * time a word did.
   */
  private parallax(local: number) {
    const rows = this.rowEls;
    if (!rows.length) {
      return;
    }
    /* ease in over the head of the beat, then KEEP MOVING: the old curve
       saturated at half the beat and the block sat still for the rest,
       which is exactly the pasted-on look the parallax exists to kill.
       This one never stops — a slow push that lasts the whole shot. */
    const t = smooth(Math.min(1, local * 1.6)) * (0.35 + 0.65 * local);
    /**
     * A CLOSE-UP GETS LESS OF THIS. Parallax on the type exists to
     * stop a caption looking pasted onto a moving picture. On a 4× detail
     * shot the picture is barely moving and the caption is the largest
     * thing on screen, so the same amplitude stops reading as depth and
     * starts reading as drift. It has to scale with what the shot behind
     * it is actually doing.
     */
    const amp = this.beat.mode === 'point' ? 0.35 : 1;
    /* the last moments of the beat let go: the planes keep travelling
       and fade under the swap, so an exit is an exit and not a vanish */
    const out = local > 0.93 ? Math.max(0, (1 - local) / 0.07) : 1;
    for (const [i, el] of rows.entries()) {
      /* the glyph sits near the top of the block and should be the
         NEAREST plane, so depth runs down the block rather than up it —
         and each plane travels at its OWN rate, slightly detuned, so the
         stack reads as separate sheets of glass rather than one card */
      const depth = 1 - i / Math.max(1, rows.length - 1);
      const rate = 1 + 0.22 * Math.sin(i * 2.4);
      /* the x-glide is SHARED: staggering it per row shifts every text
         line's left edge differently, which the eye reads as broken
         indentation, not depth. The planes separate in y and scale,
         where the type's own alignment cannot be injured. */
      const dx = -11 * t * amp;
      const dy = -(5 + 13 * depth) * t * amp * rate;
      const sc = 1 + 0.055 * depth * t * amp;
      el.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
      el.style.opacity = out.toFixed(3);
    }
  }

  /**
   * THE TRACES LIVE IN THE SCENE NOW. They began as SVG projected over
   * the frame — approximately right and one frame behind the lens on
   * every move. As tubes in the page's own scene they are exact: they
   * lie ON the eave because they are geometry at the eave's own
   * coordinates, the building occludes them honestly, and the draw-on
   * is the tube's index buffer revealed in path order. Each line in a
   * set starts a moment after the one before it — a hand annotating,
   * not a diagram switching on.
   */
  /** how much of the follow is in force (eased), and its last aim and zoom */
  private riseK = 0;
  private riseAim = 0;
  private riseZoom = 1;

  /**
   * THE LENS FOLLOWS THE WORK. Chris's rule for a building that goes up
   * in the shot: if a spire is rising, ZOOM OUT; as you push in, follow
   * the top that is being built. So while the followed campaign is
   * between its base and its top, the aim rides a little above the
   * middle of what stands and the zoom is capped to keep base and top
   * in the frame; when it finishes, the authored pose takes over again,
   * on a one-pole so the release is a move and not a jump.
   */
  private followRise(
    film: Picture,
    dt: number,
  ): null | { lookY: number; zoom: number } {
    const b = this.beat;
    const want =
      b.follow !== false && Array.isArray(b.build)
        ? (film.rising?.(typeof b.follow === 'string' ? b.follow : undefined) ??
          null)
        : null;
    const on = !!want && want.rising;
    if (this.exact) {
      /* the follow eases in and out on the campaign's own progress, which
         is a function of the page's clock and so of the film's */
      if (!on || !want) {
        return null;
      }
      const span = Math.max(1.6, want.top - want.base + 1.0);
      const aim = want.base + 0.58 * (want.top - want.base) - this.rigMid;
      const zoom = Math.min(this.now.dolly, 7.0 / span);
      const k =
        smooth(Math.min(1, want.k / 0.12)) *
        (1 - smooth(Math.max(0, (want.k - 0.86) / 0.14)));
      return {
        lookY: lerp(this.now.lookY, aim, k),
        zoom: lerp(this.now.dolly, zoom, k),
      };
    }
    if (on && want) {
      const span = Math.max(1.6, want.top - want.base + 1.0);
      const aim = want.base + 0.58 * (want.top - want.base) - this.rigMid;
      const zoom = Math.min(this.now.dolly, 7.0 / span);
      const k = Math.min(1, dt / 1.1);
      this.riseAim += (aim - this.riseAim) * (this.riseK < 0.02 ? 1 : k);
      this.riseZoom += (zoom - this.riseZoom) * (this.riseK < 0.02 ? 1 : k);
    }
    this.riseK += ((on ? 1 : 0) - this.riseK) * Math.min(1, dt / 0.9);
    if (this.riseK < 0.01) {
      return null;
    }
    return {
      lookY: lerp(this.now.lookY, this.riseAim, this.riseK),
      zoom: lerp(this.now.dolly, this.riseZoom, this.riseK),
    };
  }

  /** the beat whose lines are being timed, and the local time they became drawable */
  private traceBeat = '';
  private traceFrom = -1;
  /** whether the beat's lines may be on the glass right now */
  private traceOk = false;

  /**
   * NO LINE ON A THING STILL GOING UP. A trace or a callout is drawn on a
   * finished part: the followed campaign must be done (or, with nothing
   * followed, the built height must have passed the line). The draw-on
   * is timed from the moment that became true, not from the head.
   */
  private traceReady(film: Picture, beat: Beat, local: number): boolean {
    if (this.traceBeat !== beat.id) {
      this.traceBeat = beat.id;
      this.traceFrom = -1;
    }
    let ready = true;
    if (beat.follow !== false && Array.isArray(beat.build)) {
      const r = film.rising?.(
        typeof beat.follow === 'string' ? beat.follow : undefined,
      );
      if (typeof beat.follow === 'string') {
        ready = !!r && r.done;
      } else {
        ready = !r || !r.rising;
      }
    }
    if (ready && this.traceFrom < 0) {
      this.traceFrom = local;
    }
    this.traceOk = ready && this.traceFrom >= 0;
    return this.traceOk;
  }

  private traceShape(film: Picture, beat: Beat, local: number, dt: number) {
    const specs = beat.trace ?? [];
    let drew = 0;
    /* AND THEY LEAVE. A hand that annotates a drawing also takes the
       annotation away; a red line that survives to the cut reads as
       something the film forgot. The whole set fades over the last
       fifth of the beat, in the order it was drawn. */
    const gone = Math.min(1, Math.max(0, (local - 0.78) / 0.16));
    const since = this.traceReady(film, beat, local)
      ? local - this.traceFrom
      : -1;
    for (const [i] of specs.entries()) {
      const draw = Math.min(1, Math.max(0, (since - 0.04 - i * 0.12) / 0.16));
      /* UNDRAWN, NOT FADED: the pen lifts back along the path it drew,
         first line first, so the annotation leaves as a gesture */
      const undraw = Math.min(1, Math.max(0, gone * (1 + i * 0.25)));
      drew = Math.max(drew, draw * (1 - undraw));
      if (undraw > 0 && film.traceUndraw) {
        film.traceUndraw(`t${i}`, undraw);
        film.traceFade(`t${i}`, undraw >= 1 ? 0 : 1);
      } else {
        film.traceDraw(`t${i}`, draw);
        /* a page that cannot lift the pen fades the line instead */
        film.traceFade(`t${i}`, 1 - undraw);
      }
    }
    /* the callout earns the dim too — a leader and a ring are annotation
       just as much as a traced eave is */
    if (beat.to) {
      drew = Math.max(drew, Math.min(1, Math.max(0, (since - 0.04) / 0.18)));
    }
    if (this.dim) {
      this.dimNow = this.exact
        ? drew
        : this.dimNow + (drew - this.dimNow) * Math.min(1, dt * 3.2);
      this.dim.style.opacity = this.dimNow.toFixed(3);
    }
  }

  /** the mark's facing, damped behind the camera's own bearing */
  private markFace = 0;

  /**
   * Place the stage mark: climb to its height with a settle, hold, and
   * face the camera a beat late.
   */
  private stageMark(film: Picture, beat: Beat, local: number, dt: number) {
    const m = beat.mark;
    const tether = this.tetherEl;
    /* THE CLIMB BELONGS TO THE WORD, NOT TO THE BEAT. A word that waits
       for its wall to be built must still ENTER low — otherwise it
       arrives at whatever height a ramp running since the top of the
       beat has carried it to, which for the stone base meant appearing
       halfway up the sky it was supposed to rise into. The rise is
       measured from the moment it shows up. */
    if (!m) {
      film.fade('mark', 0);
      if (tether) {
        tether.style.opacity = '0';
      }
      return;
    }
    /**
     * IT COMES IN BEHIND THE BUILDING, EVERY TIME. The entry height is
     * read off the structure at the moment the word arrives — a little
     * under the top of whatever has been built so far — so the thing on
     * screen always hides the word's first frames and hands it over as
     * it climbs. Taken once per beat, because reading it every frame
     * would make the word ride the build instead of rising past it.
     */
    if (!this.markSeated && local >= (m.at ?? 0.14)) {
      this.markSeated = true;
      this.markFrom = Math.max(0.4, film.height() - 3.4);
    }
    /* the climb takes the first fifth of the beat and SETTLES — barely
       past its mark, once. The old spring bounced at the top like a
       carnival bell, which no surveyor's mark has ever done. */
    const raw = Math.min(1, Math.max(0, (local - 0.04) / 0.2));
    const c1 = 0.45;
    const p = raw - 1;
    const rise = raw >= 1 ? 1 : 1 + (c1 + 1) * p * p * p + c1 * p * p;
    const y = m.to * rise;
    const a = m.bearing * RAD;
    const v = film.view();
    /* a damped follow, and wrapped so the lag never takes the long way */
    this.markFace = this.exact
      ? v.az
      : this.markFace + wrapAngle(v.az - this.markFace) * Math.min(1, dt * 1.6);
    film.sky(
      'mark',
      {
        /* BIG, WHITE, SOFT, AND BEHIND. A dark label pasted over the
           scaffolding is a sticker; a big pale word standing further out
           than the structure — soft-edged, its own glow holding it
           against the hills, the building crossing in FRONT of it — is
           part of the place. */
        /* white OUTLINE, on its own plane behind the building, and
           smaller than the sky word: this one names a part rather than
           the chapter, so it stands at the height of the thing it names
           and keeps climbing with it. */
        /* BIGGER, FAINTER, AND IN THE SAME PLACE EVERY TIME. A word
           that lands somewhere new each beat is a caption chasing the
           building; one that always stands in the same spot behind it
           becomes a fixture of the film — you stop reading it as an
           annotation and start reading it as the name of what you are
           watching. Big enough to be architecture, faint enough that
           the timber crossing it always wins. */
        /* TINTED, not outlined. An outline is a drawing of a word; a
           tint is the word itself, standing in the same air as
           everything else and taking the same light. Grey because the
           sky it stands in is nearly white, and faint enough that the
           building crossing it always wins. */
        color: 'rgba(78,71,56,0.3)',
        family: this.worldFamily,
        lines: m.lines,
        shadow: 'rgba(255,252,244,0.28)',
        shadowBlur: 0.14,
        size: m.size * 2.7,
        track: this.worldTrack,
        weight: this.worldWeight,
      },
      {
        /* IN LATE, OUT EARLY. The word arrives after the shot has been
         running long enough to be about something, names the stage, and
         is gone before the middle — a title that outstays the moment it
         titles becomes furniture. */
        opacity:
          0.62 *
          smooth(Math.max(0, Math.min(1, (local - (m.at ?? 0.14)) / 0.16))) *
          (1 -
            smooth(
              Math.max(
                0,
                Math.min(
                  1,
                  (local - ((m.at ?? 0.14) + (m.hold ?? 0.34))) / 0.2,
                ),
              ),
            )),
        ry: (this.markFace / RAD) % 360,
        /**
         * IT RISES OUT FROM BEHIND THE BUILDING. The word starts low
         * enough that the structure stands in front of it, fades up
         * while it is still half hidden, climbs past the frame the
         * carpenters are raising, and is gone before it reaches the top
         * of the picture — so the BUILDING reveals it, rather than a
         * caption appearing beside the building. Planted on one azimuth
         * so the camera moves PAST it, and nudged back toward the lens
         * if the orbit carries it out of frame (below).
         */
        x: Math.sin(this.markAz) * 26 + Math.cos(this.markAz) * this.markOff,
        /* a short climb, not a launch: the word should read as drifting
           up out of the structure over its whole life, not crossing the
           frame — same time on screen, a third of the distance */
        y: this.markFrom + Math.max(0, local - (m.at ?? 0.14)) * 7,
        z: Math.cos(this.markAz) * 26 - Math.sin(this.markAz) * this.markOff,
      },
    );
    /**
     * KEEP IT ON SCREEN — WHILE IT IS ON SCREEN. A planted word
     * parallaxes, which is the point, but the shot can orbit far enough
     * to carry it out of the picture, so the anchor is nudged back
     * toward the lens when what it projects to leaves the safe area.
     *
     * Two things this must NOT do. It must not correct a word that has
     * already faded out — the first mark used to slide sideways as it
     * left, because the correction was still hunting a glyph nobody
     * could see. And it must not treat the TOP edge as a failure: this
     * word is supposed to rise out of frame. Only the sides count, and
     * only while it is visible.
     */
    const seen = film.project(
      Math.sin(this.markAz) * 26 + Math.cos(this.markAz) * this.markOff,
      this.markFrom + Math.max(0, local - (m.at ?? 0.14)) * 7,
      Math.cos(this.markAz) * 26 - Math.sin(this.markAz) * this.markOff,
    );
    const lit =
      local > (m.at ?? 0.14) - 0.02 &&
      local < (m.at ?? 0.14) + (m.hold ?? 0.34) + 0.02;
    const outside =
      lit && (!seen.on || seen.x < v.w * 0.12 || seen.x > v.w * 0.88);
    if (outside) {
      let d = v.az + Math.PI - this.markAz;
      while (d > Math.PI) {
        d -= Math.PI * 2;
      }
      while (d < -Math.PI) {
        d += Math.PI * 2;
      }
      this.markAz += d * Math.min(1, dt * 0.9);
    }

    /* AND IT IS TETHERED. A label floating beside a building names
       nothing; a line back to the height it is describing turns it into a
       measurement. */
    if (tether && this.frameEl) {
      const host = this.frameEl.getBoundingClientRect();
      const sx = host.width / v.w;
      const sy = host.height / v.h;
      const from = film.project(
        Math.sin(a) * m.r * 0.72,
        y,
        Math.cos(a) * m.r * 0.72,
      );
      const to = film.project(0, y, 0);
      tether.setAttribute('x1', String(from.x * sx));
      tether.setAttribute('y1', String(from.y * sy));
      /* it reaches for the word rather than appearing beside it */
      const tk = Math.min(1, Math.max(0, (raw - 0.4) / 0.22));
      const fx = Number(tether.getAttribute('x1') ?? 0);
      const fy = Number(tether.getAttribute('y1') ?? 0);
      tether.setAttribute('x2', String(fx + (to.x * sx - fx) * tk));
      tether.setAttribute('y2', String(fy + (to.y * sy - fy) * tk));
      tether.style.opacity = tk > 0.01 ? '0.55' : '0';
    }
  }

  /**
   * THE TRACKING LINE — the one piece of the front layer that has to know
   * where the camera is pointing this frame. The caption stays where the
   * layout put it and a line reaches from it to the actual point on the
   * building, redrawn every frame, so the label is attached to the thing
   * rather than merely near it.
   */
  private trackPoint(film: Picture, beat: Beat, local: number, typeA: number) {
    const line = this.lineEl;
    const dot = this.dotEl;
    if (!line || !dot) {
      return;
    }
    if (!beat.to || !this.frameEl || !this.plateEl) {
      line.style.opacity = '0';
      dot.style.opacity = '0';
      return;
    }
    /* nothing is worth pointing at before it is built: the clip plane is
       the honest test, since the point may be above it for most of a beat */
    if (beat.to[1] > film.height() + 0.15) {
      line.style.opacity = '0';
      dot.style.opacity = '0';
      return;
    }
    const p = film.project(...beat.to);
    const v = film.view();
    const host = this.frameEl.getBoundingClientRect();
    const box = this.plateEl.getBoundingClientRect();
    /* the page renders at its own size; the frame may be laid out at another */
    const sx = host.width / v.w;
    const sy = host.height / v.h;
    const x2 = p.x * sx;
    const y2 = p.y * sy;
    /* leave from the edge of the caption that faces the point */
    const cx = box.left - host.left + box.width / 2;
    const cy = box.top - host.top + box.height / 2;
    const x1 = x2 > cx ? box.right - host.left : box.left - host.left;
    const y1 = cy;
    /**
     * A RED LINE IS DRAWN, NEVER SWITCHED ON.
     *
     * The traces on the building draw themselves along their own path and
     * lift back off it; the callout — the leader and the ring — was
     * fading in and out beside them, so half the annotation was a gesture
     * and half was a light switch. Same clock, same behaviour: the leader
     * runs out from the caption to the point, the ring is drawn round it,
     * and at the end the leader's tail catches up with its head while the
     * ring un-draws the way it came.
     */
    const gate = p.on && this.traceOk;
    const inK = Math.min(1, Math.max(0, (local - 0.12) / 0.16));
    const outK = Math.min(1, Math.max(0, (local - 0.78) / 0.16));
    const draw = gate ? inK : 0;
    const lift = gate ? outK : 1;
    /* the head runs out first, then the tail follows it home */
    const hx = x1 + (x2 - x1) * draw;
    const hy = y1 + (y2 - y1) * draw;
    const tx = x1 + (hx - x1) * lift;
    const ty = y1 + (hy - y1) * lift;
    line.setAttribute('x1', String(tx));
    line.setAttribute('y1', String(ty));
    line.setAttribute('x2', String(hx));
    line.setAttribute('y2', String(hy));
    dot.setAttribute('cx', String(x2));
    dot.setAttribute('cy', String(y2));
    /* the line belongs to the caption: it fades with the type, so a
       chapter flight after the beat does not leave a rule hanging in the
       air over a caption that has already gone */
    line.style.opacity =
      draw > 0.01 && lift < 0.99 ? (0.75 * typeA).toFixed(3) : '0';
    /* the ring: an arc that grows from nothing and is rubbed out from
       the same end it started at */
    const vis = Math.max(0, draw - lift);
    dot.style.strokeDasharray = `${vis.toFixed(3)} 1`;
    dot.style.strokeDashoffset = String(-lift.toFixed(3));
    dot.style.opacity = vis > 0.005 ? typeA.toFixed(3) : '0';
  }

  /**
   * THE READOUT AND THE MARKER. The numeral is tracked and written only
   * when the whole year changes, which is a handful of times a run; the
   * marker's position is a custom property written every frame, because a
   * dot that steps once a year along a rule is a dot that looks broken.
   */
  /**
   * WHEN THE NUMERAL IS ON. It rises as the voice reaches the year, holds
   * while the phrase finishes, and is gone well before the cut — a date
   * that outstays the sentence that said it becomes a watermark.
   */
  private stampAt(beat: Beat, local: number): number {
    const st = beat.stamp;
    if (!st) {
      return 0;
    }
    const secs = beat.ticks * TICK;
    const read = this.voSecs[beat.id] ?? secs * 0.66;
    const t0 = (read * (st.at ?? 0.06) + this.typeAt[0]!) / secs;
    const rise = 0.9 / secs;
    const hold = 2.6 / secs;
    const fall = 1.1 / secs;
    const inK = Math.max(0, Math.min(1, (local - t0) / rise));
    const outK = Math.max(0, Math.min(1, (local - t0 - rise - hold) / fall));
    return smooth(inK) * (1 - smooth(outK));
  }

  /** the film's clock readout, from page seconds — nothing without a clock */
  private showYear(t: number) {
    const clock = this.args.clock;
    if (!clock) {
      return;
    }
    const y = clock.yearAt(t);
    const n = Math.floor(y);
    if (n !== this.yearSent) {
      this.yearSent = n;
      this.yearNow = n;
    }
    const [a, z] = clock.span;
    const p = Math.max(0, Math.min(1, (y - a) / (z - a)));
    this.pageEl?.style.setProperty('--cf-head', p.toFixed(4));
  }

  /** everything a beat changes in the world, done once on entry */
  private applyBeat(
    beat: Beat,
    instant = false,
    seam?: { frozen: boolean; seam: boolean; since: number },
  ) {
    const film = this.film;
    if (!film) {
      return;
    }
    this.beatAt = performance.now();
    this.cycleStep = -1;
    /* the traces are the beat's own; stand this beat's up unrevealed and
       take the last beat's down */
    for (let i = 0; i < 4; i++) {
      film.clearTrace(`t${i}`);
    }
    /* the tube's thickness is a SCREEN quantity wearing world units: a
       marker line should read the same weight in a wide shot as in a 4×
       close-up, so the radius is sized against the shot's magnification */
    const mag = (beat.cam.dolly + (beat.toCam?.dolly ?? beat.cam.dolly)) / 2;
    beat.trace?.forEach((spec, i) => {
      const r = Math.max(0.03, Math.min(0.2, (spec.wide ? 0.13 : 0.085) / mag));
      film.trace(`t${i}`, { pts: spec.pts, r });
    });
    /**
     * A JOIN WITHOUT A CUT. Most seams are cuts, but not all of them:
     * the construction chapter FLIES in and then has to clear the
     * standing building off the ground before it can build one, and a
     * tower blinking out of existence mid-sweep is a glitch. So a beat
     * may name a join without being a cut — the overlay plays over the
     * arriving shot and the camera is left alone.
     */
    if (beat.cut || beat.join) {
      const join = beat.join ?? this.defaultJoin;
      if (this.exact) {
        this.seamExact(film, beat, join, seam);
      } else if (join === 'whip') {
        this.whipUntil = performance.now() + 360;
      } else {
        /**
         * Every remaining join works the same way: capture the OUTGOING
         * frame first — the bridge renders one on demand and reads it
         * back synchronously — then snap, then run the join's overlay on
         * the still while the live incoming shot plays underneath.
         * 'wipe' sweeps it off along the sun's diagonal with a feathered
         * edge; 'blend' is a push dissolve (it fades AND travels);
         * 'iris' closes a circle onto the new shot's own subject; 'dip'
         * covers the seam with a colour. A failed capture (zero-sized
         * surface) degrades to a clean cut — a dip still gets its veil.
         */
        /**
         * THE FREEZE BELONGS ON THE GPU, NOT IN A JPEG.
         *
         * Every join that is not a blend used to read the canvas back and
         * encode it — `toDataURL` on a full-resolution, device-pixel-ratio
         * canvas, synchronously, on the frame of the cut. That is tens of
         * milliseconds of stall AT EVERY CUT, which is precisely where the
         * film could least afford it, and with the dip now the default
         * join it was happening twenty-odd times a run. The page can hold
         * the outgoing frame in its own render target instead, for free.
         * The still is kept only as the fallback for a join whose overlay
         * genuinely needs pixels in the DOM (the wipe sweeps one, the iris
         * closes over one).
         */
        if (join === 'blend' || join === 'melt' || join === 'dip') {
          /* the crossfade lives in the glass now; the still is the
             fallback, and a stale one must never stand in for it */
          this.freeze = '';
          /* A/B IN THE GLASS: when nothing but the lens changes across
             the seam, the outgoing shot keeps moving under the dissolve
             (the page draws both cameras). A seam that changes the hour,
             the weather, the model, the snow or the mood keeps the graded
             still — a live A under B's light is the old shot dressed
             wrong, which is worse than a frozen one. */
          const live =
            beat.theme === undefined &&
            beat.wx === undefined &&
            beat.style === undefined &&
            beat.winter === undefined &&
            beat.grade === undefined &&
            !beat.hours;
          if (!film.dissolve(join, undefined, live)) {
            const shot = film.snapshot();
            this.freeze = shot.length > 64 ? shot : '';
          }
        } else if (join !== 'cut') {
          const shot = film.snapshot();
          this.freeze = shot.length > 64 ? shot : '';
        }
        /* A WIPE IS A CUT with punctuation over it (docs/choreo-splices.md):
           the still of the outgoing shot sweeps off to reveal the incoming
           one, so the lens must already BE on the incoming shot. Without
           the cut, the sweep revealed the old shot still gliding toward the
           new pose — the same picture twice, once as a still and once live. */
        if (beat.cut || join === 'wipe') {
          this.snap(beat.cam, this.tailFor(this.beatIndex), beat.ticks * TICK);
        }
        if (join === 'dip') {
          this.dipColor = beat.dipTo ?? '#0d0905';
          this.play('dip');
        } else if (join === 'flash') {
          this.play('flash');
        } else if (join === 'sweep') {
          this.lightSweep(film, beat);
        } else if (join === 'defocus') {
          /* the rack: the freeze blurs away above while the live frame
             arrives soft and pulls itself sharp underneath */
          if (this.freeze) {
            this.play('defocus');
          }
          this.liveEl?.animate(
            [{ filter: 'blur(9px)' }, { filter: 'blur(0px)' }],
            { duration: 700, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
          );
        } else if (this.freeze) {
          if (join === 'wipe') {
            this.play('wipe');
          } else if (join === 'blur') {
            this.play('blur');
          } else if (join === 'luma') {
            this.play('luma');
          } else if (join === 'melt') {
            this.play('melt');
          } else if (join === 'blend') {
            this.play('blend');
          } else if (join === 'iris') {
            /* the circle closes ON the incoming shot's named point —
               projected now, with the camera already snapped — so the
               iris hands the eye directly to the subject */
            const v = film.view();
            const p = beat.to ? film.project(...beat.to) : undefined;
            const cx = p ? Math.max(12, Math.min(88, (p.x / v.w) * 100)) : 50;
            const cy = p ? Math.max(12, Math.min(88, (p.y / v.h) * 100)) : 50;
            this.irisAt = `--ix:${cx.toFixed(1)}%;--iy:${cy.toFixed(1)}%`;
            this.play('iris');
          }
        }
      }
    }
    /**
     * WHICH BUILDING THIS BEAT IS ABOUT — asserted, never inherited.
     *
     * This used to run only when a beat NAMED a style, so every beat
     * that did not name one (all of chapters one to four) simply kept
     * whatever tower was standing. Straight through from the top that is
     * invisible, because the film opens on the keep and only the
     * comparison names anything else. Come back the other way — the
     * comparison or the lineup, then a chapter skip back into DETAIL —
     * and the film narrates the Japanese keep over a Chinese pagoda: the
     * shot called "at the foot" frames somebody else's balcony, and the
     * traces, which are computed from the keep's own level table, point
     * at empty air. That is the "off by one section" and the second
     * building in the frame, and it is not a motion problem at all: it
     * is a beat inheriting state it never asked for. The subject of this
     * film is the keep, so a beat that says nothing means style zero.
     */
    /* WHICH SUBJECT THIS BEAT IS ABOUT — asserted, never inherited, in a
       scene that has several: a beat that says nothing means subject
       zero, or a chapter skip narrates one building over another */
    if (film.style && film.styleIndex) {
      const style = beat.style ?? 0;
      if (film.styleIndex() !== style) {
        film.style(style);
        film.time(
          Array.isArray(beat.build)
            ? beat.build[0]
            : (beat.build ?? this.args.standing),
        );
      }
    }
    /* whatever the last beat did to the model, this one starts whole */
    if (!beat.dissolve) {
      film.modelFade(1);
    }
    if (typeof beat.build === 'number') {
      film.time(beat.build);
    } else if (Array.isArray(beat.build)) {
      film.time(beat.build[0]);
    } else {
      /* EVERY BEAT OWNS ITS BUILD STATE. A beat that says nothing wants
         the building whole — so a chapter skip, a scrub or a restart
         landing anywhere after the ending finds the tower standing, not
         the last beat's rubble. Only the construction chapter and the
         ending say otherwise, and they say it explicitly. */
      film.time(this.args.standing);
    }
    if (beat.sky) {
      /* plant the word where the shot can see it, once */
      /* IT HAS TO BE IN THE SHOT.
         The bearing was taken from the lens at the head of the beat and
         then held — which is right, because a word that rides the lens is
         a sticker. But the shot MOVES after that: by the time the camera
         had swung forty degrees the word was off the left edge, standing
         in a piece of sky nobody was looking at. So the bearing is taken
         at the middle of the shot's own swing instead. The word is then
         behind the building at both ends of the move, the structure
         crosses it on the way past, and it never leaves the frame. */
      const swing = beat.toCam
        ? ((beat.toCam.yaw - beat.cam.yaw) * RAD) / 2
        : 0;
      this.skyAz =
        (this.film?.view().az ?? 0) + swing + (beat.sky.az ?? 0) * RAD;
    }
    if (beat.mark) {
      /* AND THE MARK STANDS BEHIND THE BUILDING. Taken once, along the
         lens axis at the moment the beat lands, so the word is directly
         behind the subject — the structure crosses it, the camera moves
         PAST it, and it never reads as a caption stuck on the glass. */
      this.markAz = (this.film?.view().az ?? 0) + Math.PI;
      /**
       * A ONE-CHARACTER WORD IS NOT A TWO-CHARACTER WORD. 瓦 centred on
       * the same anchor as 石垣 reads as sitting too far left — an eye
       * centres a line of type on its mass, not on its box. So a lone
       * glyph is nudged toward the right of frame, and which way THAT
       * is depends on where the lens is standing: both candidates are
       * projected and the one further right wins.
       */
      const lone = (beat.mark.lines[0] ?? '').length <= 1;
      this.markOff = 0;
      if (lone && this.film) {
        const a = this.markAz;
        const at = (k: number) =>
          this.film!.project(
            Math.sin(a) * 26 + Math.cos(a) * k,
            9,
            Math.cos(a) * 26 - Math.sin(a) * k,
          ).x;
        this.markOff = at(3.6) > at(-3.6) ? 3.6 : -3.6;
      }
      /* the entry height is taken when the word ARRIVES, not here —
         by then the building has grown and the word has to enter
         behind whatever is standing (see stageMark) */
      this.markSeated = false;
      this.markFrom = (beat.mark.to ?? 8) * 0.34 - 1.6;
    }
    this.applyAir(beat, instant);
    /**
     * THE VOICE CROSSES ON ITS OWN CLOCK. Tracks are linked by the seam
     * but independent across it: a beat with its own line fades the old
     * one under (~120ms) and speaks; a beat with none is an L-CUT — the
     * outgoing sentence finishes over the new shot and the duck lifts
     * when it lands, exactly as an editor would lay it. A designed
     * silence (`hush`) is the exception that asks for quiet.
     */
    if (beat.vo || beat.hush) {
      this.hush();
      this.speak(beat);
    } else if (!this.sound || !this.film?.speaking()) {
      /* nothing is actually speaking: the silent beat gets its music */
      this.film?.duck(1);
    }
    this.args.onBeat?.(beat, film);
  }

  /**
   * THE AIR OF A SHOT: grade, sun, haze, weather. Split out of the beat
   * so a chapter's sky can begin turning while the lens is still flying
   * into it — the `air` cue fires at the head of a lead, the beat's own
   * cue when it lands, and applying it twice is harmless because every
   * one of these is a set, not a step.
   */
  private applyAir(beat: Beat, instant = false) {
    /* THE STILL IS A, THE LIVE IS B. One scene cannot show two shots at
       once, so every join that carries a still of the outgoing shot (a
       cut, a wipe, a blend, a melt, a dip) needs the incoming shot to be
       ENTIRELY itself on its first live frame — hour, weather, grade
       snapped, not eased. Otherwise the sweep reveals the same building
       still wearing the last shot's light, and the seam reads as the
       same picture twice. Only a join with no still (a whip, a plain
       glide) gets to ease. */
    const hard =
      instant ||
      !!beat.cut ||
      (beat.join !== undefined && STILL_JOINS.has(beat.join));
    const film = this.film;
    if (!film) {
      return;
    }
    if (beat.theme !== undefined) {
      film.theme(beat.theme, hard);
    }
    /**
     * THE SUN MOVES, it does not switch on. Both sun and haze are shot
     * properties, released when a beat does not ask — otherwise one
     * raking close-up lights the rest of the film. But a beat that DOES
     * ask used to get its light in a single frame, which in the
     * construction chapter (side light at twelve degrees, then sixty,
     * then near-overhead) read as somebody flipping a switch. The goal
     * is set here and the frame loop walks the light to it.
     */
    const want = beat.sun
      ? { az: beat.sun.az * RAD, el: beat.sun.el * RAD }
      : null;
    this.sunFrom = instant ? null : this.sunGoal;
    this.sunGoal = want;
    if (hard || !this.sunNow || !want) {
      this.sunNow = want ? { ...want } : null;
      film.light(this.sunNow);
    }
    this.struck = '';
    this.hourStep = -1;
    this.gradeSnap = hard;
    if (!beat.hours) {
      film.themeDur(null);
    }
    this.hazeBase = beat.haze ?? null;
    film.haze(this.hazeBase);
    if (beat.wx !== undefined) {
      film.wx(beat.wx, hard || !!beat.wxCut);
    }
    if (beat.winter !== undefined) {
      film.winter(beat.winter);
    }
    film.mix(beat.mix ?? null);
    film.tag(Array.isArray(beat.build) && beat.build[1] > beat.build[0]);
    /* the weather preset draws rain for the page's own wide shot; a beat
       that is ABOUT the rain asks for more of it (Beat.rain) */
    film.rain(beat.rain ?? null);
    film.rim(beat.rim ?? null, true);
    film.quality?.(beat.quality ?? null);
    film.grass?.(beat.grass ?? false);
    if (beat.theme !== undefined) {
      this.hourNow = beat.theme;
    }
    /* by night the frosted city goes nearly under: the church is the lit thing */
    film.city?.(
      beat.city ?? 'glass',
      this.hourNow === 3 ? 0.08 : this.cityGlass,
    );
    this.args.onAir?.(beat, film, hard);
  }

  /**
   * THE HOUR A CUT INHERITS.
   *
   * Theme and weather are stated where they CHANGE, so a beat halfway
   * through the film usually says nothing about either — which is right
   * for a film played from the top and wrong for one dropped into. A
   * deep link (or a chapter skip) would open in whatever sky was last
   * set, which since the front door became an evening meant the
   * construction chapter got built at dusk. So a cut resolves its own
   * hour first: walk back to the last beat that named one, and take it.
   */
  private settleAir(index: number) {
    const film = this.film;
    if (!film) {
      return;
    }
    for (let i = index; i >= 0; i -= 1) {
      const t = this.all[i]?.theme;
      if (t !== undefined) {
        film.theme(t, true);
        break;
      }
    }
    for (let i = index; i >= 0; i -= 1) {
      const w = this.all[i]?.wx;
      if (w !== undefined) {
        film.wx(w, true);
        break;
      }
    }
    /* the snow a cut inherits — and a jump to before the first winter
       beat must land on bare ground, not on whatever was last pinned */
    let winter: Beat['winter'] = null;
    for (let i = index; i >= 0; i -= 1) {
      if (this.all[i]?.winter !== undefined) {
        winter = this.all[i]!.winter;
        break;
      }
    }
    film.winter(winter ?? null);
  }

  private shot = (state: ShotState) => {
    this.goal = {
      dolly: state.dolly,
      fx: state.look?.x ?? 0,
      fz: state.look?.z ?? 0,
      lookY: state.look?.y ?? 0,
      ox: state.x,
      pitch: state.pitch,
      yaw: state.yaw,
    };
  };

  private dispatch = (command: PerformCommand) => {
    if (command.action === 'lap') {
      /* the last cue has run. Looping past your own ending is how a film
         tells the viewer it never meant any of it. */
      this.end();
      return;
    }
    if (command.action === 'air') {
      const i = Number(command.target);
      if (Number.isFinite(i) && this.beats[i]) {
        this.applyAir(this.beats[i]!);
      }
      return;
    }
    if (command.action === 'beat') {
      const i = Number(command.target);
      /* THE HEAD BEAT IS APPLIED ONCE. A cut applies its beat itself, so
         the picture is right before the run exists; the run's first cue
         then names the same beat a pass later. Applying it again ran
         the join twice — and the second wipe snapshotted a lens that
         had already moved, so the sweep revealed the shot it covered. */
      if (i === 0 && this.primedLap === this.lap) {
        this.primedLap = -1;
        this.beatIndex = 0;
        return;
      }
      if (Number.isFinite(i) && this.beats[i]) {
        this.beatIndex = i;
        this.applyBeat(this.beats[i]!);
      }
    }
  };

  /**
   * PAUSE MEANS EVERYTHING STOPS. The score's run holds where it is (the
   * lens included), the page's own clock holds (grass, weather, the
   * build, the day), the audio graph suspends, and the beat clock is
   * shifted forward by the length of the hold on resume so the hours,
   * the build and the type pick up exactly where they stood. Tearing the
   * Sequence down was the old pause, and it re-ran the chapter on play.
   * An exact film's runs are already standing — its clock is the only
   * thing that has to hold.
   */
  private toggle = () => {
    if (!this.playing) {
      return;
    }
    this.paused = !this.paused;
    this.pop(this.paused ? 'pause' : 'play');
    if (!this.exact) {
      const run = this.scoreCtx?.run ?? null;
      if (this.paused) {
        this.pausedAt = performance.now();
        run?.pause();
      } else {
        this.beatAt += performance.now() - this.pausedAt;
        run?.play();
      }
    }
    this.film?.hold?.(this.paused);
    this.film?.pause(this.paused);
  };

  /** any re-cut or restart clears a hold: the new run starts rolling */
  private unhold() {
    if (this.paused) {
      this.paused = false;
      this.film?.hold?.(false);
      this.film?.pause(false);
    }
  }

  /**
   * SKIP A CHAPTER — by re-cutting, never by seeking.
   *
   * `from` moves to a chapter head, which changes the beat list, which
   * changes the path, the cues and the sequence's name all at once. The
   * region sees a different score and plays it from its head. Seeking the
   * existing run would be the obvious alternative and it would be wrong:
   * the lens is an integrator whose pose depends on where it has been, so
   * a run dropped into the middle of itself arrives with the wrong
   * velocity — the same reason `notes/sylva-one-world.md` calls the chaser
   * seek-unsafe and means it.
   */
  private goChapter = (delta: number) => {
    const heads = this.chapterHeads;
    const here = this.absoluteIndex;
    let i = heads.findIndex(
      (h, n) => here >= h && (heads[n + 1] ?? Infinity) > here,
    );
    if (i < 0) {
      i = 0;
    }
    /* back, from more than a moment into a chapter, means this chapter's
       head — the behaviour every transport control in the world has */
    const restart = delta < 0 && here > heads[i]!;
    const next = restart
      ? i
      : Math.max(0, Math.min(heads.length - 1, i + delta));
    this.cutTo(heads[next]!);
  };

  private cutTo(index: number, hard = false) {
    this.unhold();
    if (this.exact) {
      this.seek(this.beatStart(index));
      return;
    }
    this.from = index;
    this.beatIndex = 0;
    this.ended = false;
    this.playing = true;
    this.lap += 1;
    this.primedLap = this.lap;
    this.settleAir(index);
    this.applyBeat(this.all[index]!, true);
    /* the re-cut score opens on a spliced first waypoint, so the goal
       steps straight to this pose; the snap lands the lens beside it,
       already carrying that shot's own speed */
    this.snap(
      this.all[index]!.cam,
      hard ? undefined : this.tailFor(0),
      hard ? undefined : this.all[index]!.ticks * TICK,
    );
  }

  /** an uncaught error anywhere becomes a visible line — a film that
   *  dies silently mid-reel cannot be debugged from a chair */
  private trip = (e: Event) => {
    if (this.fault) {
      return;
    }
    const err = e as ErrorEvent & PromiseRejectionEvent;
    this.fault = String(err.message ?? err.reason ?? 'unknown fault').slice(
      0,
      200,
    );
  };

  private prev = () => this.goChapter(-1);
  private next = () => this.goChapter(1);

  private key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    /* at the door, one key opens it — with the sound the film was made
       with, since a keypress is as much a gesture as a click */
    if (this.gate) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.begin(true);
      }
      return;
    }
    if (this.ended && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      this.replay();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      this.toggle();
    } else if (e.key === 'f' || e.key === 'F') {
      this.screen();
    } else if (e.key >= '1' && e.key <= '9') {
      const head = this.chapterHeads[Number(e.key) - 1];
      if (head !== undefined) {
        this.pick(head);
      }
    } else if (e.key === '0' || e.key === 'Home') {
      this.restart();
    } else if (e.key === 'm' || e.key === 'M') {
      this.hear();
    } else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') {
      this.toc();
    } else if (e.key === 'v' || e.key === 'V') {
      this.cc();
    }
  };

  /**
   * THE NARRATION, one file per beat.
   *
   * `assets/vo/<id>.mp3`, played on the beat's entrance and stopped
   * when the beat changes. Per beat rather than one long track because
   * chapter skip RE-CUTS the film: a single track would have to be sought,
   * and a sought track against a re-cut score drifts inside a chapter.
   *
   * A missing file is silence, not an error. The film ships before the
   * voice does, and the score has to be right either way. While a line
   * plays the scene's own music ducks under it, which is the one piece of
   * mixing that cannot wait for a mix.
   */

  private voSrc(beat: Beat) {
    return `${this.args.assets}vo/${beat.id}.mp3`;
  }

  /** ask the page to fetch and decode the line after this one, now */
  private primeNext(beat: Beat) {
    const next = this.all[this.all.indexOf(beat) + 1];
    if (next?.vo) {
      this.film?.voicePrime(this.voSrc(next));
    }
  }

  /**
   * A BOUNDARY NEVER CLIPS THE VOICE — and every line has its own
   * throat. One shared element made politeness impossible: however
   * gently the old line was being faded, the new line's src swap
   * guillotined it mid-word. So an interrupted line keeps its OWN
   * element and fades there (~120ms, fast enough to read as a stop,
   * slow enough that no waveform is cut mid-cycle) while the new line
   * starts clean on a fresh one — the game-dialogue barge-in, which is
   * what a chapter skip actually is. ("Stop at the next word" is the
   * refinement this is built to take: an analyser watching for the
   * inter-word trough before the fade — see docs/choreo-splices.md.)
   */

  /**
   * A JOIN, EXHIBITED. Any seam as a pure overlay on whatever is playing —
   * no beat change, no snap: the transition itself, on the living
   * picture. What a cutting room's wall plate triggers.
   */
  private preview = (join: Join) => {
    const film = this.film;
    if (!film || !this.booted) {
      return;
    }
    if ((join === 'blend' || join === 'melt') && film.dissolve(join)) {
      this.freeze = '';
      return;
    }
    if (join !== 'flash' && join !== 'sweep' && join !== 'whip') {
      const shot = film.snapshot();
      this.freeze = shot.length > 64 ? shot : '';
      if (!this.freeze && join !== 'dip') {
        return;
      }
    }
    switch (join) {
      case 'defocus':
        this.play('defocus');
        this.liveEl?.animate(
          [{ filter: 'blur(9px)' }, { filter: 'blur(0px)' }],
          { duration: 700, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
        );
        break;
      case 'dip':
        this.dipColor = '#0d0905';
        this.play('dip');
        break;
      case 'iris': {
        const v = film.view();
        const b = this.beat;
        const pt = b.to ? film.project(...b.to) : undefined;
        const cx = pt ? Math.max(12, Math.min(88, (pt.x / v.w) * 100)) : 50;
        const cy = pt ? Math.max(12, Math.min(88, (pt.y / v.h) * 100)) : 46;
        this.irisAt = `--ix:${cx.toFixed(1)}%;--iy:${cy.toFixed(1)}%`;
        this.play('iris');
        break;
      }
      case 'sweep':
        this.lightSweep(film, this.beat);
        break;
      case 'whip':
        this.whipUntil = performance.now() + 360;
        break;
      case 'cut':
        break;
      default:
        this.play(join);
    }
  };

  /** the wrapper the live picture sits in, for rack-defocus */
  private liveEl?: HTMLElement;

  private liveWrap = modifier((el: HTMLElement) => {
    this.liveEl = el;
    return () => {
      if (this.liveEl === el) {
        this.liveEl = undefined;
      }
    };
  });

  /**
   * THE LIGHT SWEEP: the sun itself flares across the seam — swings
   * high and past, then settles back onto whatever light the beat
   * actually asked for. Fire-and-forget; the restore hands the key
   * back to the beat's own sun (or the hour's).
   */
  private lightSweep(film: Picture, beat: Beat) {
    const t0 = performance.now();
    const dur = 950;
    const base = beat.sun
      ? { az: beat.sun.az * RAD, el: beat.sun.el * RAD }
      : null;
    const step = () => {
      const f = (performance.now() - t0) / dur;
      if (f >= 1 || !this.film) {
        film.light(base);
        return;
      }
      const swing = Math.sin(f * Math.PI);
      film.light({
        az: (base?.az ?? 0.4) + (1 - f) * 2.2 - 1.1,
        el: (base?.el ?? 0.4) + swing * 0.3,
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** the scene brought its own score — six of them, one per tower */
  /** the line for this beat, at the level the session was mixed to */
  private speak(beat: Beat) {
    this.film?.voice(this.voSrc(beat), this.voGain[beat.id] ?? 1);
    this.primeNext(beat);
  }

  private hush() {
    this.film?.voiceStop();
  }

  private hear = () => {
    this.sound = !this.sound;
    this.film?.sound(this.sound);
    /* turning sound on mid-beat should speak the line you are LOOKING at,
       not wait for the next one — otherwise the first thing anybody hears
       is a chapter they have already read */
    if (this.sound) {
      this.speak(this.beat);
    } else {
      this.hush();
    }
  };

  /**
   * FROM THE TOP means the front door, not the first beat.
   *
   * A film restarted straight into its opening shot skips the one piece
   * of the picture that says what it is — and the poster is a
   * composition in its own right, with the building turning in the last
   * of the light. So this clears everything the run has done and puts
   * the door back up, with the lens seated where it opens.
   */
  private restart = () => {
    const film = this.film;
    this.unhold();
    this.freeze = '';
    this.film?.voiceStop(120);
    this.playing = false;
    this.ended = false;
    this.menu = false;
    this.from = 0;
    this.beatIndex = 0;
    this.markSeated = false;
    this.skyOn = 0;
    this.dimNow = 0;
    this.sent = undefined;
    this.t = 0;
    this.jumped = false;
    this.seamAt = -1;
    this.airedFor = -1;
    this.scoreRun = null;
    this.plateRun = null;
    this.clipNow = null;
    this.clipKey = '';
    this.clipState = 'absent';
    this.clipFreeze = '';
    if (film) {
      film.modelFade(1);
      film.rain(null);
      film.rim(null);
      film.fade('mark', 0);
      film.fade('chapter', 0);
      for (let i = 0; i < 4; i++) {
        film.clearTrace(`t${i}`);
      }
      film.duck(1);
      /* the end card idled the page (nothing under it changes); the door
         needs it drawing again, or the poster is the ending's last frame */
      film.idle(false);
      this.idled = false;
      film.time(this.args.standing);
      this.args.seat?.(film);
      this.dressPoster(film);
      this.snap(this.all[0]!.cam);
    }
    /* the run only exists while the film is booted; taking that away
       ends it, and the door decides when the next one starts */
    this.booted = false;
    this.rolling = false;
    this.gate = true;
    this.posterAt = 0;
    this.posterRaf ??= requestAnimationFrame(this.poster);
  };

  /** a choice made at the door before the scene finished loading */
  private wanted?: boolean;

  /** through the gate — on the click the audio policy was waiting for */
  private begin = (withSound: boolean) => {
    if (this.booted) {
      /* a gate over a film already running is a stale door, not a
         request to boot twice — step aside and honour the sound choice */
      this.gate = false;
      if (withSound !== this.sound) {
        this.hear();
      }
      return;
    }
    if (!this.film) {
      /* the scene is still arriving: keep the choice, not the click */
      this.wanted = withSound;
      return;
    }
    this.gate = false;
    if (this.posterRaf !== undefined) {
      cancelAnimationFrame(this.posterRaf);
      this.posterRaf = undefined;
    }
    /* the door's choice is the page's state too — a muted begin that
       leaves the page's own switch on plays every hit and bed under a
       viewer who asked for silence */
    this.sound = withSound;
    this.film.sound(withSound);
    if (this.exact) {
      /* the clock opens at the linked beat's head; the door's flight is
         the chaser's and an exact film cuts in instead */
      const head = this.from;
      this.from = 0;
      this.t = this.beatStart(head);
      this.beatIndex = head;
      this.jumped = false;
      this.seamAt = -1;
      this.airedFor = -1;
    }
    const first = this.exact ? this.all[this.beatIndex]! : this.beats[0]!;
    this.settleAir(this.exact ? this.beatIndex : this.from);
    this.applyBeat(first, true);
    /* ...and the sky comes with it, NOT instantly: the evening of the
       poster crossfades into the film's own morning across the launch */
    this.applyAir(first, false);
    /**
     * THE CLICK IS ANSWERED IN THE SAME FRAME — and answered with the
     * biggest move in the film. The lens does not cut to the opening
     * shot; it FLIES there from wherever the poster's circuit had
     * reached, on the stiff spring, so the first thing the viewer sees
     * after pressing the button is the camera taking off. A door that
     * opens onto a still frame reads as a page that did not hear you.
     */
    if (this.posterPose && !this.exact) {
      this.now = { ...this.posterPose };
      this.mid = { ...this.posterPose };
      this.goal = { ...this.beats[0]!.cam };
      this.whipUntil = performance.now() + 1200;
      for (const k of [
        'dolly',
        'fx',
        'fz',
        'lookY',
        'ox',
        'pitch',
        'yaw',
      ] as const) {
        this.midV[k] = 0;
        this.nowV[k] = 0;
      }
    } else {
      this.snap(first.cam, this.tailFor(0), first.ticks * TICK);
    }
    /* THE DOOR STARTS THE SCORE. `playing` gates the Sequence, and a
       restart leaves it false so the run ends with the door going up —
       so the door has to turn it back on, or the second viewing stands
       at its first pose forever with a play button that cannot help. */
    this.playing = true;
    this.paused = false;
    this.booted = true;
    this.wake();
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    /**
     * ONE MORE PASS, on purpose. A region's first render collects no
     * score — `firstRender` compiles an empty tree — so the run only
     * exists after a SECOND pass, and that pass has to be paid for by a
     * tracked write somewhere. Every cut so far happened to buy one
     * within a second (a cue firing, a cycle stepping); a cut whose head
     * beat writes nothing — one quiet beat, deep-linked — never did, and
     * the film stood at its first pose forever. Bumping the lap edits
     * the sequence's name, which is a real edit the region must collect.
     */
    window.setTimeout(() => {
      this.lap += 1;
      this.primedLap = this.lap;
      this.rolling = true;
    }, 0);
  };

  private beginSound = () => this.begin(true);
  private beginMute = () => this.begin(false);

  /** the whole film's running time, said the way a poster says it */
  get runtime(): string {
    const s = this.all.reduce((n, b) => n + b.ticks, 0) * TICK;
    return `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  }

  /**
   * BACK IN FROM THE END CARD — a dissolve, not a flight.
   *
   * The film ends three hundred degrees around the building from where
   * it opened, so tweening the lens home spins it like a globe. The
   * ending cross-fades into the opening frame instead: the last frame
   * is held as a still, the camera is PLACED at the opening pose behind
   * it, and the still fades away.
   */
  /**
   * BACK IN FROM THE END CARD — a hard reset, not a journey.
   *
   * The film ends three hundred degrees around the building, with the
   * tower dissolved, the sky at golden hour, the rain gone and a chapter
   * numeral on screen. Tweening any of that back to the opening is a
   * confusing ten seconds in which nothing is either the ending or the
   * beginning. So the ending is CLEARED: every overlay, the model, the
   * weather, the world type, the traces and the lens all go back to
   * their opening state in one frame, and the film starts.
   */
  /** the end card's WATCH AGAIN is the front door, not the first beat: the
   *  choice of sound is made there, every time */
  private replay = () => {
    this.restart();
  };

  /** the chapter menu. The film keeps running behind it, blurred: a
   * menu that freezes the picture makes the picture feel like a file, and
   * this one is meant to feel like a broadcast you are stepping around in */
  @tracked private menu = false;

  private toc = () => {
    this.menu = !this.menu;
  };

  /** every chapter, with the beat it starts at and whether we are in it */
  get contents() {
    const here = this.absoluteIndex;
    return this.chapterHeads.map((head, i) => {
      const nextHead = this.chapterHeads[i + 1] ?? this.all.length;
      const ch = this.chapters[this.all[head]!.ch] ?? this.chapters[0]!;
      return {
        head,
        here: here >= head && here < nextHead,
        n: ch.n,
        shots: nextHead - head,
        title: ch.title,
        /* the chapter's own running time, from the beats it owns */
        secs:
          this.all.slice(head, nextHead).reduce((t, b) => t + b.ticks, 0) *
          TICK,
      };
    });
  }

  private pick = (head: number) => {
    this.menu = false;
    this.cutTo(head);
  };

  <template>
    <div
      class='cf-page is-{{@name}}
        {{if this.embed "is-embed"}}
        {{if this.idle "is-idle"}}'
    >
      <div
        class='cf-stage is-grade-{{this.grade}} {{if this.subsOn "has-subs"}}'
        {{this.mount}}
        {{on 'click' this.tap}}
        {{on 'dblclick' this.tapTwice}}
      >
        {{! the live picture's own wrapper, so a rack-defocus can blur the
        scene without touching the grade riding the iframe itself }}
        <div class='cf-live' {{this.liveWrap}}>
          <iframe
            class='cf-frame'
            src={{this.src}}
            title={{@title}}
            loading='eager'
          ></iframe>
        </div>

        {{! A scrim, not a box: each setting gets a soft directional lift
        under it, which reads as light falling off and not as a panel }}
        <div
          class='cf-scrim cf-scrim-{{this.beat.mode}}
            {{if this.beat.bare "is-bare"}}'
          aria-hidden='true'
        ></div>

        {{! THE TRANSITIONS: the outgoing frame, held, and whatever the
        seam does to it }}
        <div class='cf-joins' {{this.joinsWrap}}>
          <Joins
            @kind={{this.joinKind}}
            @stamp={{this.joinStamp}}
            @freeze={{this.freeze}}
            @irisAt={{this.irisAt}}
            @dipColor={{this.dipColor}}
            @seekable={{this.exact}}
          />
        </div>

        {{! THE CLOUD, driven per frame from --cf-cloud }}
        <div class='cf-cloud' aria-hidden='true'></div>

        {{! THE DIM: a wash that comes in WITH an annotation and lifts with
        it — dimming the plate is what a lecturer does when the slide goes
        up }}
        <div class='cf-dim' aria-hidden='true' {{this.dimEl}}></div>

        {{! the leader, the tether and the ring — what must connect DOM to
        world }}
        <Track @wire={{this.trackEls}} />

        {{#if this.booted}}
          <Plate
            @beat={{this.beat}}
            @chapterN={{this.chapter.n}}
            @rolling={{this.rolling}}
            @typeAt={{this.typeAt}}
            @sayAt={{this.sayAt}}
            @glyphFit={{this.glyphFit}}
            @glyphTone={{this.glyphTone}}
            @mount={{this.plate}}
            @grab={{this.grabPlate}}
          />

          <Stamp @step={{this.cycleStep}} @word={{this.stamp}} />

          {{#if this.clipKey}}
            <Clip
              @key={{this.clipKey}}
              @spec={{this.clipSpec}}
              @src={{this.clipSrc}}
              @freeze={{this.clipFreeze}}
              @state={{this.clipState}}
              @mount={{this.clipEl}}
            />
          {{/if}}

          {{#if (if this.rolling this.hasPhoto false)}}
            <Insert
              @beat={{this.beat}}
              @src={{this.photoSrc}}
              @missing={{this.missing}}
            />
          {{/if}}

          {{#if this.subs}}
            <Captions @line={{this.beat.vo}} />
          {{/if}}

          {{#if this.fault}}
            <p class='cf-fault'>⚠ {{this.fault}}</p>
          {{/if}}

          {{#if this.railOn}}
            <Rail
              @chapter={{this.chapter}}
              @marks={{this.transport}}
              @labels={{this.railLabels}}
              @readout={{this.railReadout}}
              @pick={{this.pick}}
            />
          {{/if}}
        {{/if}}

        {{! THE SCORE. One camera step for the whole film, and one clipped
        cue per beat — so the shot list and the script are the same object,
        and the film is a pure function of one clock. It waits for the
        scene: a rig on screen since the first pass was never inserted
        into anything, and the camera step would resolve to no subject. }}
        {{#if this.booted}}
          <Choreo
            @onCamera3D={{this.shot}}
            @onPerform={{this.dispatch}}
            @camera3dFrom={{this.openPose}}
            as |c|
          >
            <i
              class='cf-rig'
              {{motion id='rig'}}
              {{this.grabScore c}}
              aria-hidden='true'
            ></i>
            {{#if this.scoreOn}}
              <c.Sequence @name={{this.filmName}}>
                <c.Camera3D
                  @name='film'
                  @through={{this.path}}
                  @duration={{this.filmSeconds}}
                  @ease='linear'
                  @tension={{0.34}}
                />
                {{! an exact film derives its beats from the clock; a cut
                film is told them }}
                {{#unless this.exact}}
                  {{#each this.cues as |cue|}}
                    <c.Perform
                      @at={{at 'film'}}
                      @delay={{cue.delay}}
                      @action={{cue.action}}
                      @target={{cue.index}}
                    />
                  {{/each}}
                  <c.Perform @action='lap' />
                {{/unless}}
              </c.Sequence>
            {{/if}}
          </Choreo>
        {{/if}}

        {{#if this.gate}}
          <Gate @film={{this.handle}} as |f|>
            {{yield f to='gate'}}
          </Gate>
        {{/if}}

        {{#if this.ended}}
          <EndCard @film={{this.handle}} as |f|>
            {{yield f to='end'}}
          </EndCard>
        {{/if}}
      </div>

      {{#if this.menu}}
        <Menu
          @title={{@menuTitle}}
          @sub={{if @menuSub @menuSub 'chapters'}}
          @contents={{this.contents}}
          @pick={{this.pick}}
        />
      {{/if}}

      {{! the confirmation glyph: a play or a pause, once, in the middle
      of the picture, gone in half a second }}
      {{#if this.burst}}
        <Burst @kind={{this.burst}} @done={{this.burstDone}} />
      {{/if}}

      <Player
        @idle={{this.idle}}
        @away={{this.gate}}
        @live={{this.live}}
        @sound={{this.sound}}
        @loud={{this.loud}}
        @vol={{this.vol}}
        @volStyle={{this.volStyle}}
        @fade={{this.fade}}
        @full={{this.full}}
        @clock={{this.clock}}
        @duration={{this.duration}}
        @chapter={{this.chapter}}
        @subsOn={{this.subsOn}}
        @menu={{this.menu}}
        @debug={{this.debug}}
        @build={{this.build}}
        @playbar={{this.playbar}}
        @scrubAt={{this.scrubAt}}
        @tip={{this.tip}}
        @slider={{this.slider}}
        @trackWrap={{this.trackWrap}}
        @scrubDown={{this.scrubDown}}
        @scrubMove={{this.scrubMove}}
        @scrubUp={{this.scrubUp}}
        @scrubLeave={{this.scrubLeave}}
        @toggle={{this.toggle}}
        @prev={{this.prev}}
        @next={{this.next}}
        @hear={{this.hear}}
        @cc={{this.cc}}
        @toc={{this.toc}}
        @restart={{this.restart}}
        @screen={{this.screen}}
      />

      {{! under the stage: whatever the film puts beneath its own picture }}
      {{yield this.handle}}
    </div>

    <style>
      /* THE FLAG, as an accent system. Two colours and nothing else:
         the red of the hinomaru for the one thing that is happening NOW
         — the playhead, the current chapter, the seal, the point a line
         is drawn to — and a full white for type that has to win over a
         picture. Everything else stays in the scene's own inks, so the
         red never becomes decoration; it only ever means "here". */
      .cf-page {
        --cf-red: #bc002d;
        --cf-white: #fffdf8;
      }

      .cf-page {
        /* the film's ink, replaced per chapter from the scene's own
           time-of-day palette by wear — these are the morning values,
           which is also what the page opens on. --cf-shx/y is the cast
           shadow's offset, written every frame from where the scene's key
           light actually is (see follow). */
        --cf-paper: #ecdcbc;
        --cf-paper-a: rgba(236, 220, 188, 0.94);
        --cf-paper-b: rgba(236, 220, 188, 0.76);
        --cf-paper-c: rgba(236, 220, 188, 0);
        --cf-ink: #2e2515;
        --cf-ink2: #8b7c5c;
        --cf-ink3: #3f3520;
        --cf-accent: #a8621f;
        /* THE ANNOTATION RED, and it is a different colour from the
           editorial accent on purpose. The accent is ink — it belongs to
           the page and takes the page's palette. This is a marker: it is
           not in the scene, it never was, and it should look like
           somebody drew on the photograph. Muted burnt orange over ochre
           moss reads as part of the picture, which is exactly what an
           annotation must not do. */
        --cf-mark: #ff2412;
        --cf-rule: #c2b18c;
        /* The sun, in two numbers: cf-rake is the angle its light makes
           across the frame, cf-shx/cf-shy the direction away from it.
           They dress the things that are PHYSICALLY on the frame — the
           photograph's own plate, the rake of a rule — and deliberately
           not the type. An offset shadow behind a headline is a sticker
           effect: it claims the letters are objects lying on the picture,
           which they are not, and getting the angle right does not rescue
           it. Type here earns its contrast from the scrim. */
        /* TYPE. The display face is a serif on purpose. This film is set
           beside mincho kanji and stands in front of a building, and a
           wide-tracked geometric sans fights both — it is also the first
           thing every deck reaches for, which is reason enough to leave
           it alone. A warm old-style serif sits with the kanji instead of
           arguing with it. The sans is kept for small mechanical labels
           only, and its tracking is pulled well back from the point where
           letterspaced caps start reading as a logo. */
        /* THE INFORMATION LAYER IS SET IN THE BASILICA'S OWN VOICE.
           The 2026 centenary identity is heavy grotesque capitals in flat
           colour on stone paper — the programme, the plates, the timeline
           of momentums are all cut that way, and a film about the same
           building in the same year has no business inventing a second
           typography for the same facts. Archivo is the closest open face
           to it: a grotesque with real weight at 800 and none of the
           geometric-sans blandness. The old-style serif stays for the
           quote and the caption band, where a sentence is being spoken
           rather than displayed. */
        --cf-display: Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif;
        --cf-caps: Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif;
        --cf-serif:
          'Cormorant Garamond', 'Iowan Old Style', 'Palatino Linotype',
          Palatino, Georgia, serif;
        --cf-ui: Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif;
        /* the identity's four colours, and the chapter's own (set by wear) */
        --cf-c-red: #d8232a;
        --cf-c-blue: #1268c3;
        --cf-c-green: #0f7b62;
        --cf-c-pink: #e5308a;
        --cf-chap: #d8232a;
        --cf-shx: 2px;
        --cf-shy: 2px;
        --cf-rake: 35deg;

        position: relative;
        min-height: 100svh;
        background: var(--cf-paper);
        display: flex;
        flex-direction: column;
        transition: background 900ms ease;
      }

      .cf-stage {
        position: relative;
        height: 100svh;
        flex: none;
        overflow: hidden;
      }

      .cf-live {
        position: absolute;
        inset: 0;
      }

      /* THE SCENE DOES NOT TAKE THE POINTER. It is a picture: it has no
         controls of its own in film mode, and while it swallowed events
         the wheel went to the iframe's document instead of this page —
         so the film filled the viewport and the wall plate underneath
         could not be reached. */
      .cf-frame {
        pointer-events: none;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        /* the primary: contrast, saturation and lift, per grade */
      }

      /* ---- the grade ------------------------------------------------- *
         Two passes, the way a colourist works: a primary on the picture
         itself (above), then a split tone laid over it — warmth into the
         highlights on one diagonal, coolness into the shadows on the
         other. Soft-light rather than overlay, because overlay crushes this scene's
         mid-tones and the whole point is to keep the moss and the plaster
         legible while moving the mood underneath them.
         ---------------------------------------------------------------- */

      /* the five moods. CONTEXT opens warm and open; HISTORY is archival —
         desaturated, cool, contrastier, the look of a document rather than
         a day; CONSTRUCTION goes clean and bright, nearly a blueprint;
         DETAIL is rich and close; COMPARISON is a museum plate, flat and
         even, because a comparison that flatters one subject is not one. */
      .is-grade-amber {
        --cf-lut: saturate(0.9) contrast(0.94) brightness(1.2);
        --cf-warm: #ffd9a8;
        --cf-cool: #b9c8e6;
        --cf-grade-a: 0.3;
        --cf-vig-a: 0.5;
      }

      .is-grade-iron {
        --cf-lut: saturate(0.72) contrast(0.98) brightness(1.12) sepia(0.1);
        --cf-warm: #e8d9c2;
        --cf-cool: #9fb0c8;
        --cf-grade-a: 0.4;
        --cf-vig-a: 0.65;
      }

      /* MIDDAY, and it is meant to be the brightest thing in the film.
         The construction chapter is the one that has to read as
         information — you are watching a building get assembled — so it
         is pushed up and opened out until it is nearly a working
         drawing, and it earns its brightness by sitting between two
         chapters that are deliberately heavier. Contrast between
         chapters is a bigger effect than contrast inside one. */
      .is-grade-chalk {
        --cf-lut: saturate(0.88) contrast(0.96) brightness(1.34);
        --cf-warm: #fffdf6;
        --cf-cool: #cfdde8;
        --cf-grade-a: 0.2;
        --cf-vig-a: 0.22;
      }

      .is-grade-ink {
        --cf-lut: saturate(0.98) contrast(1) brightness(1.16);
        --cf-warm: #ffc9a1;
        --cf-cool: #8fa0c9;
        --cf-grade-a: 0.32;
        --cf-vig-a: 0.68;
      }

      /* THE NIGHT: the one grade that pulls the picture DOWN. Every other
         grade lifts, which is right for daylight; a lifted night is dusk. */
      .is-grade-night {
        --cf-lut: saturate(0.76) contrast(1.14) brightness(0.76);
        --cf-warm: #c9c2b4;
        --cf-cool: #8193b8;
        --cf-grade-a: 0.5;
        --cf-vig-a: 0;
      }

      /* WET. Rain is not simply the clear grade with drops in it: the
         light comes from a lid rather than a source, so the picture
         loses its warmth and most of its contrast, and the corners
         close in. */
      .is-grade-wet {
        --cf-lut: saturate(0.72) contrast(0.92) brightness(0.94)
          hue-rotate(-4deg);
        --cf-warm: #cfd6dd;
        --cf-cool: #7d8b9e;
        --cf-grade-a: 0.44;
        --cf-vig-a: 0.8;
      }

      .is-grade-plate {
        --cf-lut: saturate(0.86) contrast(0.95) brightness(1.2);
        --cf-warm: #f6e8d2;
        --cf-cool: #c3c8bd;
        --cf-grade-a: 0.18;
        --cf-vig-a: 0.36;
      }

      /* SIX COUNTRIES, SIX LIGHTS. The comparison holds the framing and
         the lens still so the BUILDING is the variable — but six towers
         under one identical sky read as six models on one lawn, which
         is a diorama, not a comparison. Each gets the tone its own
         country is remembered in, at a strength you feel and cannot
         quite name: the plate grade, bent a few degrees. */
      .is-grade-c-jp {
        --cf-lut: saturate(0.84) contrast(0.95) brightness(1.22);
        --cf-warm: #f6e8d2;
        --cf-cool: #bcc6bb;
        --cf-grade-a: 0.2;
        --cf-vig-a: 0.36;
      }

      .is-grade-c-cn {
        --cf-lut: saturate(0.95) contrast(0.97) brightness(1.16) sepia(0.06);
        --cf-warm: #ffd9a0;
        --cf-cool: #c0a68e;
        --cf-grade-a: 0.28;
        --cf-vig-a: 0.44;
      }

      .is-grade-c-vn {
        --cf-lut: saturate(0.92) contrast(0.94) brightness(1.18)
          hue-rotate(-6deg);
        --cf-warm: #eef0cd;
        --cf-cool: #a7bda8;
        --cf-grade-a: 0.26;
        --cf-vig-a: 0.4;
      }

      .is-grade-c-th {
        --cf-lut: saturate(1.02) contrast(0.93) brightness(1.3);
        --cf-warm: #ffe9ad;
        --cf-cool: #d3c6a0;
        --cf-grade-a: 0.24;
        --cf-vig-a: 0.3;
      }

      .is-grade-c-kh {
        --cf-lut: saturate(0.9) contrast(0.99) brightness(1.14) sepia(0.12);
        --cf-warm: #f2cfa4;
        --cf-cool: #b9a184;
        --cf-grade-a: 0.3;
        --cf-vig-a: 0.5;
      }

      .is-grade-c-tr {
        --cf-lut: saturate(0.8) contrast(0.96) brightness(1.26);
        --cf-warm: #fdf3e2;
        --cf-cool: #a9bacd;
        --cf-grade-a: 0.22;
        --cf-vig-a: 0.34;
      }

      /* the outgoing frame, swept off along the sun's diagonal behind a
         FEATHERED edge — a mask, not a clip, because a wipe with a hard
         edge is a screen transition and a wipe with a soft one is film */
      /* THE SWEEP IS TWO TRANSFORMS, NOT A MASK MOVING. Sliding
         mask-position repaints a full-resolution still every frame and
         the wipe stutters — which is what a wipe must never do. So the
         mask stays put on a sheet three frames wide, the SHEET slides
         across the picture, and the still inside slides back by the same
         amount so it never moves on screen. Both are transforms: the
         compositor rasterises the masked sheet once and only translates. */
      .cf-swipe {
        position: absolute;
        left: 0;
        top: 0;
        width: 300%;
        height: 300%;
        z-index: 0;
        pointer-events: none;
        will-change: transform, opacity;
        mask-image: linear-gradient(
          calc(var(--cf-rake, 35deg) + 72deg),
          #000 44%,
          transparent 56%
        );
        mask-size: 100% 100%;
        mask-repeat: no-repeat;
        -webkit-mask-image: linear-gradient(
          calc(var(--cf-rake, 35deg) + 72deg),
          #000 44%,
          transparent 56%
        );
        -webkit-mask-size: 100% 100%;
        -webkit-mask-repeat: no-repeat;
        /* Star Wars speed: a wipe is a STATEMENT, and at two-thirds of a
           second it reads as a glitch rather than a decision */
        animation: cf-swipe 1150ms cubic-bezier(0.42, 0, 0.28, 1) forwards;
      }

      .cf-swipe img {
        position: absolute;
        left: 0;
        top: 0;
        width: 33.3334%;
        height: 33.3334%;
        object-fit: cover;
        display: block;
        will-change: transform;
        animation: cf-swipe-hold 1150ms cubic-bezier(0.42, 0, 0.28, 1) forwards;
      }

      /* the sweep is the sheet; the last breath of opacity is a SEAL. A
         mask that ends up not covering what you assumed leaves the
         still on screen forever, and a wipe that fails should fail to
         nothing rather than to a photograph of the last shot. */
      @keyframes cf-swipe {
        0% {
          transform: translate3d(0, 0, 0);
          opacity: 1;
        }

        88% {
          opacity: 1;
        }

        100% {
          transform: translate3d(-66.6667%, -66.6667%, 0);
          opacity: 0;
        }
      }

      @keyframes cf-swipe-hold {
        0% {
          transform: translate3d(0, 0, 0);
        }

        100% {
          transform: translate3d(200%, 200%, 0);
        }
      }

      .cf-melt {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        animation: cf-melt 1900ms cubic-bezier(0.4, 0, 0.5, 1) forwards;
      }

      @keyframes cf-melt {
        0% {
          opacity: 1;
        }

        22% {
          opacity: 0.92;
        }

        100% {
          opacity: 0;
        }
      }

      .cf-blend {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        /* the still wears the same primary as the live frame under it,
           so the dissolve is between two graded pictures — and it is a
           PUSH dissolve: the old frame travels gently forward as it
           thins, so the transition has a direction, not just a mix */
        animation: cf-blend 520ms ease-out forwards;
      }

      @keyframes cf-blend {
        0% {
          opacity: 1;
          transform: scale(1);
        }

        100% {
          opacity: 0;
          transform: scale(1.055);
        }
      }

      /* the blur dissolve — and the freeze half of the rack-defocus */
      .cf-blurout {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        animation: cf-blurout 640ms ease-out forwards;
      }

      @keyframes cf-blurout {
        0% {
          opacity: 1;
          filter: blur(0);
        }

        100% {
          opacity: 0;
          filter: blur(13px);
        }
      }

      /* the optical dissolve: lighten blend, so highlights linger */
      .cf-luma {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        mix-blend-mode: lighten;
        animation: cf-blend 700ms ease-in forwards;
      }

      /* two breaths of white, no freeze — the gun-crack */
      .cf-flash {
        position: absolute;
        inset: 0;
        z-index: 4;
        pointer-events: none;
        background: #fff8ec;
        animation: cf-flash 300ms ease-out forwards;
      }

      @keyframes cf-flash {
        0%,
        22% {
          opacity: 0.92;
        }

        100% {
          opacity: 0;
        }
      }

      /* the old shot closes in a circle onto the new shot's subject */
      .cf-iris {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        clip-path: circle(150% at var(--ix, 50%) var(--iy, 50%));
        animation: cf-iris 680ms cubic-bezier(0.45, 0, 0.3, 1) forwards;
      }

      @keyframes cf-iris {
        0% {
          clip-path: circle(150% at var(--ix, 50%) var(--iy, 50%));
          opacity: 1;
        }

        92% {
          opacity: 1;
        }

        100% {
          clip-path: circle(0% at var(--ix, 50%) var(--iy, 50%));
          opacity: 0;
        }
      }

      .cf-dip {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
      }

      .cf-dip img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        animation: cf-dip-frame 760ms linear forwards;
      }

      /* the freeze holds until the veil has fully closed, then drops
         under cover — the incoming shot is never seen before the dip */
      @keyframes cf-dip-frame {
        0%,
        38% {
          opacity: 1;
        }

        42%,
        100% {
          opacity: 0;
        }
      }

      .cf-dip i {
        position: absolute;
        inset: 0;
        opacity: 0;
        animation: cf-dip-veil 760ms ease-in-out forwards;
      }

      @keyframes cf-dip-veil {
        0% {
          opacity: 0;
        }

        32%,
        48% {
          opacity: 1;
        }

        100% {
          opacity: 0;
        }
      }

      /* the seams' own layer: no stacking context of its own, so a flash
         still rides above the scrim and a still stays under it */
      .cf-joins {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      /* ---- the lens ------------------------------------------------- */
      /* THE CLOUD IS A CAST SHADOW, not a filter over the lens. A band
         swept across the whole frame reads as somebody dimming the
         picture; what a cloud actually does is drop a soft, uneven
         shape onto the land and the building, keep its edges out of
         focus, and move. Two overlapping blobs on a wide plate,
         multiplied over the scene and travelling with the sun's rake. */
      .cf-cloud {
        position: absolute;
        /* -35%/-45% was a plate 1.7x the viewport each way, blurred at 26px
           on every frame the sun moved. The gradients are soft already; the
           blur added nothing you could see and a full-screen filter you could
           feel. Smaller, unblurred, and hidden outright when there is no
           cloud — an opacity of zero still costs a composited layer. */
        inset: -12% -16%;
        z-index: 1;
        pointer-events: none;
        /* IT WAS BLUE, AND BARCELONA IS NOT. A cloud passing over a warm
           stone site takes the warmth out of the light; it does not tip the
           whole frame to slate. These are a warm grey now, and at half the
           strength — a shadow crossing the picture rather than a filter
           laid over it. */
        opacity: calc(var(--cf-cloud, 0) * 0.32);
        background:
          radial-gradient(
            62% 40% at 32% 44%,
            rgba(112, 100, 80, 0.4) 0%,
            rgba(120, 108, 88, 0.24) 46%,
            rgba(128, 118, 100, 0) 84%
          ),
          radial-gradient(
            48% 32% at 68% 58%,
            rgba(106, 96, 78, 0.3) 0%,
            rgba(122, 110, 90, 0.16) 52%,
            rgba(128, 118, 100, 0) 90%
          );
        mix-blend-mode: multiply;
        transform: rotate(calc(var(--cf-rake, 35deg) * 0.4))
          translate3d(
            calc(var(--cf-cloud, 0) * -16%),
            calc(var(--cf-cloud, 0) * 7%),
            0
          );
      }

      .is-cloudless .cf-cloud {
        visibility: hidden;
      }

      /* ---- scrims: anchored to the caption, never banded across the
         frame. A band wide enough to carry a lower third also washes out
         whatever is standing in the middle of the shot — which on this
         route is the building. ------------------------------------------ */
      .cf-scrim {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        transition: background 700ms ease;
      }

      /* a bare beat: no scrim at all — under a walk through the hours the
         scrim's paper colour snaps with each theme, and a dish of colour
         snapping behind the type is worse than no dish */
      .cf-scrim.is-bare {
        display: none;
      }

      .cf-scrim-lower {
        background: radial-gradient(
          128% 82% at 0% 112%,
          var(--cf-paper-a) 0%,
          var(--cf-paper-b) 36%,
          var(--cf-paper-c) 72%
        );
      }

      .cf-scrim-title {
        background: radial-gradient(
          112% 108% at 112% 116%,
          var(--cf-paper-a) 0%,
          var(--cf-paper-b) 34%,
          var(--cf-paper-c) 70%
        );
      }

      .cf-scrim-plate {
        background: radial-gradient(
          84% 104% at 110% 50%,
          var(--cf-paper-a) 0%,
          var(--cf-paper-b) 34%,
          var(--cf-paper-c) 72%
        );
      }

      .cf-scrim-point {
        background: radial-gradient(
          88% 92% at -10% 26%,
          var(--cf-paper-a) 0%,
          var(--cf-paper-b) 38%,
          var(--cf-paper-c) 74%
        );
      }

      .cf-dim {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        opacity: 0;
        background: radial-gradient(
          76% 66% at 50% 48%,
          rgba(24, 18, 8, 0.16) 0%,
          rgba(24, 18, 8, 0.34) 100%
        );
      }

      /* ---- traces and callouts -------------------------------------- */
      .cf-track {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2;
      }

      /* the marker glows, and the glow is doing real work: a thin line
         over moss competes with the moss at exactly its own frequency,
         and a soft bloom gives the eye a low-frequency edge to catch
         first. (The traces on the building carry their own glow shell in
         the scene now; this dresses only what is still on the glass.) */
      /* THE GLOW COSTS A FRAME IN SAFARI. These two elements move every
         frame — the leader is re-pointed at the building on each one — and
         a stacked pair of drop-shadow filters is re-rasterised each time,
         which WebKit charges far more for than Blink does. One tight
         shadow gives the eye the same low-frequency edge to catch; the
         wide one was doing very little over a dimmed plate anyway. */
      .cf-leader,
      .cf-track circle {
        filter: drop-shadow(0 0 3px rgba(255, 36, 18, 0.9));
      }

      .cf-tether {
        stroke: var(--cf-accent);
        stroke-width: 1.4;
        stroke-dasharray: 3 5;
        opacity: 0;
        transition: opacity 500ms ease;
      }

      .cf-leader {
        stroke: var(--cf-mark);
        stroke-width: 1.8;
        stroke-dasharray: 5 4;
        stroke-linecap: round;
        opacity: 0;
      }

      .cf-track circle {
        fill: none;
        stroke: var(--cf-mark);
        stroke-width: 2.6;
        stroke-linecap: round;
        opacity: 0;
      }

      /* ================================================================
         RESPONSIVE. The film had not one media query in it: every size was
         a viewport fraction, which keeps type in proportion but does not
         change a LAYOUT. Two columns of an editorial plate do not become
         a phone layout by getting smaller — they have to become one
         column, the ghost numeral has to go, and the settings have to
         stop being a corner of the frame and become its foot.
         ================================================================ */

      /* a laptop, or a window shared with something else */
      @media (max-width: 1180px) {
        .cf-block {
          max-width: min(38ch, 56vw);
        }

        .cf-block.is-plate {
          max-width: min(46ch, 52vw);
        }

        .is-plate .cf-kanji.is-latin {
          --cf-fit: 28vw;
          max-width: 30vw;
        }

        .cf-say {
          max-width: min(28ch, 42vw);
        }
      }

      /* a tablet, or a phone held the long way */
      @media (max-width: 860px) {
        /* the plate stops being two columns: the word goes over the cues,
           and the rule that separated them becomes the rule under it */
        .cf-block.is-plate {
          top: auto;
          bottom: 12%;
          right: 5.5%;
          left: 5.5%;
          display: block;
          transform: none;
          max-width: none;
        }

        .is-plate .cf-plane.is-glyph {
          border-right: 0;
          border-bottom: 2px solid var(--cf-chap);
          padding-right: 0;
          padding-bottom: 8px;
          margin-bottom: 14px;
        }

        /* stacked under the word, the cues read from the left again */
        .is-plate .cf-plane:not(.is-glyph) {
          align-items: flex-start;
          text-align: left;
        }

        .is-plate .cf-read {
          justify-content: flex-start;
        }

        .is-plate .cf-kanji.is-latin {
          --cf-fit: 84vw;
          max-width: none;
        }

        .cf-block.is-title,
        .cf-block.is-lower,
        .cf-block.is-point {
          left: 5.5%;
          right: 5.5%;
          top: auto;
          bottom: 13%;
          max-width: none;
          text-align: left;
        }

        .is-title .cf-read {
          justify-content: flex-start;
        }

        .is-title .cf-kicker {
          flex-direction: row;
        }

        .cf-kanji.is-latin,
        .is-title .cf-kanji.is-latin,
        .is-point .cf-kanji.is-latin {
          --cf-fit: 84vw;
        }

        .cf-say {
          max-width: min(32ch, 84vw);
        }

        /* a numeral three-quarters of the screen wide behind two columns
           of type is a texture; behind one column it is a mess */
        .cf-ghost,
        .cf-plate .cf-ghost {
          display: none;
        }

        .cf-photo figure {
          width: min(46vw, 260px);
        }

        /* a narrow frame: the rule drops under the title again */
        .cf-rail {
          flex-wrap: wrap;
        }

        .cf-years {
          flex-basis: 100%;
          width: clamp(200px, 56vw, 420px);
          margin-left: 0;
          margin-top: 8px;
        }

        .cf-subs {
          font-size: 15px;
          max-width: 88vw;
        }
      }

      /* a phone */
      @media (max-width: 560px) {
        .cf-kicker {
          font-size: 10px;
          letter-spacing: 0.09em;
        }

        .cf-say {
          font-size: 15px;
          margin-bottom: 8px;
        }

        .cf-read {
          margin-bottom: 12px;
        }

        .cf-kanji {
          margin-bottom: 12px;
        }

        .cf-gate-index,
        .cf-rail {
          display: none;
        }

        .cf-gate-in.cf-matter {
          margin-right: 0;
          padding-inline: 20px;
        }

        .cf-gate-vert {
          display: none;
        }

        .cf-mg-seal {
          position: static;
          margin: 14px auto 0;
        }

        .cf-photo {
          display: none;
        }

        .cf-subs {
          font-size: 14px;
          bottom: 10%;
        }
      }

      /* a short window: the film is 16:9 in a letterbox and the vertical
         rhythm, not the width, is what runs out */
      @media (max-height: 620px) {
        .cf-kanji.is-latin {
          font-size: min(
            clamp(30px, 8vh, 64px),
            calc(var(--cf-fit, 42vw) / (var(--cf-glyphs, 4) * 0.56))
          );
        }

        .cf-say {
          font-size: clamp(13px, 2.4vh, 18px);
          margin-bottom: 7px;
        }

        .cf-block.is-lower,
        .cf-block.is-title {
          bottom: 8%;
        }

        .has-subs .cf-block.is-lower,
        .has-subs .cf-block.is-title {
          bottom: 17%;
        }
      }

      /* someone who has asked for less movement gets the film without the
         drift, the sway and the entrances — and still gets the film */
      @media (prefers-reduced-motion: reduce) {
        .cf-mg-mark,
        .cf-mg-glyph,
        .cf-gate-ghost,
        .cf-mg-seal,
        .cf-kicker::after {
          animation-duration: 1ms !important;
        }
      }

      /* ---- the front layer ------------------------------------------ */
      /* THE WALL TEXT LEAVES BEFORE THE SEAM. Its own exit animation
         runs when the next beat replaces it, which means the outgoing
         setting is still on screen at the instant of the cut — so the
         edit lands on a frame with two things happening in it. Half a
         second of fade ahead of the change empties the corner first,
         and the cut is then only ever about the picture. */
      /* the ink follows the hour: the palette is swapped per theme by wear,
         and under a walk through the day the type must not snap from black
         to white — it turns with the light */
      .cf-type,
      .cf-type p,
      .cf-type span {
        transition: color 2400ms ease;
      }

      .cf-type {
        position: absolute;
        inset: 0;
        z-index: 3;
        opacity: var(--cf-type-a, 1);
        pointer-events: none;
        color: var(--cf-ink);
        font-family: var(--cf-display);
      }

      .cf-block {
        position: absolute;
        max-width: min(46vw, 660px);
      }

      /* a kicker rides a rule that draws itself out of the type — the
         diagonal is the sun's, so the graphic furniture rakes the same
         way the shadows do */
      /* the eyebrow never wraps: 'THE TALLEST CHURCH ON EARTH' at this
         tracking is wider than the block, and a wrapped kicker changes
         the height of a bottom-anchored plate */
      .cf-kicker > span {
        white-space: nowrap;
      }

      .cf-kicker {
        font-family: var(--cf-ui);
        font-size: clamp(11px, 0.9vw, 14px);
        font-weight: 700;
        letter-spacing: 0.11em;
        color: var(--cf-chap);
        margin: 0 0 14px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      /* the rule draws itself out of the kicker. It is a pseudo-element,
         so Motion cannot own it — but the whole block is rebuilt on every
         beat, which means a plain CSS animation runs from its first frame
         each time and needs no retriggering. */
      .cf-kicker::after {
        content: '';
        /* the rule takes the chapter's colour: on the centenary timeline
           the rule, the dot and the heading are one colour, and that is
           what makes it read as a system rather than as decoration */
        background: var(--cf-chap);
        /* the rule gives way to the words but never vanishes: a rule that
           collapses to nothing on a long kicker is furniture that blinks
           in and out with the string length */
        flex: 1 1 26px;
        min-width: 26px;
        height: 2px;
        transform-origin: left center;
        animation: cf-rule 760ms 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      .is-title .cf-kicker::after {
        transform-origin: right center;
      }

      @keyframes cf-rule {
        from {
          transform: scaleX(0);
        }

        to {
          transform: scaleX(1);
        }
      }

      .is-point .cf-kicker::after,
      .is-lower .cf-kicker::after {
        max-width: 120px;
      }

      .cf-kanji {
        font-family:
          'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif JP',
          'Songti SC', serif;
        font-size: clamp(56px, 8.4vw, 132px);
        line-height: 0.94;
        letter-spacing: 0.04em;
        margin: 0 0 18px;
      }

      .cf-read {
        margin: 0 0 20px;
        display: flex;
        gap: 6px 16px;
        align-items: baseline;
        flex-wrap: wrap;
      }

      /* a flex child cannot shrink past its own content without this */
      .cf-romaji,
      .cf-gloss {
        min-width: 0;
      }

      /* on a marked beat the reading is the largest thing in the block,
         because the term itself is out in the scene */
      .cf-block:not(:has(.is-glyph)) .cf-romaji {
        font-size: clamp(17px, 1.5vw, 24px);
        letter-spacing: 0.2em;
      }

      .cf-block:not(:has(.is-glyph)) .cf-gloss {
        font-size: clamp(15px, 1.2vw, 19px);
      }

      .cf-romaji {
        font-family: var(--cf-ui);
        font-size: clamp(11px, 0.94vw, 14px);
        font-weight: 700;
        letter-spacing: 0.11em;
        color: var(--cf-chap);
      }

      .cf-gloss {
        font-family: var(--cf-ui);
        font-size: clamp(12px, 0.98vw, 15px);
        font-weight: 400;
        letter-spacing: 0.01em;
        color: var(--cf-ink3);
      }

      /* the planes are the host's to move; the type on them is Motion's */
      .cf-plane {
        will-change: transform;
      }

      /* a phrase is a HEADLINE, not body copy: it is on screen for two
         seconds and read at a glance, so it is set at the size a glance
         needs and it never runs past two lines */
      .cf-say {
        margin: 0 0 12px;
        font-family: var(--cf-display);
        /* set in the identity's capitals, but a cue is still a caption:
           at 30px in heavy caps three of them fill a frame and the
           picture becomes the background to a poster */
        font-size: clamp(14px, 1.28vw, 22px);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.012em;
        line-height: 1.16;
        color: var(--cf-ink);
        /* a cue is a phrase: wide enough that most set on ONE line.
           26ch was a CJK measure and these run to 34 characters, so the
           measure comes from the longest of them — and the break is left
           to pretty, because balance moves the break around as the
           string changes, which is the flicker between a one-line and a
           two-line setting. */
        max-width: min(38ch, 34vw);
        text-wrap: pretty;
      }

      .cf-say:last-child {
        margin-bottom: 0;
      }

      /* tall scripts (Thai, Khmer) at kanji size collide with their
         neighbours; scale the whole set box and give the marks headroom */
      .cf-kanji.is-tall {
        zoom: 0.58;
        line-height: 1.5;
      }

      /* ---- lines that DO what they SAY ------------------------------ *
         Behavior animations on the inner span, addressed per line by the
         film (`.sx-<beat>-<n>`). They run the length of the beat, so
         whenever the delivery reveals a line it is already mid-behavior —
         never waiting, never done. Two gestures ship here: a plumb drop
         and a heavy settle. */
      .cf-sayx {
        display: inline-block;
      }

      @keyframes cf-plumb {
        0% {
          transform: translateY(-16px) scaleY(1.18);
        }

        100% {
          transform: translateY(0) scaleY(1);
        }
      }

      /* "Flaring at the foot" — the line itself flares, tracking wide
         from its left foot for the whole shot, the batter's own curve */
      /* (the old per-line behaviours are gone: one of them animated
         letter-spacing on an inline-block, which re-wrapped the line it
         was in halfway through a shot) */

      @keyframes cf-sink {
        0% {
          transform: translateY(-14px);
        }

        34% {
          transform: translateY(2px);
        }

        100% {
          transform: translateY(0);
        }
      }

      /* the four ways a beat is set. A title is ranged right against the
         frame's edge with the tower in the other half; a lower third sits
         bottom-left; a plate is a slab in the right third; a point is a
         caption with a leader running out of it. */
      .cf-block.is-title {
        right: 6%;
        bottom: 15%;
        text-align: right;
        max-width: min(48vw, 700px);
        /* poster size at the start, the house size once the lens has
           arrived: the same lean as every block, times the title's own
           scale, from the corner it hangs from */
        transform-origin: 100% 100%;
        transform: translate3d(
            calc(var(--cf-lx, 0) * -9px),
            calc(var(--cf-ly, 0) * -5px),
            0
          )
          scale(calc(1.42 - 0.42 * var(--cf-title-k, 1)));
      }

      /* the opening's hierarchy: the name, then its reading, then the
         cues a step back in the ink — a poster, not a paragraph */
      .is-title .cf-kanji {
        margin-bottom: 26px;
      }

      .is-title .cf-read {
        justify-content: flex-end;
        margin-bottom: 28px;
        gap: 18px;
      }

      .is-title .cf-romaji {
        font-size: clamp(15px, 1.3vw, 23px);
        letter-spacing: 0.3em;
      }

      .is-title .cf-gloss {
        font-size: clamp(15px, 1.25vw, 22px);
      }

      .is-title .cf-say {
        max-width: 30ch;
        margin-bottom: 6px;
        color: var(--cf-ink2);
        font-size: clamp(19px, 1.95vw, 34px);
      }

      .is-title .cf-kicker {
        flex-direction: row-reverse;
      }

      .is-title .cf-line {
        margin-left: auto;
      }

      .is-title .cf-kanji {
        font-size: clamp(72px, 11vw, 190px);
      }

      .cf-block.is-lower {
        left: 5.5%;
        bottom: 11%;
      }

      /* captions take the foot of the frame, so the settings that live
         down there move up out of their way rather than sit under them */
      .has-subs .cf-block.is-lower {
        bottom: 21%;
      }

      /* the plate steps out of the caption band's way — and stepping is
         what it should not do, so it moves over a beat, not a frame */
      .cf-block {
        transition: bottom 420ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .has-subs .cf-block.is-title {
        bottom: 24%;
      }

      /* the plate is centred on the frame, so a caption band eats its last
         cue rather than sitting under it */
      .has-subs .cf-block.is-plate {
        top: 44%;
      }

      /* THE PLATE, which is the one setting that is a designed object
         rather than a caption. Two columns: the term set VERTICALLY down
         the right edge, the way it would be on a museum label or a
         hanging scroll, and the reading and the phrases in a column
         beside it. A rule between them draws itself down as the plate
         lands. Ranged type in a corner was never wrong exactly — it was
         just nothing, and this chapter's beats are the ones that hold
         longest, so they are the ones that can least afford nothing. */
      .cf-block.is-plate {
        right: 5.5%;
        top: 50%;
        transform: translateY(-50%);
        display: grid;
        /* minmax(0,…) or the cue column cannot shrink and the word wins */
        grid-template-columns: minmax(0, auto) auto;
        justify-content: end;
        column-gap: clamp(16px, 1.8vw, 30px);
        align-items: start;
        /* the word takes a column of its own, so the block has to be wide
           enough for both it and a cue line that is not two words per row
           — and no wider: at two thirds of the frame the cue column began
           over the subject, and a plate is a label beside the thing */
        max-width: min(50vw, 760px);
      }

      .is-plate .cf-plane {
        grid-column: 1;
      }

      /* THE CUES RANGE AGAINST THE RULE. The block hugs the right edge and
         everything in it gathers toward the word, so the plate is one
         object at the side of the frame and the picture keeps its left. */
      .is-plate .cf-plane:not(.is-glyph) {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        text-align: right;
      }

      .is-plate .cf-plane:not(.is-glyph) .cf-kicker {
        align-self: stretch;
      }

      .is-plate .cf-read {
        justify-content: flex-end;
      }

      .is-plate .cf-plane.is-glyph {
        grid-column: 2;
        grid-row: 1 / -1;
        border-right: 2px solid var(--cf-accent);
        padding-right: clamp(14px, 1.5vw, 26px);
        transform-origin: top center;
        animation: cf-rule-down 820ms 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      /* the mask draws the rule DOWN; it must never clip sideways — the
         glyph plane leans with the pointer, and a mask flush with the box
         shaved the leaned strokes off the left edge as a hairline */
      @keyframes cf-rule-down {
        from {
          clip-path: inset(0 -40px 100% -40px);
        }

        to {
          clip-path: inset(0 -40px -4% -40px);
        }
      }

      .is-plate .cf-kanji {
        writing-mode: vertical-rl;
        margin: 0;
        /* the column never grows past the frame: whichever is smaller,
           the designed size or the height each glyph can have and still
           leave the set inside the picture */
        font-size: min(
          clamp(44px, 5.4vw, 88px),
          calc(62svh / var(--cf-glyphs, 3))
        );
        letter-spacing: 0.1em;
        line-height: 1;
      }

      .is-plate .cf-kicker {
        margin-bottom: 18px;
      }

      /* the ghost is only ever behind a plate — everywhere else the frame
         is already carrying the building */
      .cf-ghost {
        display: none;
      }

      /* THE PLANES LEAN. Each layer takes the pointer at its own depth —
         the ghost furthest, the big glyph next, the reading lines least
         — so the type stack has air in it rather than being one sheet
         of glass in front of a picture. */
      .cf-block {
        transform: translate3d(
          calc(var(--cf-lx, 0) * -9px),
          calc(var(--cf-ly, 0) * -5px),
          0
        );
      }

      .cf-plate .cf-ghost {
        transform: translateY(-50%)
          translate3d(
            calc(var(--cf-lx, 0) * -26px),
            calc(var(--cf-ly, 0) * -14px),
            0
          );
      }

      .cf-kanji {
        transform: translate3d(
          calc(var(--cf-lx, 0) * -15px),
          calc(var(--cf-ly, 0) * -8px),
          0
        );
      }

      /* the ghost NUMERAL keeps its old treatment: a filled slab of ink
         at a whisper of opacity, behind the plate. It is a page
         furniture mark, not type in the world — the hollow treatment
         belongs to the glyphs that share air with the building. */
      .cf-plate .cf-ghost {
        display: block;
        position: absolute;
        right: 3%;
        top: 50%;
        transform: translateY(-50%);
        font-family: var(--cf-ui);
        font-size: clamp(180px, 30vw, 460px);
        font-weight: 700;
        line-height: 0.8;
        letter-spacing: -0.04em;
        color: var(--cf-ink);
        opacity: calc(0.045 * var(--cf-ghost-a, 1));
        pointer-events: none;
        z-index: -1;
      }

      .cf-block.is-point {
        left: 5.5%;
        top: 18%;
        max-width: min(36vw, 520px);
      }

      .is-point .cf-kanji {
        font-size: clamp(48px, 6.6vw, 104px);
      }

      /* ---- clips ------------------------------------------------------ *
         a video, a still or a freeze over the picture: full frame under the
         scrim and the type, or an inset like the photograph */
      .cf-clip {
        position: absolute;
        pointer-events: none;
      }

      .cf-clip.is-cover {
        inset: 0;
        z-index: 1;
      }

      .cf-clip.is-cover figure {
        position: absolute;
        inset: 0;
        margin: 0;
      }

      .cf-clip.is-cover video,
      .cf-clip.is-cover img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cf-clip.is-cover figcaption {
        position: absolute;
        left: 5.5%;
        bottom: 6%;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-family: var(--cf-ui);
        color: #f7f0e0;
        text-shadow: 0 1px 12px rgba(0, 0, 0, 0.5);
      }

      .cf-clip.is-inset {
        z-index: 4;
      }

      .cf-clip.is-inset figure {
        position: absolute;
        right: 5.5%;
        top: 12%;
        margin: 0;
        width: min(30vw, 340px);
        background: var(--cf-paper);
        padding: 10px 10px 8px;
        border: 1px solid var(--cf-rule);
        box-shadow: calc(var(--cf-shx) * 4) calc(var(--cf-shy) * 4) 26px
          rgba(38, 28, 10, 0.26);
      }

      .cf-clip.is-inset video,
      .cf-clip.is-inset img {
        display: block;
        width: 100%;
        height: auto;
      }

      .cf-clip.is-inset figcaption {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-top: 8px;
        font-family: var(--cf-ui);
      }

      .cf-clip-cap {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
      }

      .cf-clip-cr {
        font-size: 10px;
        letter-spacing: 0.06em;
        opacity: 0.75;
      }

      /* ---- the photograph -------------------------------------------- */
      .cf-photo {
        position: absolute;
        z-index: 4;
        pointer-events: none;
      }

      .cf-photo figure.is-lower,
      .cf-photo figure.is-title,
      .cf-photo figure.is-point {
        position: absolute;
        right: 5.5%;
        top: 12%;
      }

      .cf-photo figure.is-plate {
        position: absolute;
        left: 5.5%;
        top: 12%;
      }

      .cf-photo figure {
        margin: 0;
        width: min(30vw, 340px);
        background: var(--cf-paper);
        padding: 10px 10px 8px;
        border: 1px solid var(--cf-rule);
        box-shadow: calc(var(--cf-shx) * 4) calc(var(--cf-shy) * 4) 26px
          rgba(38, 28, 10, 0.26);
      }

      .cf-photo img {
        display: block;
        width: 100%;
        height: auto;
        filter: saturate(0.86) contrast(1.04);
      }

      .cf-photo figcaption {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-top: 8px;
        font-family: var(--cf-ui);
      }

      .cf-photo-cap {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: var(--cf-ink);
      }

      .cf-photo-cr {
        font-size: 10px;
        letter-spacing: 0.06em;
        color: var(--cf-ink2);
      }

      .is-dark .cf-subs {
        color: #1a1408;
        background: rgba(238, 228, 204, 0.82);
      }

      .cf-subs {
        position: absolute;
        left: 50%;
        bottom: 3%;
        transform: translateX(-50%);
        z-index: 6;
        transition: bottom 360ms ease;
        margin: 0;
        max-width: 60ch;
        text-align: center;
        font-family: var(--cf-serif);
        font-size: 17px;
        line-height: 1.5;
        color: #f7efdd;
        background: rgba(20, 15, 6, 0.66);
        padding: 9px 18px;
      }

      /* while the transport is up the caption sits above it, and drops
         back to the foot of the frame when the bar leaves */
      .cf-page:not(.is-idle) .cf-subs {
        bottom: 104px;
      }

      /* ---- the rail -------------------------------------------------- */
      /* ONE LINE: the numeral, the chapter's name and the rule, left to
         right — the rule is not a second row under the title */
      .cf-rail {
        flex-wrap: nowrap;
        position: absolute;
        left: 5.5%;
        top: 6%;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.17em;
        color: var(--cf-ink3);
        font-family: var(--cf-ui);
      }

      .cf-rail-n {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: var(--cf-chap);
      }

      .cf-rail-segs {
        display: flex;
        gap: 5px;
        width: 240px;
      }

      /* ---- the year's own timeline ----------------------------------
         A rule the width of the chapter strip, the run so far filled in
         the chapter's colour, a dot on the head and the year riding above
         it. Tabular figures so the numeral does not jitter as it counts,
         and the whole thing is one row under the chapter line so the
         corner stays a single object. */
      /* THE RULE IS THE FILM'S LENGTH, so it should read as a long
         distance: 240px made a century and a half look like a widget.
         It runs to nearly half the frame now, and the chapter dots have
         room to sit at their own years without touching. */
      .cf-years {
        position: relative;
        flex: none;
        height: 34px;
        margin-left: 34px;
        width: clamp(260px, 42vw, 620px);
      }

      .cf-years-rule,
      .cf-years-fill {
        position: absolute;
        left: 0;
        top: 14px;
        height: 2px;
        background: var(--cf-rule);
      }

      .cf-years-rule {
        right: 0;
      }

      .cf-years-fill {
        width: calc(5px + var(--cf-head, 0) * (100% - 10px));
        background: var(--cf-chap);
        transition: width 220ms linear;
      }

      .cf-years-tick {
        position: absolute;
        top: 11px;
        width: 1px;
        height: 8px;
        background: var(--cf-rule);
      }

      /* the chapters, as dots at the years they open. Unbuilt they are the
         rule's own colour; passed, they take the chapter's. */
      .cf-years-ch {
        position: absolute;
        top: 10px;
        z-index: 2;
        appearance: none;
        border: 0;
        padding: 0;
        width: 10px;
        height: 10px;
        margin-left: -5px;
        border-radius: 50%;
        background: var(--cf-rule);
        cursor: pointer;
        pointer-events: auto;
        transition:
          background 300ms ease,
          transform 200ms ease;
      }

      .cf-years-ch.is-done {
        background: var(--cf-chap);
      }

      .cf-years-ch.is-here {
        background: var(--cf-chap);
        transform: scale(1.34);
      }

      .cf-years-ch:hover {
        transform: scale(1.5);
      }

      .cf-years-now {
        position: absolute;
        top: 20px;
        left: calc(5px + var(--cf-head, 0) * (100% - 10px));
        transform: translateX(-50%);
        font-family: var(--cf-ui);
        font-weight: 800;
        font-size: 15px;
        letter-spacing: 0.01em;
        font-variant-numeric: tabular-nums;
        color: var(--cf-chap);
        white-space: nowrap;
        transition: left 220ms linear;
      }

      .cf-years-now::after {
        content: '';
        position: absolute;
        left: 50%;
        /* rule top 14px, rule 2px, dot 10px → -10 puts the dot's centre
           on the rule's centre exactly */
        top: -10px;
        width: 10px;
        height: 10px;
        margin-left: -5px;
        border-radius: 50%;
        background: var(--cf-chap);
      }

      .cf-years-a,
      .cf-years-b {
        position: absolute;
        top: 0;
        font-family: var(--cf-ui);
        font-style: normal;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.14em;
        color: var(--cf-ink2);
      }

      .cf-years-a {
        left: 0;
      }

      .cf-years-b {
        right: 0;
      }

      /* each segment is a 13px-tall click target drawing a hairline
         track with its fill on top; the current chapter's bar thickens */
      .cf-rail-seg {
        appearance: none;
        position: relative;
        border: 0;
        height: 13px;
        padding: 0;
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
      }

      .cf-rail-seg::after {
        content: '';
        position: absolute;
        inset: 5px 0 auto;
        height: 3px;
        background: var(--cf-rule);
      }

      .cf-rail-seg i {
        position: absolute;
        left: 0;
        top: 5px;
        height: 3px;
        z-index: 1;
        background: var(--cf-chap);
        transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .cf-rail-seg.is-here i {
        top: 4px;
        height: 5px;
      }

      /* THE DOT ON THE RULE. The centenary programme draws its timeline as
         a line with a filled dot at each momentum; the film's chapter
         strip is the same object, so it is drawn the same way. */
      .cf-rail-seg::before {
        content: '';
        position: absolute;
        left: -1px;
        top: 2px;
        z-index: 2;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--cf-rule);
        transition: background 300ms ease;
      }

      .cf-rail-seg.is-here::before {
        background: var(--cf-chap);
      }

      .cf-rail-seg:hover::after {
        background: var(--cf-ink2);
      }

      .cf-fault {
        position: absolute;
        left: 5.5%;
        bottom: 4%;
        z-index: 9;
        margin: 0;
        padding: 8px 12px;
        background: #2a0a06;
        color: #ffb4a0;
        font:
          12px/1.4 ui-monospace,
          monospace;
        border-radius: 8px;
        max-width: 80%;
      }

      .cf-rig {
        position: absolute;
        width: 0;
        height: 0;
      }

      /* ---- the disc menu --------------------------------------------- */
      /* the sheet belongs to the picture: it scrims the scene and its
         transport, and leaves the wall plate below the film alone —
         a menu that dims an article is a modal, not a disc menu */
      .cf-menu {
        position: absolute;
        inset: 0 0 auto 0;
        height: 100svh;
        z-index: 6;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(28, 22, 10, 0.52);
        backdrop-filter: blur(2px);
      }

      .cf-menu-in {
        background: var(--cf-paper);
        border: 1px solid var(--cf-rule);
        padding: 34px 40px 26px;
        min-width: min(460px, 84vw);
        max-width: min(640px, 92vw);
        box-shadow: 0 30px 70px rgba(30, 22, 8, 0.34);
        font-family: var(--cf-ui);
      }

      .cf-menu-head {
        margin: 0;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.42em;
        color: var(--cf-ink);
      }

      .cf-menu-sub {
        margin: 4px 0 22px;
        font-size: 12px;
        color: var(--cf-ink2);
        letter-spacing: 0.06em;
      }

      .cf-menu-list {
        list-style: none;
        margin: 0 0 18px;
        padding: 0;
      }

      .cf-menu-item {
        appearance: none;
        background: transparent;
        border: 0;
        border-top: 1px solid var(--cf-rule);
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: 16px;
        padding: 13px 4px;
        font: inherit;
        color: var(--cf-ink);
        cursor: pointer;
        text-align: left;
      }

      .cf-menu-item:hover {
        color: var(--cf-accent);
      }

      .cf-menu-item.is-here {
        color: var(--cf-accent);
        font-weight: 700;
      }

      .cf-menu-n {
        font-size: 12px;
        letter-spacing: 0.16em;
        color: var(--cf-accent);
        min-width: 2.4em;
      }

      .cf-menu-t {
        font-size: 17px;
        letter-spacing: 0.1em;
        font-weight: 600;
        flex: 1;
        min-width: 0;
      }

      .cf-menu-d {
        font-size: 11px;
        letter-spacing: 0.1em;
        color: var(--cf-ink2);
      }

      .cf-menu-keys {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.1em;
        color: var(--cf-ink2);
      }

      /* ---- controls -------------------------------------------------- */
      /* ---- the player ------------------------------------------------ *
       * A chaptered playhead in the film's own materials: gaps between
       * the chapters, seal red for what has played, and a head you can
       * take hold of. It sits ON the picture, above the transport, and
       * both stand down when the hand goes away.
       * ------------------------------------------------------------- */
      /* THE PLAYER FLOATS ON THE PICTURE, the way every player does —
         a paper bar under the frame costs fifty pixels of film and
         announces that this is a document with a video in it. */
      /* THE BAR IS UNDER THE PICTURE, not on it. A player floating over
         the frame is right for a video in a page and wrong for a film
         that fills the window: it takes the bottom of every composition
         and it disappears exactly when you reach for it. Below the
         picture it costs seventy-six pixels once and is always there. */
      /* THE TRANSPORT SITS ON THE PICTURE, not under it. The source page
         runs its track as a hairline over the scene; here the strip was a
         solid band of paper that took 76px off every frame. It is a fade
         of the chapter's own paper now, so the film owns the whole
         viewport and the controls read as a ledge on the glass. */
      /* ---- the player ------------------------------------------------ */
      /* fixed, not absolute: the page runs on below the stage, so the
         page's bottom is not the frame's bottom. A dark scrim, not paper:
         white type on a gradient into black is the one thing that reads
         over every grade the film wears, and it is what the eye expects
         at the bottom of a picture that plays. */
      .cf-player {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        padding: 26px 14px 8px;
        color: #fff;
        font-family: var(--cf-ui);
        background: linear-gradient(
          to top,
          rgba(12, 9, 4, 0.72),
          rgba(12, 9, 4, 0.38) 45%,
          rgba(12, 9, 4, 0)
        );
        transition: opacity 360ms ease;
      }

      /* nobody is touching it: the apparatus leaves the picture, the way
         every player made since 2010 does; a hand on the frame brings it
         back (wake) */
      .cf-player.is-idle {
        opacity: 0;
        pointer-events: none;
      }

      /* the transport waits outside while the front door is open */
      .cf-player.is-away {
        visibility: hidden;
      }

      .cf-scrub {
        position: relative;
        height: 22px;
        display: flex;
        align-items: center;
        cursor: pointer;
        touch-action: none;
        outline: none;
      }

      .cf-scrub-track {
        position: relative;
        display: flex;
        gap: 2px;
        width: 100%;
        height: 3px;
        transition: height 120ms ease;
      }

      .cf-scrub:hover .cf-scrub-track,
      .cf-scrub:focus-visible .cf-scrub-track {
        height: 5px;
      }

      .cf-scrub-ch {
        position: relative;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.28);
        transition: transform 120ms ease;
      }

      /* the chapter under the pointer stands up a little, the way the
         hovered chapter on every chaptered bar does */
      .cf-scrub:hover .cf-scrub-ch:hover {
        transform: scaleY(1.7);
      }

      /* the ghost: a pale fill to wherever the pointer is resting, so
         the eye reads the cut it would make before the hand makes it */
      .cf-scrub-ch em {
        position: absolute;
        inset: 0 auto 0 0;
        display: block;
        background: rgba(255, 255, 255, 0.34);
        width: calc(
          clamp(0, (var(--cf-hov, 0) - var(--s0)) / var(--sl), 1) * 100%
        );
      }

      /* each chapter fills with the part of the whole-film playhead that
         falls inside it — one custom property, updated per frame, and no
         re-render anywhere */
      .cf-scrub-ch i {
        position: absolute;
        inset: 0 auto 0 0;
        display: block;
        background: var(--cf-red);
        width: calc(
          clamp(0, (var(--cf-prog, 0) - var(--s0)) / var(--sl), 1) * 100%
        );
      }

      /* the knob sits on the fill's end: --cf-hpx is that end in pixels,
         from the same fractions and the measured track (see frame) */
      .cf-scrub-head {
        position: absolute;
        top: 50%;
        left: calc(var(--cf-hpx, 0) * 1px);
        width: 13px;
        height: 13px;
        margin: -6.5px 0 0 -6.5px;
        border-radius: 50%;
        background: var(--cf-red);
        transform: scale(0);
        transition: transform 120ms ease;
      }

      .cf-scrub:hover .cf-scrub-head,
      .cf-scrub:focus-visible .cf-scrub-head,
      .cf-scrub.is-live .cf-scrub-head {
        transform: scale(1);
      }

      .cf-scrub-tip {
        position: absolute;
        bottom: 18px;
        left: calc(var(--cf-tipx, 0) * 1px);
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        white-space: nowrap;
        background: rgba(12, 9, 4, 0.92);
        color: #fff;
        padding: 7px 11px 6px;
        border-radius: 4px;
        pointer-events: none;
      }

      .cf-scrub-tip small {
        font-size: 10px;
        letter-spacing: 0.12em;
        color: rgba(255, 255, 255, 0.72);
      }

      .cf-scrub-tip b {
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      .cf-controls {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 40px;
      }

      /* the round ghost button: a 40px target, the glyph 22px inside it,
         a hover that is a wash rather than an outline */
      .cf-ic {
        appearance: none;
        border: 0;
        background: transparent;
        color: #fff;
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 50%;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        opacity: 0.92;
        transition:
          background 120ms ease,
          opacity 120ms ease;
      }

      .cf-ic svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
        display: block;
      }

      .cf-ic:hover,
      .cf-ic:focus-visible {
        background: rgba(255, 255, 255, 0.14);
        opacity: 1;
        outline: none;
      }

      /* the label above a button — the name and its key — in the bar's
         own bubble rather than the browser's slow yellow one */
      [data-tip] {
        position: relative;
      }

      [data-tip]::before {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translate(-50%, 4px);
        white-space: nowrap;
        background: rgba(12, 9, 4, 0.92);
        color: #fff;
        font-family: var(--cf-ui);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: none;
        padding: 6px 10px;
        border-radius: 4px;
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 120ms ease 200ms,
          transform 120ms ease 200ms;
      }

      [data-tip]:hover::before,
      [data-tip]:focus-visible::before {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      /* the last button's bubble hugs the right edge instead of the
         button's centre, so it never leaves the viewport */
      .cf-ic-last::before {
        left: auto;
        right: 0;
        transform: translate(0, 4px);
      }

      .cf-ic-last:hover::before,
      .cf-ic-last:focus-visible::before {
        transform: translate(0, 0);
      }

      /* the speaker and its fader: the fader is folded away until the
         pointer is on the speaker, then slides out beside it */
      .cf-vol {
        display: inline-flex;
        align-items: center;
      }

      .cf-vol-range {
        appearance: none;
        -webkit-appearance: none;
        width: 0;
        height: 3px;
        margin: 0;
        opacity: 0;
        border-radius: 2px;
        background: linear-gradient(
          to right,
          #fff calc(var(--cf-vol, 1) * 100%),
          rgba(255, 255, 255, 0.3) 0
        );
        cursor: pointer;
        outline: none;
        transition:
          width 200ms ease,
          margin 200ms ease,
          opacity 200ms ease;
      }

      .cf-vol:hover .cf-vol-range,
      .cf-vol:focus-within .cf-vol-range {
        width: 64px;
        margin: 0 12px 0 4px;
        opacity: 1;
      }

      .cf-vol-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #fff;
        border: 0;
      }

      .cf-vol-range::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #fff;
        border: 0;
      }

      /* the chapter's name, beside the clock, is the way into the list */
      .cf-chap {
        appearance: none;
        border: 0;
        background: transparent;
        color: rgba(255, 255, 255, 0.78);
        font: inherit;
        font-size: 12.5px;
        letter-spacing: 0.04em;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 32px;
        padding: 0 6px 0 2px;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        max-width: min(34ch, 26vw);
        transition: color 120ms ease;
      }

      .cf-chap span {
        opacity: 0.6;
        padding-right: 1px;
      }

      .cf-chap svg {
        width: 14px;
        height: 14px;
        flex: none;
        fill: currentColor;
        opacity: 0.7;
        transition: transform 160ms ease;
      }

      .cf-chap:hover,
      .cf-chap:focus-visible {
        color: #fff;
        outline: none;
      }

      .cf-chap:hover svg {
        transform: translateX(2px);
      }

      /* a button with its name on it, set like the link beside it */
      .cf-word {
        appearance: none;
        border: 0;
        background: transparent;
        color: rgba(255, 255, 255, 0.82);
        font-family: var(--cf-ui);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 32px;
        padding: 0 12px 0 8px;
        border-radius: 16px;
        cursor: pointer;
        white-space: nowrap;
        transition:
          background 120ms ease,
          color 120ms ease;
      }

      .cf-word svg {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }

      .cf-word:hover,
      .cf-word:focus-visible {
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
        outline: none;
      }

      /* the confirmation glyph, fixed at the middle of the picture */
      .cf-burst {
        position: fixed;
        left: 50%;
        top: 50%;
        width: 88px;
        height: 88px;
        margin: -44px 0 0 -44px;
        border-radius: 50%;
        background: rgba(12, 9, 4, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 4;
        animation: cf-burst 560ms ease-out forwards;
      }

      .cf-burst svg {
        width: 42px;
        height: 42px;
        fill: #fff;
      }

      @keyframes cf-burst {
        from {
          opacity: 1;
          transform: scale(0.72);
        }

        to {
          opacity: 0;
          transform: scale(1.5);
        }
      }

      /* the hand that stopped moving takes its pointer with it */
      .cf-page.is-idle {
        cursor: none;
      }

      /* CC is a word, set as a badge; on, it is underlined in the film's
         red the way every captions button on earth is */
      .cf-ic-cc {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        position: relative;
      }

      .cf-ic-cc.is-on::after,
      .cf-ic.is-on::after {
        content: '';
        position: absolute;
        left: 13px;
        right: 13px;
        bottom: 7px;
        height: 2px;
        background: var(--cf-red);
        border-radius: 1px;
      }

      .cf-ic.is-on {
        position: relative;
      }

      .cf-time {
        margin-left: 8px;
        font-size: 12.5px;
        letter-spacing: 0.02em;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.82);
        white-space: nowrap;
      }

      .cf-time b {
        font-weight: 500;
        color: #fff;
      }

      .cf-time i {
        font-style: normal;
        padding: 0 4px;
        opacity: 0.6;
      }

      /* the chapter title cannot be allowed to widen the control row */
      .cf-time em {
        display: inline-block;
        max-width: min(28ch, 22vw);
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
        font-style: normal;
        margin-left: 6px;
        color: rgba(255, 255, 255, 0.72);
      }

      .cf-spacer {
        flex: 1 1 auto;
      }

      .cf-link {
        color: rgba(255, 255, 255, 0.82);
        text-decoration: none;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 0 12px;
        white-space: nowrap;
      }

      .cf-link:hover {
        color: #fff;
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      /* only ever under ?debug: which cut of the film the browser has */
      .cf-build {
        color: rgba(255, 255, 255, 0.55);
        font:
          10px/1 ui-monospace,
          monospace;
        letter-spacing: 0.04em;
        padding: 0 12px;
        white-space: nowrap;
      }

      /* embedded, the iframe wraps the film AND its transport directly;
         the app's own chrome inside the iframe stands down instead */
      body.cf-embedded .topbar,
      body.cf-embedded .footer {
        display: none;
      }

      /* THE FILM ESCAPES THE APP'S PAGE CONTAINER. .page centres a
         measured column with gutters and a top offset — right for every
         demo page, and a pink-tinted mat around a film that owns its
         frame. Both film bodies flatten it; the film's own layout is the
         page. (This mattered only once cf-page left position: fixed —
         fixed elements never felt the container.) */
      body.cf-film .page,
      body.cf-embedded .page {
        width: 100%;
        margin: 0;
        padding: 0;
      }

      /* a clear beat owns nothing on the glass, the numeral included */
      .cf-clear .cf-ghost {
        display: none;
      }

      /* ---- the gate --------------------------------------------------- */
      /* the card stands BESIDE the tower, never over it: the boot pose
         seats the building left of centre, so the door takes the right
         third — the same real estate the title beat's type owns — and
         its wash leans that way too instead of dimming the whole frame */
      /* THE DOOR DOES NOT BLUR THE BUILDING. A poster's job is to make
         the subject look like the reason to press play; a blur makes it
         look like a placeholder. The scene stays sharp and keeps
         turning (see the poster orbit) — the only thing over it is a
         ground for the type, raked away from the tower. */
      .cf-gate {
        position: absolute;
        inset: 0;
        z-index: 7;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        background: linear-gradient(
          100deg,
          rgba(24, 18, 8, 0) 26%,
          rgba(24, 18, 8, 0.28) 52%,
          rgba(22, 16, 7, 0.72) 82%
        );
      }

      .cf-gate-in {
        position: relative;
        text-align: center;
        font-family: var(--cf-ui);
        color: #f7f0e0;
        /* hard right: the poster is a two-column composition — building
           in one half, wordmark in the other — and the wordmark drifting
           toward the middle closes the gap that makes it one */
        margin-right: clamp(34px, 7vw, 132px);
      }

      /* the museum frame: hairline, inset like a mat, above the scene
         and under the type */
      .cf-gate-frame {
        position: absolute;
        inset: clamp(14px, 2.4vw, 30px);
        border: 1px solid rgba(247, 240, 224, 0.34);
        pointer-events: none;
        animation: cf-mg-fade 1200ms ease-out both;
      }

      /* the spine: vertical Japanese down the inside of the frame */
      .cf-gate-vert {
        position: absolute;
        top: 50%;
        left: clamp(30px, 4.6vw, 58px);
        transform: translateY(-50%);
        writing-mode: vertical-rl;
        white-space: nowrap;
        font-family: var(--cf-ui);
        font-weight: 600;
        font-size: clamp(10px, 0.95vw, 13px);
        letter-spacing: 0.3em;
        color: rgba(247, 240, 224, 0.66);
        animation: cf-mg-fade 900ms ease-out both;
        animation-delay: 2050ms;
      }

      .cf-gate-k {
        position: relative;
        margin: 0;
        font-family: var(--cf-display);
        font-weight: 800;
        font-size: clamp(64px, min(20vh, 15vw), 260px);
        letter-spacing: -0.03em;
        white-space: nowrap;
        line-height: 1.02;
        text-shadow: 0 8px 70px rgba(20, 14, 4, 0.55);
      }

      /* the ghost: the title again, enormous and hollow, standing behind
         itself — the poster's depth comes from one word at two weights */
      .cf-gate-ghost {
        position: absolute;
        left: 50%;
        top: 44%;
        transform: translate(-50%, -50%) scale(1.9);
        font-size: 1em;
        line-height: 1;
        color: transparent;
        -webkit-text-stroke: 1px rgba(247, 240, 224, 0.2);
        white-space: nowrap;
        pointer-events: none;
        animation: cf-mg-ghost 2400ms ease-out both;
        animation-delay: 700ms;
      }

      @keyframes cf-mg-ghost {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(2.05);
        }

        100% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1.9);
        }
      }

      /* the index strip along the foot of the frame */
      .cf-gate-index {
        position: absolute;
        left: clamp(40px, 7vw, 90px);
        right: clamp(40px, 7vw, 90px);
        bottom: clamp(30px, 5.4vh, 56px);
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px clamp(12px, 2.2vw, 36px);
        margin: 0;
        font-family: var(--cf-ui);
        font-size: clamp(9px, 0.8vw, 11px);
        font-weight: 700;
        letter-spacing: 0.22em;
        color: rgba(247, 240, 224, 0.62);
        animation: cf-mg-fade 900ms ease-out both;
        animation-delay: 2500ms;
      }

      .cf-gate-index span {
        white-space: nowrap;
      }

      .cf-gate-t {
        margin: 10px 0 0;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.5em;
        text-indent: 0.5em;
      }

      .cf-gate-s {
        margin: 6px 0 30px;
        font-size: 12px;
        letter-spacing: 0.14em;
        color: rgba(247, 240, 224, 0.72);
      }

      /* the claim under the subtitle: the display serif, italic, a step
         back in the ink; and under it the four words, tiny and wide */
      .cf-gate-live {
        margin: 14px 0 0;
        font-family: var(--cf-display);
        font-style: italic;
        font-size: clamp(15px, 1.25vw, 20px);
        line-height: 1.4;
        letter-spacing: 0.01em;
        color: rgba(247, 240, 224, 0.78);
        max-width: 40ch;
        text-wrap: balance;
      }

      .cf-gate-live-k {
        margin: 8px 0 22px;
        font-family: var(--cf-ui);
        font-size: 10px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(247, 240, 224, 0.5);
      }

      .cf-gate-row {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .cf-go {
        appearance: none;
        font: inherit;
        font-family: var(--cf-ui);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.14em;
        cursor: pointer;
        padding: 14px 30px;
        border-radius: 999px;
        border: 1px solid #f2e9d2;
        background: #f2e9d2;
        color: #2e2515;
        box-shadow: 0 10px 34px rgba(20, 14, 4, 0.35);
        transition:
          transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
          box-shadow 220ms ease;
      }

      .cf-go:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 44px rgba(20, 14, 4, 0.42);
      }

      .cf-go:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .cf-go.is-quiet {
        background: transparent;
        color: #f2e9d2;
        border-color: rgba(242, 233, 210, 0.5);
      }

      .cf-go.is-quiet:hover {
        border-color: #f2e9d2;
      }

      /* ---- the title package ---------------------------------------- *
         One motion system for front and back matter, staged like a
         broadcast title: rule, glyphs, mark, sub, seal, controls. All
         CSS — these screens live outside the score on purpose, since
         both exist precisely when the film is not running. */
      .cf-matter {
        position: relative;
      }

      .cf-mg-rule {
        display: block;
        width: 1px;
        height: 56px;
        margin: 0 auto 18px;
        background: rgba(247, 240, 224, 0.65);
        transform-origin: 50% 0;
        animation: cf-mg-rule 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      @keyframes cf-mg-rule {
        0% {
          transform: scaleY(0);
        }

        100% {
          transform: scaleY(1);
        }
      }

      .cf-mg-g1,
      .cf-mg-g2 {
        display: inline-block;
        animation: cf-mg-glyph 1300ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: 350ms;
      }

      .cf-mg-g2 {
        animation-delay: 650ms;
      }

      @keyframes cf-mg-glyph {
        0% {
          opacity: 0;
          filter: blur(16px);
          transform: translateY(10px);
        }

        100% {
          opacity: 1;
          filter: blur(0);
          transform: translateY(0);
        }
      }

      /* the wordmark tracks IN — from letterspaced air to its set width,
         the oldest move in broadcast titles because nothing else says
         "this is the name" as quietly */
      .cf-mg-mark {
        white-space: nowrap;
        transform-origin: center;
        animation: cf-mg-track 1400ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: 1050ms;
      }

      /* THE WORDMARK NO LONGER RE-MEASURES ITSELF.
         Tracking in from 1.1em added about 250px of laid-out width at the
         first frame — so on anything but a wide screen the mark started
         wrapped onto two lines and un-wrapped partway through its own
         animation, taking the card under it with it. The same gesture
         reads identically as a scale on the X axis, which is a composited
         transform and reflows nothing. */
      @keyframes cf-mg-track {
        0% {
          opacity: 0;
          transform: scaleX(1.16);
        }

        100% {
          opacity: 1;
          transform: scaleX(1);
        }
      }

      .cf-mg-sub {
        animation: cf-mg-fade 800ms ease-out both;
        animation-delay: 1650ms;
      }

      .cf-mg-row {
        animation: cf-mg-fade 800ms ease-out both;
        animation-delay: 2250ms;
      }

      /* centred as a block AND line by line: the shorthand margin used to
         cancel the auto inline margins, so the column sat at the card's
         left edge with its lines centred inside a box narrower than its
         first line */
      .cf-mg-credits {
        display: flex;
        flex-direction: column;
        align-items: center;
        white-space: nowrap;
        max-width: 88vw;
        gap: 4px;
        margin: 0 auto 22px;
        font-size: 11px;
        letter-spacing: 0.14em;
        color: rgba(247, 240, 224, 0.6);
        animation: cf-mg-fade 900ms ease-out both;
        animation-delay: 2050ms;
      }

      @keyframes cf-mg-fade {
        0% {
          opacity: 0;
          transform: translateY(6px);
        }

        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* the seal: the lineup's stamp, miniature — it lands hard and
         late, canted the way a hand cants it */
      /* on the end card the seal belongs IN the card: hung off the right
         edge it floated in the corner of the frame with nothing to sit on */
      .cf-end-in .cf-mg-seal {
        position: static;
        margin: 0 auto 16px;
      }

      /* the open end of the date. A dash at the numeral's own weight is a
         slab as wide as a digit and reads as a fifth figure. */
      .cf-end-dash {
        font-style: normal;
        font-size: 0.4em;
        font-weight: 600;
        vertical-align: 0.5em;
        margin-left: 0.08em;
        opacity: 0.7;
      }

      /* THE SEAL IS A DISC AND THE WORD SITS ON ITS CENTRE.
         It was a vertical badge with letterspaced Latin running down it,
         and letter-spacing adds its space AFTER the last letter — so the
         word was always sitting one space above the middle of its own
         box, which is exactly the kind of thing you cannot stop seeing.
         Horizontal, tracked from the centre (text-indent pays the
         trailing space back), on a round stamp. */
      .cf-mg-seal {
        position: absolute;
        top: 4px;
        right: -76px;
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        font-family: var(--cf-ui);
        font-weight: 700;
        font-size: 15px;
        letter-spacing: 0.12em;
        text-indent: 0.12em;
        text-transform: uppercase;
        color: #f7f0e0;
        background: var(--cf-mark);
        border-radius: 50%;
        animation: cf-mg-seal 500ms cubic-bezier(0.16, 1.2, 0.3, 1) both;
        animation-delay: 1900ms;
      }

      @keyframes cf-mg-seal {
        0% {
          opacity: 0;
          transform: rotate(-4deg) scale(1.6);
        }

        30% {
          opacity: 1;
          transform: rotate(-4deg) scale(0.97);
        }

        100% {
          opacity: 0.94;
          transform: rotate(-4deg) scale(1);
        }
      }

      /* ---- the end card ---------------------------------------------- */
      .cf-end {
        position: absolute;
        inset: 0;
        z-index: 6;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(28, 22, 10, 0.58);
        backdrop-filter: blur(1.5px);
      }

      .cf-end-in {
        text-align: center;
        font-family: var(--cf-ui);
        color: #f7f0e0;
      }

      .cf-end-k {
        margin: 0;
        font-family: var(--cf-display);
        font-weight: 800;
        /* '1882 —' is six characters, not four: at 19vw it was six times
           the viewport wide and it set the width of the whole card */
        font-size: clamp(44px, min(15vh, 9vw), 150px);
        letter-spacing: -0.03em;
        white-space: nowrap;
        line-height: 1;
        text-shadow: 0 6px 60px rgba(20, 14, 4, 0.55);
      }

      .cf-end-t {
        margin: 12px 0 0;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.5em;
        text-indent: 0.5em;
      }

      .cf-end-s {
        margin: 6px 0 26px;
        font-size: 12px;
        letter-spacing: 0.14em;
        color: rgba(247, 240, 224, 0.7);
      }

      /* ---- the stamp -------------------------------------------------- *
         A hanko, not a title: it strikes, settles at once, and is simply
         replaced by the next. Seal-red on purpose — it shares the
         annotation's ink because it IS an annotation, pressed over each
         tower as the lineup calls the roll. */
      .cf-stamp {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        pointer-events: none;
        font-family: var(--cf-display);
        font-weight: 700;
        font-size: min(24vh, 16vw);
        letter-spacing: 0.04em;
        color: var(--cf-mark);
        mix-blend-mode: multiply;
        animation: cf-stamp 700ms cubic-bezier(0.16, 1.3, 0.3, 1) both;
      }

      @keyframes cf-stamp {
        0% {
          opacity: 0;
          transform: rotate(-2.5deg) scale(1.5);
        }

        16% {
          opacity: 0.92;
          transform: rotate(-2.5deg) scale(0.99);
        }

        100% {
          opacity: 0.88;
          transform: rotate(-2.5deg) scale(1);
        }
      }

      /* the app's own chrome, gone: this route is a frame, not a page */
      body.cf-film .topbar,
      body.cf-film .footer {
        display: none;
      }

      /* A ROMAN WORD IS NOT TWO GLYPHS.
         The block was cut for a two-character CJK setting, where the type
         size and the column width have nothing to do with each other. A
         Latin word's width IS its letter count, so 'Evangelistes' set at
         the size that suited 'Obra' runs off the frame — and a word that
         wraps to two lines lands the whole plate at a different height.
         So: never wrap, and take the size from the count the plane
         already carries (--cf-glyphs), capped by the design size. 0.56em
         is about the average advance of this face. */
      .cf-kanji.is-latin {
        font-family: var(--cf-display);
        font-weight: 800;
        text-transform: uppercase;
        color: var(--cf-chap);
        writing-mode: horizontal-tb;
        white-space: nowrap;
        font-size: min(
          clamp(40px, 6.2vw, 104px),
          calc(var(--cf-fit, 42vw) / (var(--cf-glyphs, 4) * 0.56))
        );
        letter-spacing: -0.02em;
        line-height: 0.92;
      }
      .is-title .cf-kanji.is-latin {
        --cf-fit: 46vw;
        font-size: min(
          clamp(52px, 8.6vw, 142px),
          calc(var(--cf-fit) / (var(--cf-glyphs, 4) * 0.56))
        );
      }
      .is-plate .cf-kanji.is-latin {
        --cf-fit: 24vw;
        writing-mode: horizontal-tb;
        font-size: min(
          clamp(34px, 4.8vw, 76px),
          calc(var(--cf-fit) / (var(--cf-glyphs, 4) * 0.56))
        );
        letter-spacing: -0.01em;
        max-width: 26vw;
      }
      .is-point .cf-kanji.is-latin {
        --cf-fit: 32vw;
        font-size: min(
          clamp(36px, 5.2vw, 82px),
          calc(var(--cf-fit) / (var(--cf-glyphs, 4) * 0.56))
        );
      }
    </style>
  </template>
}
