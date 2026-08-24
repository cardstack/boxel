import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import { motionSpeed } from 'glimmer-motion';
import { motionValue } from 'motion-dom';
import { BEAD, HEAD, ORBIT, TAIL, TIP } from 'test-app/components/choreo-mark';
import {
  type Build,
  type Delivery,
  type EffectName,
  EFFECTS,
  effectsFor,
  type Glyph,
  type PartKind,
  partOf,
  PARTS,
  type Pose,
  poseAt,
  type Relation,
  runtimeOf,
  schedule,
  type Slot,
  slotOf,
  type Totals,
  totalsOf,
  wordsOf,
} from 'test-app/lib/builds';
import { preventSelect } from 'test-app/lib/pointer';

/* ── the score, as it opens ──────────────────────────────────────────────── */

/**
 * Nine builds, and not one absolute time among them.
 *
 * Read it the way you would read it aloud: the plate slides in, the comet's
 * tail draws with it, the head draws after the tail, the inner orbit sets off
 * WITH the head — two timelines now running in phase — the outer arrival
 * lands its bead, the inner one catches fire, then the wordmark comes after, character by character, with the
 * rule drawing under it and the tagline last. Every start time on the
 * timeline below is derived from that sentence. It is also the library
 * reciting itself: an arc is the line the engine draws between two
 * measurements, a bead is where an element is NOW, and two arcs held in
 * phase by 'with'/'after' is the whole meaning of the word choreography.
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

/** how long the finished logo is held before the loop comes round again */
const HOLD = 900;

/** the stepper's grain, in ms — 100 so a 1-decimal readout moves every click */
const STEP = 100;

/** the one slot a part with nothing to divide has */
const WHOLE: Slot = { i: 0, n: 1 };

/* ── one animated cell ───────────────────────────────────────────────────── */

/**
 * A part, or one glyph of one, as a bag of motion values.
 *
 * Values rather than `animate=`, for the same reason the Playhead demo's hand
 * is: a scrubbed frame is a still, and thirty-odd cells re-rendering sixty
 * times a second is not a frame budget. Every value here is `jump`ed, never
 * set — a sampled value has no history and must not leave a velocity behind.
 */
class Track {
  private blur = motionValue('none');
  // `round 20px` matches .bo-plate's own border-radius — inset() defaults to
  // square corners regardless of the element's actual radius, so left off,
  // the plate's two right corners get clipped flat by this at ANY progress,
  // including 0%, where the clip should be invisible. Barely showed on a
  // near-black plate against a near-black stage; a light stage behind a
  // light-mode plate makes the squared-off sliver obvious.
  private clip = motionValue('inset(0 0% 0 0 round 20px)');
  private o = motionValue(0);
  private path = motionValue(0);
  private rot = motionValue(0);
  private sc = motionValue(1);
  private tx = motionValue(0);
  private ty = motionValue(0);
  /** the pose last written, so a cell sitting still costs nothing */
  private was?: Pose;

  readonly style: Record<string, unknown>;

  constructor(kind: PartKind) {
    this.style = {
      filter: this.blur,
      opacity: this.o,
      rotate: this.rot,
      scale: this.sc,
      x: this.tx,
      y: this.ty,
    };
    // Bound where they mean something and nowhere else. `pathLength` is a
    // stroke's whole story; `clipPath` establishes a clip on everything it
    // touches, so it goes only where a Wipe can actually be asked for.
    //
    // `pathSpacing` is pinned at 2, and it is a bug fix, not a preference.
    // Motion renders a drawn path as `stroke-dasharray: length spacing`, and
    // the default spacing of 1 makes the pattern sum to ~1 when the drawn
    // length is near zero — which wraps a zero-length dash onto the path's
    // terminus, inside the browser's length tolerance, and a round linecap
    // paints that dash as a dot. The end of the line popped in the moment
    // the draw began. A gap of 2 keeps the second dash a whole path-length
    // away from the end at any drawn length.
    if (kind === 'stroke') {
      this.style['pathLength'] = this.path;
      this.style['pathSpacing'] = motionValue(2);
    }
    if (kind === 'box' || kind === 'text') {
      this.style['clipPath'] = this.clip;
    }
  }

  /**
   * Write the pose, skipping whatever has not moved.
   *
   * Thirty-odd cells, eight values each, sixty times a second — and for most
   * of the run nearly all of them are parked at either end of their build. The
   * comparison turns a frame into a handful of writes instead of a couple of
   * hundred, and it is only safe because a pose is recomputed from the score
   * rather than accumulated: equal input, equal output, nothing to drift.
   */
  jump(pose: Pose) {
    const was = this.was;
    if (!was || was.opacity !== pose.opacity) {
      this.o.jump(pose.opacity);
    }
    if (!was || was.rotate !== pose.rotate) {
      this.rot.jump(pose.rotate);
    }
    if (!was || was.scale !== pose.scale) {
      this.sc.jump(pose.scale);
    }
    if (!was || was.x !== pose.x) {
      this.tx.jump(pose.x);
    }
    if (!was || was.y !== pose.y) {
      this.ty.jump(pose.y);
    }
    if (!was || was.pathLength !== pose.pathLength) {
      this.path.jump(pose.pathLength);
    }
    if (!was || was.clip !== pose.clip) {
      this.clip.jump(
        `inset(0 ${(pose.clip * 100).toFixed(3)}% 0 0 round 20px)`
      );
    }
    if (!was || was.blur !== pose.blur) {
      // `none` rather than `blur(0px)`: a filter that is doing nothing still
      // makes the element its own containing block and its own raster layer
      this.blur.jump(
        pose.blur > 0.01 ? `blur(${pose.blur.toFixed(2)}px)` : 'none'
      );
    }
    this.was = pose;
  }
}

interface Cell {
  ch: string;
  style: Record<string, unknown>;
}

/* ── the demo ────────────────────────────────────────────────────────────── */

/**
 * A logo on the left, the build order that makes it on the right.
 *
 * The Playhead demo had two clocks and one score, and the interesting part was
 * keeping them honest with each other. This one has one clock, because a build
 * order is not a recording of what a user did — it is a description, and a
 * description can simply be evaluated at t. Play and scrub call the same
 * `poseAt`; the only difference between them is who is choosing the number.
 *
 * What that buys, and what the panel is here to show, is that the score is
 * EDITABLE while it runs. Change build 6 from After to With and every start
 * time downstream of it moves, because none of them was ever written down —
 * they are consequences of two words and a delay, resolved top to bottom. The
 * bars in the transport are the resolved answer, not a second copy of it.
 */
export class BuildOrder extends Component {
  @tracked builds: Build[] = OPENING.map((build) => ({ ...build }));
  @tracked loop = true;
  /** which row the inspector is editing */
  @tracked pick = 0;
  @tracked playing = false;
  /** the playhead, in ms */
  @tracked t = 0;

  /** every animated cell, by part — one for a shape, one per glyph for text */
  private tracks = new Map<string, Track[]>();
  /** the same cells flattened per text part, so a glyph can find its slot */
  private glyphs = new Map<string, Glyph[]>();
  private totals = new Map<string, Totals>();

  /** the transport's own values, painted on the same frame as the scene */
  private headX = motionValue(0);

  private stage?: HTMLElement;
  private railW = 0;
  private watcher?: ResizeObserver;
  private viewport?: IntersectionObserver;
  private raf = 0;
  private last = 0;
  /** true once a hand has stopped the run, after which it stays stopped */
  private held = false;

  /** the wordmark and the tagline, as rows of words of glyph cells */
  readonly rows = new Map<string, Cell[][]>();

  constructor(owner: Owner, args: object) {
    super(owner, args);
    for (const part of PARTS) {
      if (part.kind !== 'text') {
        this.tracks.set(part.name, [new Track(part.kind)]);
        continue;
      }
      const words = wordsOf(part.text!);
      const list: Track[] = [];
      const flat: Glyph[] = [];
      this.rows.set(
        part.name,
        words.map((run) =>
          run.map((glyph) => {
            const track = new Track('text');
            list.push(track);
            flat.push(glyph);
            return { ch: glyph.ch, style: track.style };
          })
        )
      );
      this.tracks.set(part.name, list);
      this.glyphs.set(part.name, flat);
      this.totals.set(part.name, totalsOf(words));
    }
  }

  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
    this.watcher?.disconnect();
    this.viewport?.disconnect();
  }

  /* — the resolved timeline — */

  @cached
  get cues() {
    return schedule(this.builds);
  }

  get runtime() {
    return runtimeOf(this.cues, HOLD);
  }

  /* — measuring — */

  register = modifier((el: HTMLElement) => {
    this.stage = el;
    this.watcher = new ResizeObserver(() => {
      this.measure();
      this.paint();
    });
    this.watcher.observe(el);
    // A logo animation that has to be started is a logo animation nobody
    // sees, so this one runs itself — but only while it is being looked at.
    // Twenty-six demos live in the gallery, and the frames belong to whichever
    // of them is on screen. Off screen the playhead stops where it was; back
    // on screen it carries on, unless a hand has paused it since.
    this.viewport = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.resume();
        } else {
          this.halt();
        }
      },
      { threshold: 0.35 }
    );
    this.viewport.observe(el);
    this.measure();
    this.paint();
    return () => {
      this.watcher?.disconnect();
      this.viewport?.disconnect();
      this.watcher = undefined;
      this.viewport = undefined;
      this.stage = undefined;
    };
  });

  private measure() {
    this.railW =
      this.stage?.querySelector<HTMLElement>('.bo-track')?.clientWidth ?? 0;
  }

  /* — the one reading — */

  /**
   * The whole scene at `this.t`.
   *
   * One pass over the cues, one `poseAt` per cell, no DOM read and no memory
   * of the frame before. Called from the run loop and from the scrubber and
   * from an edit to the score, and it cannot tell which.
   */
  private paint = () => {
    const t = this.t;
    for (const cue of this.cues) {
      const list = this.tracks.get(cue.part)!;
      if (list.length === 1) {
        list[0]!.jump(poseAt(t, cue, WHOLE));
        continue;
      }
      const flat = this.glyphs.get(cue.part)!;
      const totals = this.totals.get(cue.part)!;
      for (let i = 0; i < list.length; i += 1) {
        list[i]!.jump(poseAt(t, cue, slotOf(flat[i]!, cue.by, totals)));
      }
    }
    this.headX.jump((t / this.runtime) * this.railW);
  };

  sty = (name: string) => this.tracks.get(name)![0]!.style;

  /** the nav mark's geometry, worn here at stage size */
  tailD = TAIL;
  headD = HEAD;
  orbitD = ORBIT;
  tipD = TIP;
  bead = BEAD;

  get wordRows() {
    return this.rows.get('word')!;
  }

  get tagRows() {
    return this.rows.get('tag')!;
  }

  get head() {
    return { x: this.headX };
  }

  /* — transport — */

  /**
   * Ticks on its own frame, by a clamped delta.
   *
   * Not `now - startedAt`: any gap — a background tab, a gallery painting
   * twenty-six demos — and the next frame teleports the playhead to wherever
   * the wall clock got to, which looks exactly like the run never played. A
   * late frame costs the score 50ms and no more.
   *
   * The clamp is real wall-clock time; `motionSpeed()` is applied AFTER it, so
   * the transport's own speed picker (Full · ÷2 · ÷5 · ÷10, gated by
   * `slowmo` in the catalog) slows this the same way it slows every
   * `{{motion transition=…}}` on the page — the score is unchanged, only how
   * much of it a real second covers.
   */
  private advance = (now: number) => {
    const runtime = this.runtime;
    let t = this.t + Math.min(now - this.last, 50) / motionSpeed();
    this.last = now;
    if (t >= runtime) {
      if (!this.loop) {
        this.t = runtime;
        this.paint();
        // the run is over rather than interrupted, so scrolling past and back
        // must not quietly start it again
        this.held = true;
        this.halt();
        return;
      }
      // wrap by subtraction rather than by zeroing, so the loop does not lose
      // the overshoot and drift a frame slower every time round
      t -= runtime * Math.floor(t / runtime);
    }
    this.t = t;
    this.paint();
    this.raf = requestAnimationFrame(this.advance);
  };

  /** start the loop again on the demo's own initiative, never over a hand */
  private resume() {
    if (this.held || this.playing) {
      return;
    }
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.advance);
  }

  private halt() {
    if (this.playing) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.playing = false;
    }
  }

  toggle = () => {
    if (this.playing) {
      this.held = true;
      this.halt();
      return;
    }
    this.held = false;
    if (this.t >= this.runtime - 1) {
      this.t = 0;
      this.paint();
    }
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.advance);
  };

  /**
   * Scrubbing pauses — not because it has to, but because a hand on the
   * playhead has claimed the clock. The scene is a function of t either way;
   * the only question is who supplies the number, and two suppliers at once
   * is a tug of war. `held` too, so scrolling away and back does not quietly
   * restart what a hand stopped.
   */
  scrub = (event: Event) => {
    this.held = true;
    this.halt();
    this.t = Number((event.target as HTMLInputElement).value);
    this.paint();
  };

  rewind = () => {
    this.halt();
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
   * The score is replaced rather than mutated so `cues` recomputes, and the
   * playhead is repainted at the SAME t against the new schedule — which is
   * what makes an edit feel like editing rather than like restarting. Retiming
   * build 2 while parked at 1.4s shows you what 1.4s now looks like.
   */
  private edit(patch: Partial<Build>) {
    this.builds = this.builds.map((build, i) =>
      i === this.pick ? { ...build, ...patch } : build
    );
    if (this.t > this.runtime) {
      this.t = this.runtime;
    }
    this.paint();
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

  /**
   * The sync marks: one faint vertical line per relation, drawn at the moment
   * a build's start was derived FROM — the previous build's start for `with`,
   * its end for `after`. The line is the anchor; the gap between the line and
   * the bar to its right is the delay, made visible.
   */
  @cached
  get links() {
    const runtime = this.runtime;
    return this.cues.slice(1).map((cue, i) => {
      const prev = this.cues[i]!;
      const at = cue.start === 'with' ? prev.at : prev.end;
      return {
        index: i,
        // lane geometry mirrored from .bo-track: 3px pad, 3px lane, 2px gap —
        // the line runs from the previous lane's centre to this one's
        style: htmlSafe(
          `left:${((at / runtime) * 100).toFixed(3)}%;` +
            `top:${(4.5 + i * 5).toFixed(1)}px;height:5px`
        ),
      };
    });
  }

  @cached
  get lanes() {
    const runtime = this.runtime;
    return this.cues.map((cue, index) => ({
      index,
      on: index === this.pick,
      style: htmlSafe(
        `left:${((cue.at / runtime) * 100).toFixed(3)}%;` +
          `width:${((cue.ms / runtime) * 100).toFixed(3)}%`
      ),
    }));
  }

  @cached
  get list() {
    return this.cues.map((cue, index) => ({
      effect: EFFECTS[cue.effect]!.label,
      index,
      label: partOf(cue.part).label,
      no: cue.no,
      on: index === this.pick,
    }));
  }

  @cached
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

  get clock() {
    return `${(this.t / 1000).toFixed(2)} / ${(this.runtime / 1000).toFixed(2)}s`;
  }

  <template>
    <div
      class="ex bo-stage no-select"
      {{this.register}}
      {{on "selectstart" preventSelect}}
    >
      <div class="bo-split">

        {{! ── the logo ───────────────────────────────────────────────── }}
        <div class="bo-canvas">
          <div class="bo-logo">
            {{! the box that moves: a plate the mark is built on }}
            <div
              class="bo-plate"
              data-part="plate"
              {{motion style=(this.sty "plate")}}
            ></div>

            <div class="bo-art">
              {{! the mark itself, from the same exported geometry the top
                  bar renders — two strokes that draw, one bead that pops }}
              <svg class="bo-mark" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  class="bo-tail"
                  d={{this.tailD}}
                  data-part="tail"
                  {{motion style=(this.sty "tail")}}
                />
                <path
                  class="bo-head"
                  d={{this.headD}}
                  data-part="head"
                  {{motion style=(this.sty "head")}}
                />
                <circle
                  class="bo-bead"
                  cx="{{this.bead.cx}}"
                  cy="{{this.bead.cy}}"
                  r="{{this.bead.r}}"
                  data-part="bead"
                  {{motion style=(this.sty "bead")}}
                />
                <path
                  class="bo-orbit"
                  d={{this.orbitD}}
                  data-part="orbit"
                  {{motion style=(this.sty "orbit")}}
                />
                <path
                  class="bo-tip"
                  d={{this.tipD}}
                  data-part="tip"
                  {{motion style=(this.sty "tip")}}
                />
              </svg>

              {{! text, one span per glyph — the delivery decides whether they
                  share a window or divide it }}
              <p class="bo-word" data-part="word">
                {{#each this.wordRows key="@index" as |run|}}
                  <span class="bo-run">
                    {{#each run key="@index" as |cell|}}
                      <span
                        class="bo-cell"
                        {{motion style=cell.style}}
                      >{{cell.ch}}</span>
                    {{/each}}
                  </span>
                {{/each}}
              </p>

              <svg
                class="bo-rule-box"
                viewBox="0 0 220 3"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  class="bo-rule"
                  d="M1.5 1.5H218.5"
                  vector-effect="non-scaling-stroke"
                  data-part="rule"
                  {{motion style=(this.sty "rule")}}
                />
              </svg>

              <p class="bo-tag" data-part="tag">
                {{#each this.tagRows key="@index" as |run|}}
                  <span class="bo-run">
                    {{#each run key="@index" as |cell|}}
                      <span
                        class="bo-cell"
                        {{motion style=cell.style}}
                      >{{cell.ch}}</span>
                    {{/each}}
                  </span>
                {{/each}}
              </p>
            </div>
          </div>
        </div>

        {{! ── the inspector ──────────────────────────────────────────── }}
        <div class="bo-panel">
          <p class="bo-panel-head">Build Order</p>

          <ol class="bo-list">
            {{#each this.list key="index" as |row|}}
              <li>
                <button
                  type="button"
                  class={{if row.on "bo-row is-on" "bo-row"}}
                  {{on "click" (fn this.select row.index)}}
                >
                  <span class="bo-no">{{row.no}}</span>
                  <span class="bo-name">{{row.label}}</span>
                  <span class="bo-fx">{{row.effect}}</span>
                </button>
              </li>
            {{/each}}
          </ol>

          <div class="bo-form">
            <label class="bo-field is-wide">
              <span>Effect</span>
              <select {{on "change" this.setEffect}}>
                {{#each this.effectOptions key="name" as |opt|}}
                  <option
                    value={{opt.name}}
                    selected={{opt.on}}
                  >{{opt.label}}</option>
                {{/each}}
              </select>
            </label>

            <label class="bo-field is-wide">
              <span>Start</span>
              {{#if this.first}}
                {{! build 1 has no build above it, so Keynote's only offer is
                    the run's own zero — and so is ours }}
                <select disabled>
                  <option>On Click</option>
                </select>
              {{else}}
                <select {{on "change" this.setStart}}>
                  {{#each this.startOptions key="name" as |opt|}}
                    <option
                      value={{opt.name}}
                      selected={{opt.on}}
                    >{{opt.label}}</option>
                  {{/each}}
                </select>
              {{/if}}
            </label>

            <div class="bo-field">
              <span>Delay</span>
              <div class="bo-step">
                <b>{{this.delayText}}</b>
                <span class="bo-arrows">
                  <button
                    type="button"
                    aria-label="More delay"
                    {{on "click" (fn this.nudgeDelay 1)}}
                  >▴</button>
                  <button
                    type="button"
                    aria-label="Less delay"
                    {{on "click" (fn this.nudgeDelay -1)}}
                  >▾</button>
                </span>
              </div>
            </div>

            <div class="bo-field">
              <span>Duration</span>
              <div class="bo-step">
                <b>{{this.msText}}</b>
                <span class="bo-arrows">
                  <button
                    type="button"
                    aria-label="Longer"
                    {{on "click" (fn this.nudgeMs 1)}}
                  >▴</button>
                  <button
                    type="button"
                    aria-label="Shorter"
                    {{on "click" (fn this.nudgeMs -1)}}
                  >▾</button>
                </span>
              </div>
            </div>

            {{#if this.isText}}
              <label class="bo-field is-wide">
                <span>Delivery</span>
                <select {{on "change" this.setBy}}>
                  {{#each this.deliveryOptions key="name" as |opt|}}
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
      <div class="bo-transport">
        <div class="bo-track">
          {{! one lane per build: the resolved schedule, drawn. It is not a
              second copy of the score — it is what `schedule()` returned. }}
          {{#each this.lanes key="index" as |lane|}}
            <span class="bo-lane">
              <i
                class={{if lane.on "bo-bar is-on" "bo-bar"}}
                style={{lane.style}}
              ></i>
            </span>
          {{/each}}
          {{! the with/after relations, drawn: each line hangs from the moment
              the build below it is timed against }}
          {{#each this.links key="index" as |link|}}
            <i class="bo-sync" style={{link.style}}></i>
          {{/each}}
          <span class="bo-playhead" {{motion style=this.head}}></span>
          {{! a real range input, transparent over the drawing: keyboard scrub
              and a11y for free }}
          <input
            type="range"
            class="bo-range"
            min="0"
            max={{this.runtime}}
            step="1"
            value={{this.t}}
            aria-label="Playhead"
            {{on "input" this.scrub}}
          />
        </div>

        <div class="bo-controls">
          <button
            type="button"
            class="bo-play"
            aria-label={{if this.playing "Pause" "Play"}}
            {{on "click" this.toggle}}
          >
            {{#if this.playing}}
              {{! lucide "pause" }}
              <svg class="tp-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="14" y="3" width="5" height="18" rx="1" />
                <rect x="5" y="3" width="5" height="18" rx="1" />
              </svg>
            {{else}}
              {{! lucide "play" }}
              <svg class="tp-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
                />
              </svg>
            {{/if}}
          </button>
          <span class="bo-clock">{{this.clock}}</span>
          <span class="bo-spacer"></span>
          <button
            type="button"
            class={{if this.loop "bo-chip is-on" "bo-chip"}}
            aria-pressed="{{this.loop}}"
            {{on "click" this.toggleLoop}}
          >Loop</button>
          <button
            type="button"
            class="bo-chip"
            {{on "click" this.rewind}}
          >Reset</button>
        </div>
      </div>
    </div>
  </template>
}
