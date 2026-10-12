import type { ChoreoRun, Query } from '@cardstack/choreo';
import { after, at, Choreo } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, motionValue } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import {
  type Build,
  type Delivery,
  type EffectName,
  EFFECTS,
  effectsFor,
  partOf,
  type Relation,
} from '../lib/builds';
import { observeStage } from '../lib/onstage';
import { preventSelect } from '../lib/pointer';
import { tuneSeconds } from '../lib/tuning';
import BuildOrderNotes from '../notes/build-order';
import { BEAD, HEAD, ORBIT, TAIL, TIP } from '../shell/choreo-mark';

/* ── the score, as it opens ──────────────────────────────────────────────── */

/**
 * Nine builds, and not one absolute time among them.
 *
 * Read it the way you would read it aloud: the plate slides in, the comet's
 * tail draws with it, the head draws after the tail, the inner orbit sets off
 * WITH the head — two timelines now running in phase — the outer arrival
 * lands its bead, the inner one catches fire, then the wordmark comes after,
 * character by character, with the rule drawing under it and the tagline
 * last. The template below says exactly that, in the library's words: each
 * row becomes a named `<c.Tween>`, `with` is `{{at 'b3'}}`, `after` is
 * `{{after 'b3'}}`, and every start time in the transport is read back from
 * the run the compiler resolved — never computed here.
 */
const OPENING: Build[] = [
  {
    by: 'all',
    delay: 0,
    effect: 'move',
    ms: 620,
    part: 'plate',
    start: 'with',
  },
  {
    by: 'all',
    delay: 140,
    effect: 'draw',
    ms: 520,
    part: 'tail',
    start: 'with',
  },
  {
    by: 'all',
    delay: 0,
    effect: 'draw',
    ms: 520,
    part: 'head',
    start: 'after',
  },
  {
    by: 'all',
    delay: 200,
    effect: 'draw',
    ms: 560,
    part: 'orbit',
    start: 'with',
  },
  {
    by: 'all',
    delay: 320,
    effect: 'pop',
    ms: 380,
    part: 'bead',
    start: 'with',
  },
  {
    by: 'all',
    delay: 240,
    effect: 'draw',
    ms: 240,
    part: 'tip',
    start: 'with',
  },
  {
    by: 'character',
    delay: 60,
    effect: 'drift',
    ms: 760,
    part: 'word',
    start: 'after',
  },
  {
    by: 'all',
    delay: 240,
    effect: 'draw',
    ms: 520,
    part: 'rule',
    start: 'with',
  },
  {
    by: 'word',
    delay: 20,
    effect: 'soften',
    ms: 620,
    part: 'tag',
    start: 'after',
  },
];

/** how long the finished logo is held before the loop comes round again —
    a `<c.Wait>` on the timeline, so the hold is scrubbable like the rest */
const HOLD = 0.9;

/** the stepper's grain, in ms — 100 so a 1-decimal readout moves every click */
const STEP = 100;

/* ── the score's words, as template helpers ──────────────────────────────── */

/** builds are named by row: the inspector's "Build 3" is the anchor `b3` */
const nameOf = (index: number) => `b${index + 1}`;

/**
 * Two words and a reference, resolved by the compiler: `with` anchors on the
 * previous build's START, `after` on its end. Build 1 has no build above it,
 * so its start is the run's own zero — Keynote's "On Click" — and it is the
 * one step left in the sequence's natural flow.
 */
const anchorOf = (build: Build, index: number) =>
  index === 0
    ? undefined
    : build.start === 'with'
      ? at(nameOf(index - 1))
      : after(nameOf(index - 1));

const secondsOf = (ms: number) => ms / 1000;

/** the inspector's 'all' is the library's default: the sprite is the unit */
const byOf = (by: Delivery) => (by === 'all' ? undefined : by);

const isFx = (build: Build, effect: EffectName) => build.effect === effect;

/**
 * The score names the STANDING scene: kept sprites, by id. Not `c.id` —
 * an untyped id query also matches a REMOVED sprite, and when this whole
 * demo sits inside a leaving gallery card, that would conscript every part
 * into the full four-second opening while its Presence waits on the region.
 * A dying card's parts are none of this score's business: with no cue
 * naming them, the region hands them back to Presence immediately.
 */
const standing = (id: string): Query => ({ id, type: 'kept' });

/* ── the demo ────────────────────────────────────────────────────────────── */

/**
 * A logo on the left, the build order that makes it on the right.
 *
 * This demo used to carry its own scheduler — a `schedule()` that resolved
 * with/after into start times, a `windowOf`/`slotOf` pair that divided a text
 * build among its glyphs, and a `poseAt` sampled by its own rAF clock. All
 * deleted: the score is now written as a `<c.Sequence>` of named steps, the
 * glyphs are `@by='character'` delivery, and the transport holds `c.run` —
 * play, pause and the scrubber are `run.play()`, `run.pause()` and
 * `run.time = t` on the library's own clock.
 *
 * What the panel is here to show survives the move: the score is EDITABLE
 * while it runs. Change build 6 from After to With and every start time
 * downstream of it moves, because none of them was ever written down — the
 * edit re-renders the steps, the region replays the pass, and the run is put
 * back at the same t against the new schedule. The bars in the transport are
 * read from `run.cues` — the compiler's resolved answer, not a second copy.
 */
export class BuildOrder extends Component {
  @tracked builds: Build[] = OPENING.map((build) => ({ ...build }));
  @tracked loop = true;
  /** which row the inspector is editing */
  @tracked pick = 0;
  @tracked playing = true;
  /** bumped to replay: any change inside the region re-runs the pass */
  @tracked take = 0;
  /** each build's resolved window as fractions of the run, from `run.cues` */
  @tracked resolved: { at: number; end: number }[] = [];

  /**
   * The playhead and the run's length, in seconds — NOT tracked, and that is
   * load-bearing: the region's render detector re-runs on EVERY render, so a
   * tracked value written at 60fps would replay the pass at 60fps, cancelling
   * the run it is trying to watch. The clock readout and the range input are
   * written imperatively in `tick` instead.
   */
  private t = 0;
  private runtime = 0;

  /** the region's yielded context, grabbed by a modifier — `this.c.run` is the transport's whole subject */
  private c?: { run: ChoreoRun | null };
  /** the run the transport last adopted, so a new pass is noticed once */
  private seen: ChoreoRun | null = null;
  /** the run whose natural end already triggered the loop's next take */
  private doneOf: ChoreoRun | null = null;
  /** where to put the playhead when the next run arrives (an edit replays) */
  private reseek: number | null = null;
  /** true once a hand has stopped the run, after which it stays stopped */
  private held = false;
  /** whether the stage is being looked at — the transport's other gate */
  private onstage = false;

  /** the transport's own value, painted on the same frame as the scene */
  private headX = motionValue(0);

  private stage?: HTMLElement;
  private railW = 0;
  private watcher?: ResizeObserver;
  private viewport?: ReturnType<typeof observeStage>;
  private raf = 0;
  /** the readouts `tick` writes by hand, found once */
  private clockEl?: HTMLElement | null;
  private rangeEl?: HTMLInputElement | null;

  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
    this.watcher?.disconnect();
    this.viewport?.disconnect();
  }

  /* — wiring — */

  /** hold the region's context; the modifier's element is just a hook */
  wire = modifier((_el: Element, [c]: [{ run: ChoreoRun | null }]) => {
    this.c = c;
  });

  register = modifier((el: HTMLElement) => {
    this.stage = el;
    // a debug/test handle: the integration test drives the transport directly
    (el as HTMLElement & { buildOrder?: BuildOrder }).buildOrder = this;
    this.watcher = new ResizeObserver(() => {
      this.railW =
        this.stage?.querySelector<HTMLElement>('.bo-track')?.clientWidth ?? 0;
    });
    this.watcher.observe(el);
    // A logo animation that has to be started is a logo animation nobody
    // sees, so this one runs itself — but only while it is being looked at.
    // Twenty-six demos live in the gallery, and the frames belong to whichever
    // of them is on screen. Off screen the run pauses where it was; back on
    // screen it carries on, unless a hand has paused it since.
    this.viewport = observeStage(
      el,
      (visible) => {
        this.onstage = visible;
        if (this.onstage) {
          this.raf ||= requestAnimationFrame(this.tick);
          if (this.seen === null && this.take === 0) {
            // the opening's first take: the region deliberately plays
            // nothing on its very first render (page loads do not animate),
            // so being seen is what starts the show
            this.take++;
          }
          // playing is `tick`'s business now, every frame — see the
          // assertion there. Deciding it here once, on the edge, is what
          // left this demo dark: a run can be born while the stage is off
          // screen, get paused by the branch below, and then meet a
          // scroll-in that takes the first-take branch instead of the
          // resume — the logo sits at t≈0 forever, which is blank.
        } else {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          this.c?.run?.pause();
        }
      },
      { threshold: 0.35 },
    );
    return () => {
      this.watcher?.disconnect();
      this.viewport?.disconnect();
      this.watcher = undefined;
      this.viewport = undefined;
      this.stage = undefined;
    };
  });

  /* — the transport's frame: a reader, not a clock — */

  /**
   * The run owns the time; this loop only looks at it. A new run appears
   * whenever the region replays a pass — an edit, or the loop's next take —
   * and is adopted here: its resolved cues become the bars, and if the pass
   * was an edit, the playhead is put back at the t it was parked on, so
   * retiming build 2 while parked at 1.4s shows you what 1.4s now looks like.
   */
  private tick = () => {
    const run = this.c?.run ?? null;
    if (run && run !== this.seen) {
      this.seen = run;
      this.adopt(run);
    }
    if (run) {
      // The transport is ASSERTED, not merely set. Every other way a run
      // can end up paused — born off screen, kept across a pass that had
      // stopped it, quieted by a crossing overhead — is invisible from
      // here, and this demo is the gallery's last tile: a wordmark drawing
      // itself, which nobody watches start. `play()` is a no-op on a run
      // already playing (and on one parked at a gate), so a per-frame call
      // is an invariant, not work.
      if (this.onstage && this.playing && !this.held) {
        run.play();
      }
      const t = run.time;
      this.t = t;
      this.paint();
      if (run.isDone() && this.doneOf !== run && !this.held) {
        this.doneOf = run;
        if (this.loop) {
          this.take++;
        } else {
          // the run is over rather than interrupted, so scrolling past and
          // back must not quietly start it again
          this.playing = false;
          this.held = true;
        }
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** the clock, the range and the playhead, written by hand — see `t` */
  private paint() {
    this.headX.jump(
      this.runtime > 0 ? (this.t / this.runtime) * this.railW : 0,
    );
    this.clockEl ??= this.stage?.querySelector<HTMLElement>('.bo-clock');
    this.rangeEl ??= this.stage?.querySelector<HTMLInputElement>('.bo-range');
    const text = `${this.t.toFixed(2)} / ${this.runtime.toFixed(2)}s`;
    if (this.clockEl && this.clockEl.textContent !== text) {
      this.clockEl.textContent = text;
    }
    // While a hand is ON the thumb, the range belongs to the hand: a
    // programmatic value write during an active drag detaches WebKit's
    // pointer tracking outright — the scrubber reads as dead in Safari.
    if (this.rangeEl && !this.scrubbing) {
      const max = String(this.runtime);
      if (this.rangeEl.max !== max) {
        this.rangeEl.max = max;
      }
      // a parked thumb is corrected, never nudged: the run's clock returns
      // a float round-trip of what was set, and rewriting "1.79" as
      // "1.7900000000000003" would clobber a keyboard step mid-press
      if (
        this.playing ||
        Math.abs(Number(this.rangeEl.value) - this.t) > 0.02
      ) {
        this.rangeEl.value = String(this.t);
      }
    }
  }

  private adopt(run: ChoreoRun) {
    this.runtime = run.duration;
    // Continuity is the rule, not the exception: any pass replaces the run —
    // an edit, the loop's next take, an unrelated render — and the new run
    // resumes where the old one stood. Only a run that had actually finished
    // starts its successor from zero (the loop coming round).
    const target = this.reseek ?? this.t;
    this.reseek = null;
    if (target > 0.005 && target < run.duration - 0.005) {
      run.time = target;
    }
    if (!this.playing || this.held) {
      run.pause();
    }
    // the resolved schedule, read back: one bar per build, as fractions.
    // `wait` (the hold) still counts toward the total they are taken against.
    // Equality-guarded: `resolved` is tracked, a tracked write re-renders,
    // a render replays the pass — an unguarded write here would spin.
    const total = Math.max(
      1,
      ...run.cues.map((cue) => cue.start + cue.duration),
    );
    const next = run.cues
      .filter((cue) => cue.kind === 'tween')
      .map((cue) => ({
        at: cue.start / total,
        end: (cue.start + cue.duration) / total,
      }));
    if (JSON.stringify(next) !== JSON.stringify(this.resolved)) {
      this.resolved = next;
    }
  }

  /* — transport — */

  toggle = () => {
    const run = this.c?.run;
    if (this.playing) {
      this.playing = false;
      this.held = true;
      run?.pause();
      return;
    }
    this.held = false;
    this.playing = true;
    if (!run || run.isDone() || this.t >= this.runtime - 0.001) {
      this.doneOf = run ?? null;
      this.take++;
      return;
    }
    run.play();
  };

  /**
   * The hand lands BEFORE it moves: pointerdown claims the clock — pause
   * now, or the still-playing run crawls the thumb out from under the
   * finger before the first `input` ever fires. `scrubbing` also stops
   * `paint` from touching the range for the whole drag (see paint).
   */
  grab = () => {
    this.scrubbing = true;
    this.held = true;
    this.playing = false;
    this.c?.run?.pause();
  };

  release = () => {
    this.scrubbing = false;
  };

  private scrubbing = false;

  /**
   * Scrubbing pauses — not because it has to, but because a hand on the
   * playhead has claimed the clock. `run.time` is settable in either
   * direction and a scrubbed frame is a computed still; the only question is
   * who supplies the number, and two suppliers at once is a tug of war.
   */
  scrub = (event: Event) => {
    const run = this.c?.run;
    if (!run) {
      return;
    }
    this.held = true;
    this.playing = false;
    run.pause();
    const t = Number((event.target as HTMLInputElement).value);
    run.time = t;
    this.t = t;
    this.paint();
  };

  rewind = () => {
    const run = this.c?.run;
    this.playing = false;
    run?.pause();
    if (run) {
      run.time = 0;
    }
    this.t = 0;
    this.paint();
  };

  toggleLoop = () => {
    this.loop = !this.loop;
  };

  /* — the inspector — */

  get build(): Build {
    return this.builds[this.pick]!;
  }

  get part() {
    return partOf(this.build.part);
  }

  get isText() {
    return this.part.kind === 'text';
  }

  select = (index: number) => {
    this.pick = index;
  };

  /**
   * Change one build, and let the rest of the timeline fall out again.
   *
   * The score is replaced rather than mutated so the steps re-render, which
   * replays the pass — the region compiles a fresh run against the new
   * schedule. `reseek` asks `adopt` to put the new run back at the SAME t,
   * which is what makes an edit feel like editing rather than restarting.
   */
  private edit(patch: Partial<Build>) {
    this.builds = this.builds.map((build, i) =>
      i === this.pick ? { ...build, ...patch } : build,
    );
    this.reseek = this.t;
  }

  setEffect = (event: Event) => {
    this.edit({
      effect: (event.target as HTMLSelectElement).value as EffectName,
    });
  };

  setStart = (event: Event) => {
    this.edit({ start: (event.target as HTMLSelectElement).value as Relation });
  };

  setBy = (event: Event) => {
    this.edit({ by: (event.target as HTMLSelectElement).value as Delivery });
  };

  nudgeDelay = (by: number) => {
    this.edit({ delay: Math.max(0, this.build.delay + by * STEP) });
  };

  nudgeMs = (by: number) => {
    this.edit({ ms: Math.max(STEP * 2, this.build.ms + by * STEP) });
  };

  /* — readouts — */

  /** the last build's name, which the hold waits behind */
  get holdAt() {
    return after(nameOf(this.builds.length - 1));
  }

  /**
   * The sync marks: one faint vertical line per relation, drawn at the moment
   * a build's start was derived FROM — the previous build's start for `with`,
   * its end for `after`. The line is the anchor; the gap between the line and
   * the bar to its right is the delay, made visible.
   */
  get links() {
    return this.builds.slice(1).map((build, i) => {
      const prev = this.resolved[i];
      const frac = prev ? (build.start === 'with' ? prev.at : prev.end) : 0;
      return {
        index: i,
        // lane geometry mirrored from .bo-track: 3px pad, 3px lane, 2px gap —
        // the line runs from the previous lane's centre to this one's
        style: htmlSafe(
          `left:${(frac * 100).toFixed(3)}%;` +
            `top:${(4.5 + i * 5).toFixed(1)}px;height:5px`,
        ),
      };
    });
  }

  get lanes() {
    return this.builds.map((_build, index) => {
      const span = this.resolved[index];
      return {
        index,
        on: index === this.pick,
        style: htmlSafe(
          span
            ? `left:${(span.at * 100).toFixed(3)}%;` +
                `width:${((span.end - span.at) * 100).toFixed(3)}%`
            : 'left:0;width:0',
        ),
      };
    });
  }

  get list() {
    return this.builds.map((build, index) => ({
      effect: EFFECTS[build.effect]!.label,
      index,
      label: partOf(build.part).label,
      no: index + 1,
      on: index === this.pick,
    }));
  }

  get effectOptions() {
    return effectsFor(this.part.kind).map((name) => ({
      label: EFFECTS[name]!.label,
      name,
      on: name === this.build.effect,
    }));
  }

  get startOptions() {
    const above = this.pick;
    return [
      {
        label: `With Build ${above}`,
        name: 'with',
        on: this.build.start === 'with',
      },
      {
        label: `After Build ${above}`,
        name: 'after',
        on: this.build.start === 'after',
      },
    ];
  }

  get deliveryOptions() {
    return [
      { label: 'All at Once', name: 'all', on: this.build.by === 'all' },
      { label: 'By Word', name: 'word', on: this.build.by === 'word' },
      {
        label: 'By Character',
        name: 'character',
        on: this.build.by === 'character',
      },
    ];
  }

  get first() {
    return this.pick === 0;
  }

  get delayText() {
    return `${(this.build.delay / 1000).toFixed(1)} s`;
  }

  get msText() {
    return `${(this.build.ms / 1000).toFixed(1)} s`;
  }

  /** the nav mark's geometry, worn here at stage size */
  tailD = TAIL;
  headD = HEAD;
  orbitD = ORBIT;
  tipD = TIP;
  bead = BEAD;

  get head() {
    return { x: this.headX };
  }

  <template>
    <div
      class='ex bo-stage no-select'
      {{this.register}}
      {{on 'selectstart' preventSelect}}
    >
      <div class='bo-split'>

        {{! ── the logo: the region is the canvas ─────────────────────── }}
        <div class='bo-canvas'>
          <Choreo class='bo-logo' as |c|>
            {{! `data-take` is the replay: bumping it re-renders the region,
                and a pass whose changeset is all-kept still runs its
                timeline — the loop's next take, with no imperative restart.
                The box that moves: a plate the mark is built on. }}
            <div
              class='bo-plate'
              data-part='plate'
              data-take='{{this.take}}'
              {{motion id='plate'}}
              {{this.wire c}}
            ></div>

            <div class='bo-art'>
              {{! the mark itself, from the same exported geometry the top
                    bar renders — two strokes that draw, one bead that pops }}
              <svg class='bo-mark' viewBox='0 0 24 24' aria-hidden='true'>
                <path
                  class='bo-tail'
                  d={{this.tailD}}
                  data-part='tail'
                  {{motion id='tail'}}
                />
                <path
                  class='bo-head'
                  d={{this.headD}}
                  data-part='head'
                  {{motion id='head'}}
                />
                <circle
                  class='bo-bead'
                  cx='{{this.bead.cx}}'
                  cy='{{this.bead.cy}}'
                  r='{{this.bead.r}}'
                  data-part='bead'
                  {{motion id='bead'}}
                />
                <path
                  class='bo-orbit'
                  d={{this.orbitD}}
                  data-part='orbit'
                  {{motion id='orbit'}}
                />
                <path
                  class='bo-tip'
                  d={{this.tipD}}
                  data-part='tip'
                  {{motion id='tip'}}
                />
              </svg>

              {{! text, whole: `@by` splits it at delivery time and puts
                    Glimmer's own text nodes back after — no glyph spans here }}
              <p class='bo-word' data-part='word' {{motion id='word'}}>
                Choreo</p>

              <svg
                class='bo-rule-box'
                viewBox='0 0 220 3'
                preserveAspectRatio='none'
                aria-hidden='true'
              >
                <path
                  class='bo-rule'
                  d='M1.5 1.5H218.5'
                  vector-effect='non-scaling-stroke'
                  data-part='rule'
                  {{motion id='rule'}}
                />
              </svg>

              <p class='bo-tag' data-part='tag' {{motion id='tag'}}>
                MOTION. CHOREOGRAPHED.</p>
            </div>

            {{! ── the score, verbatim ──────────────────────────────────
                One named step per build. The template's branches are the
                effect column: an effect is nothing but keyframe values and
                an easing on a `<c.Tween>` — Pop is a scale through backOut,
                and a build-in's leading opacity frames are Keynote's
                "builds in", pinned hidden from the run's start until its
                window opens. }}
            <c.Sequence>
              {{#each this.builds key='@index' as |build i|}}
                {{#if (isFx build 'dissolve')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='easeOut'
                    @opacity={{array 0 1}}
                  />
                {{else if (isFx build 'draw')}}
                  {{! opacity leads: a zero-length dash with round linecaps
                      still paints its caps, so the stroke is withheld until
                      there is line to show. @pathSpacing pinned at 2 keeps
                      the dash pattern's second dash a whole path-length away
                      from the terminus at any drawn length. }}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='easeInOut'
                    @pathLength={{array 0 1}}
                    @pathSpacing={{array 2 2}}
                    @opacity={{array 0 1 1 1 1}}
                  />
                {{else if (isFx build 'drift')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='easeOut'
                    @opacity={{array 0 1 1}}
                    @scale={{array 0.78 1}}
                    @y={{array 18 0}}
                  />
                {{else if (isFx build 'move')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='easeOut'
                    @opacity={{array 0 1 1 1}}
                    @x={{array -38 0}}
                  />
                {{else if (isFx build 'pop')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='backOut'
                    @opacity={{array 0 1 1 1}}
                    @scale={{array 0 1}}
                  />
                {{else if (isFx build 'soften')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='easeOut'
                    @opacity={{array 0 1 1}}
                    @scale={{array 1.06 1}}
                    @filter={{array 'blur(10px)' 'blur(0px)'}}
                  />
                {{else if (isFx build 'spin')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='backOut'
                    @opacity={{array 0 1 1 1}}
                    @rotate={{array -150 0}}
                    @scale={{array 0.4 1}}
                  />
                {{else if (isFx build 'wipe')}}
                  <c.Tween
                    @name={{nameOf i}}
                    @at={{anchorOf build i}}
                    @delay={{secondsOf build.delay}}
                    @of={{standing build.part}}
                    @by={{byOf build.by}}
                    @duration={{tuneSeconds
                      'build-order'
                      (secondsOf build.ms)
                      'secondsOf build.ms duration'
                    }}
                    @ease='easeInOut'
                    @clipPath={{array
                      'inset(0 100% 0 0 round 20px)'
                      'inset(0 0% 0 0 round 20px)'
                    }}
                  />
                {{/if}}
              {{/each}}
              {{! the rest at the end of the take, on the timeline itself —
                  scrubbable, and counted in the run's length }}
              <c.Wait
                @of={{standing 'plate'}}
                @at={{this.holdAt}}
                @duration={{tuneSeconds 'build-order' HOLD 'HOLD duration'}}
              />
            </c.Sequence>
          </Choreo>
        </div>

        {{! ── the inspector ──────────────────────────────────────────── }}
        <div class='bo-panel'>
          <p class='bo-panel-head'>Build Order</p>

          <ol class='bo-list'>
            {{#each this.list key='index' as |row|}}
              <li>
                <button
                  type='button'
                  class={{if row.on 'bo-row is-on' 'bo-row'}}
                  {{on 'click' (fn this.select row.index)}}
                >
                  <span class='bo-no'>{{row.no}}</span>
                  <span class='bo-name'>{{row.label}}</span>
                  <span class='bo-fx'>{{row.effect}}</span>
                </button>
              </li>
            {{/each}}
          </ol>

          <div class='bo-form'>
            <label class='bo-field is-wide'>
              <span>Effect</span>
              <select {{on 'change' this.setEffect}}>
                {{#each this.effectOptions key='name' as |opt|}}
                  <option
                    value={{opt.name}}
                    selected={{opt.on}}
                  >{{opt.label}}</option>
                {{/each}}
              </select>
            </label>

            <label class='bo-field is-wide'>
              <span>Start</span>
              {{#if this.first}}
                {{! build 1 has no build above it, so Keynote's only offer is
                    the run's own zero — and so is ours }}
                <select disabled>
                  <option>On Click</option>
                </select>
              {{else}}
                <select {{on 'change' this.setStart}}>
                  {{#each this.startOptions key='name' as |opt|}}
                    <option
                      value={{opt.name}}
                      selected={{opt.on}}
                    >{{opt.label}}</option>
                  {{/each}}
                </select>
              {{/if}}
            </label>

            <div class='bo-field'>
              <span>Delay</span>
              <div class='bo-step'>
                <b>{{this.delayText}}</b>
                <span class='bo-arrows'>
                  <button
                    type='button'
                    aria-label='More delay'
                    {{on 'click' (fn this.nudgeDelay 1)}}
                  >▴</button>
                  <button
                    type='button'
                    aria-label='Less delay'
                    {{on 'click' (fn this.nudgeDelay -1)}}
                  >▾</button>
                </span>
              </div>
            </div>

            <div class='bo-field'>
              <span>Duration</span>
              <div class='bo-step'>
                <b>{{this.msText}}</b>
                <span class='bo-arrows'>
                  <button
                    type='button'
                    aria-label='Longer'
                    {{on 'click' (fn this.nudgeMs 1)}}
                  >▴</button>
                  <button
                    type='button'
                    aria-label='Shorter'
                    {{on 'click' (fn this.nudgeMs -1)}}
                  >▾</button>
                </span>
              </div>
            </div>

            {{#if this.isText}}
              <label class='bo-field is-wide'>
                <span>Delivery</span>
                <select {{on 'change' this.setBy}}>
                  {{#each this.deliveryOptions key='name' as |opt|}}
                    <option
                      value={{opt.name}}
                      selected={{opt.on}}
                    >{{opt.label}}</option>
                  {{/each}}
                </select>
              </label>
            {{/if}}
          </div>
        </div>
      </div>

      {{! ── the transport ────────────────────────────────────────────── }}
      <div class='bo-transport'>
        <div class='bo-track'>
          {{! one lane per build: the resolved schedule, drawn. It is not a
              second copy of the score — it is read back from `run.cues`. }}
          {{#each this.lanes key='index' as |lane|}}
            <span class='bo-lane'>
              <i
                class={{if lane.on 'bo-bar is-on' 'bo-bar'}}
                style={{lane.style}}
              ></i>
            </span>
          {{/each}}
          {{! the with/after relations, drawn: each line hangs from the moment
              the build below it is timed against }}
          {{#each this.links key='index' as |link|}}
            <i class='bo-sync' style={{link.style}}></i>
          {{/each}}
          <span class='bo-playhead' {{motion style=this.head}}></span>
          {{! a real range input, transparent over the drawing: keyboard scrub
              and a11y for free }}
          {{! max and value are written by `paint` each frame — a tracked
              binding here would re-render at 60fps, and every render replays
              the region's pass }}
          <input
            type='range'
            class='bo-range'
            min='0'
            max='0'
            step='0.01'
            value='0'
            aria-label='Playhead'
            {{on 'pointerdown' this.grab}}
            {{on 'pointerup' this.release}}
            {{on 'pointercancel' this.release}}
            {{on 'input' this.scrub}}
          />
        </div>

        <div class='bo-controls'>
          <button
            type='button'
            class='bo-play'
            aria-label={{if this.playing 'Pause' 'Play'}}
            {{on 'click' this.toggle}}
          >
            {{#if this.playing}}
              {{! lucide "pause" }}
              <svg class='tp-icon' viewBox='0 0 24 24' aria-hidden='true'>
                <rect x='14' y='3' width='5' height='18' rx='1' />
                <rect x='5' y='3' width='5' height='18' rx='1' />
              </svg>
            {{else}}
              {{! lucide "play" }}
              <svg class='tp-icon' viewBox='0 0 24 24' aria-hidden='true'>
                <path
                  d='M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
                />
              </svg>
            {{/if}}
          </button>
          <span class='bo-clock'>0.00 / 0.00s</span>
          <span class='bo-spacer'></span>
          <button
            type='button'
            class={{if this.loop 'bo-chip is-on' 'bo-chip'}}
            aria-pressed='{{this.loop}}'
            {{on 'click' this.toggleLoop}}
          >Loop</button>
          <button
            type='button'
            class='bo-chip'
            {{on 'click' this.rewind}}
          >Reset</button>
        </div>
      </div>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
         reads as a layout bug rather than as a stage, and the ones sized
         `min(Npx, 100%)` hit the frame exactly when the card is narrow.
         The block padding matters as much as the inline: on a stage tall
         enough to fill the platter, content flush against the top and bottom
         of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .no-select,
      .no-select * {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }

      /* Transport glyphs, drawn rather than typed.
       ▶ and ❚❚ are characters, and a character is at the mercy of whatever font
       resolves it — on iOS they picked up the emoji face and rendered as colour
       emoji next to a monospace clock. These are Lucide (lucide.dev, ISC), taken
       as published, which is also why they are stroked and not filled. */

      .tp-icon {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* Build Order — a logo, and the score that assembles it -------------------- */

      .bo-stage {
        /* the transport lives at the bottom of the stage, so the scene centres in
         what is left rather than under it */
        padding-bottom: 96px;
        cursor: default;
      }

      .bo-split {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(180px, 224px);
        gap: 16px;
        align-items: center;
        align-self: stretch;
        justify-self: stretch;
        width: 100%;
        max-width: 640px;
        min-height: 0;
        margin: 0 auto;
        padding-block: 12px;
      }

      /* the logo ---------------------------------------------------------------- */

      .bo-canvas {
        display: grid;
        place-items: center;
        min-width: 0;
      }

      .bo-logo {
        position: relative;
        display: grid;
        place-items: center;
        width: min(100%, 258px);
        padding: 20px 16px 18px;
      }

      /* the box that moves. A plate rather than a shadow, because Move In has to
       have something with edges to bring on. */

      .bo-plate {
        position: absolute;
        inset: 0;
        border: 1px solid var(--line-strong);
        border-radius: 20px;
        background: linear-gradient(180deg, var(--bg-spot), var(--bg-well));
        box-shadow: 0 20px 46px
          rgba(var(--shadow-rgb), calc(0.5 * var(--shadow-a)));
      }

      .bo-art {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 9px;
        width: 100%;
      }

      /* overflow is visible on purpose: Pop overshoots past 1 and Spin swings the
       chevrons outside their own boxes on the way in */

      .bo-mark {
        display: block;
        width: min(104px, 27cqh);
        height: auto;
        aspect-ratio: 1;
        overflow: visible;
      }

      /* The comet: the measurement line, arriving. The faintness of the tail is in
       the STROKE COLOR, not `opacity` — the cell's motion values write an inline
       opacity every frame, and inline beats stylesheet. */

      .bo-tail {
        fill: none;
        /* ember, not copper — see choreo-mark.gts, same fix for the same reason */
        stroke: rgba(255, 59, 31, 0.35);
        stroke-width: 2.2;
        stroke-linecap: round;
      }

      .bo-head {
        fill: none;
        /* ember read too red for the present-tense line — see choreo-mark.gts */
        stroke: var(--ember-hot);
        stroke-width: 2.2;
        stroke-linecap: round;
      }

      /* the second timeline: concentric, so the two can never cross */

      .bo-orbit {
        fill: none;
        stroke: rgba(139, 150, 156, 0.75);
        stroke-width: 1.6;
        stroke-linecap: round;
      }

      /* the inner NOW: not a bead but the line itself, burning — the last 85° of
       the sweep in the hot color, rounded caps */

      .bo-tip {
        fill: none;
        stroke: var(--ember-hot);
        stroke-width: 1.6;
        stroke-linecap: round;
      }

      /* the outer NOW: the one filled thing on the mark. fill-box, because without
       it a transform on an SVG child is measured against the viewport's origin
       and Pop would fling it off the arc. */

      .bo-bead {
        fill: var(--ember);
        transform-box: fill-box;
        transform-origin: 50% 50%;
      }

      /* text: whole elements. `@by` splits them into stand-in spans only for the
       window of their build and puts Glimmer's own text nodes back after — so
       there is nothing here but type; the spans the library makes are inline-block
       already, and they inherit the transform-origin below so a glyph scales from
       its baseline rather than its centre. */

      .bo-word,
      .bo-tag {
        display: block;
        text-align: center;
        margin: 0;
      }

      .bo-word > span,
      .bo-tag > span {
        transform-origin: 50% 80%;
      }

      .bo-word {
        font-family: var(--font-display);
        font-size: clamp(16px, 6.4cqh, 26px);
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 1;
        color: var(--ink);
      }

      .bo-tag {
        font-family: var(--font-mono);
        font-size: clamp(7px, 2.3cqh, 9px);
        letter-spacing: 0.2em;
        color: var(--ink-dim);
      }

      .bo-rule-box {
        display: block;
        width: min(100%, 186px);
        height: 3px;
        overflow: visible;
      }

      .bo-rule {
        fill: none;
        stroke: var(--ember);
        stroke-width: 2;
        stroke-linecap: round;
      }

      /* the inspector ----------------------------------------------------------- */

      .bo-panel {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        max-height: 100%;
        border: 1px solid var(--line);
        border-radius: 14px;
        /* same device-chrome treatment as .ph-app — a neutral black veil read as
         flat grey once its card turned light */
        background: linear-gradient(180deg, var(--bg-spot), var(--bg-well));
        box-shadow: 0 18px 44px
          rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-a)));
        overflow: hidden;
      }

      .bo-panel-head {
        flex: none;
        margin: 0;
        padding: 8px 10px;
        border-bottom: 1px solid var(--line);
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .bo-list {
        flex: 1 1 auto;
        min-height: 44px;
        margin: 0;
        padding: 4px;
        list-style: none;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .bo-row {
        display: grid;
        grid-template-columns: 12px minmax(0, 1fr) auto;
        gap: 7px;
        align-items: center;
        width: 100%;
        padding: 4px 6px;
        border: 0;
        border-radius: 6px;
        background: none;
        font: inherit;
        color: var(--ink-dim);
        text-align: left;
        cursor: pointer;
      }

      .bo-row.is-on {
        background: var(--ember);
        color: #fff;
      }

      .bo-no {
        font-family: var(--font-mono);
        font-size: 9px;
        color: var(--ink-faint);
        text-align: right;
      }

      .bo-name {
        overflow: hidden;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bo-fx {
        font-family: var(--font-mono);
        font-size: 9px;
        color: var(--ink-faint);
        white-space: nowrap;
      }

      .bo-row.is-on .bo-no,
      .bo-row.is-on .bo-fx {
        color: rgba(255, 255, 255, 0.78);
      }

      .bo-form {
        flex: none;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px 8px;
        padding: 9px 10px 10px;
        border-top: 1px solid var(--line);
      }

      .bo-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      .bo-field.is-wide {
        grid-column: 1 / -1;
      }

      .bo-field > span {
        font-family: var(--font-mono);
        font-size: 8px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .bo-field select {
        width: 100%;
        height: 22px;
        padding: 0 4px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: var(--bg-well);
        font: inherit;
        font-size: 10px;
        color: var(--ink);
        cursor: pointer;
      }

      .bo-field select:disabled {
        color: var(--ink-faint);
        cursor: default;
      }

      .bo-step {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 22px;
        padding: 0 2px 0 7px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: var(--bg-well);
      }

      .bo-step b {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--ink);
      }

      .bo-arrows {
        display: flex;
        flex: none;
        flex-direction: column;
      }

      .bo-arrows button {
        display: block;
        width: 15px;
        height: 9px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--ink-dim);
        font-size: 7px;
        line-height: 9px;
        cursor: pointer;
      }

      @media (hover: hover) {
        .bo-arrows button:hover {
          color: var(--ember-hot);
        }
      }

      /* the same box as the scene above it: a timeline wider than the thing it is
       timing reads as chrome rather than as part of the stage */

      .bo-transport {
        position: absolute;
        right: 16px;
        bottom: 12px;
        left: 16px;
        z-index: 6;
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-width: 640px;
        margin-inline: auto;
      }

      /* one lane per build, in build order. This is not a second drawing of the
       score — it is what schedule() returned, which is why editing Start moves it. */

      .bo-track {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 3px 0;
      }

      .bo-lane {
        position: relative;
        display: block;
        height: 3px;
        border-radius: 2px;
        background: rgba(var(--ink-rgb), 0.07);
      }

      .bo-bar {
        position: absolute;
        top: 0;
        height: 100%;
        min-width: 2px;
        border-radius: 2px;
        background: var(--steel);
        opacity: 0.5;
      }

      .bo-bar.is-on {
        background: linear-gradient(90deg, var(--ember), var(--copper));
        opacity: 1;
      }

      /* a relation, drawn: `with` hangs from the previous bar's start, `after` from
       its end. Faint on purpose — it is scaffolding, not content. */

      .bo-sync {
        position: absolute;
        z-index: 1;
        width: 1px;
        background: rgba(var(--ink-rgb), 0.28);
        pointer-events: none;
      }

      /* moved by a motion value, so the head repaints without a render */

      .bo-playhead {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        z-index: 2;
        width: 1px;
        /* ember, not white: white reads on the dark card and vanishes on the
         light one, and the head already wears an ember halo — one colour for
         the whole playhead, legible on either ground */
        background: var(--ember);
        box-shadow: 0 0 7px var(--glow);
        pointer-events: none;
      }

      .bo-playhead::after {
        content: '';
        position: absolute;
        top: -4px;
        left: -3.5px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--ember);
        box-shadow: 0 0 0 3px rgba(255, 59, 31, 0.26);
      }

      /* the real control, invisible over the drawing */

      .bo-range {
        /* A horizontal slider and a vertical scroll want the same gesture, and on a
         touch screen the scroller wins by default: the drag panned the page and
         the playhead never moved, so the timeline read as broken rather than as
         scrubbable. `none` hands the gesture to the control, which is the only
         thing on this row that a sideways drag could plausibly mean. */
        touch-action: none;

        position: absolute;
        inset: 0;
        z-index: 3;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        opacity: 0;
        cursor: ew-resize;
        -webkit-appearance: none;
        appearance: none;
        background: none;
      }

      .bo-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .bo-play {
        display: grid;
        flex: none;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1px solid var(--line-strong);
        border-radius: 7px;
        background: var(--bg-well);
        font: inherit;
        font-size: 9px;
        color: var(--ink);
        cursor: pointer;
      }

      .bo-clock {
        font-family: var(--font-mono);
        font-size: 9px;
        font-variant-numeric: tabular-nums;
        color: var(--ink-dim);
      }

      .bo-spacer {
        flex: 1 1 auto;
      }

      .bo-chip {
        flex: none;
        height: 22px;
        padding: 0 9px;
        border: 1px solid var(--line-strong);
        border-radius: 7px;
        background: var(--bg-well);
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-dim);
        cursor: pointer;
      }

      .bo-chip.is-on {
        border-color: var(--ember);
        color: var(--ember-hot);
      }

      @container (min-width: 620px) {
        .bo-split,
        .bo-transport {
          max-width: 740px;
        }

        .bo-split {
          grid-template-columns: minmax(0, 1fr) 244px;
          gap: 24px;
        }

        .bo-logo {
          width: min(100%, 340px);
          padding: 30px 24px 26px;
        }

        .bo-art {
          gap: 12px;
        }

        .bo-mark {
          width: min(136px, 30cqh);
        }

        .bo-word {
          font-size: clamp(20px, 7cqh, 34px);
        }

        .bo-rule-box {
          width: min(100%, 240px);
        }

        .bo-tag {
          font-size: clamp(8px, 2.4cqh, 11px);
        }
      }

      @container (max-width: 470px) {
        .bo-split {
          grid-template-columns: minmax(0, 1fr) 162px;
          gap: 10px;
        }

        .bo-fx {
          display: none;
        }

        .bo-logo {
          padding: 16px 12px 14px;
        }
      }

      .choreo-site:not([data-theme='light']) .bo-plate {
        background: linear-gradient(180deg, #322c27, #2a2521);
      }

      .choreo-site:not([data-theme='light']) .bo-field select {
        background: #25211d;
      }

      .choreo-site:not([data-theme='light']) .bo-step {
        background: #25211d;
      }

      .choreo-site:not([data-theme='light']) .bo-play {
        background: rgba(0, 0, 0, 0.22);
      }

      .choreo-site:not([data-theme='light']) .bo-chip {
        background: rgba(0, 0, 0, 0.22);
      }

      .choreo-site:not([data-theme='light']) .bo-panel {
        background: rgba(0, 0, 0, 0.22);
      }
    </style>
  </template>
}

export class BuildOrderDemo extends GalleryDemo {
  static stage = BuildOrder;
  static notes = BuildOrderNotes;
}
