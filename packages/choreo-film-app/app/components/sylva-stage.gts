import { at, Choreo, type PerformCommand } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { cameraCss, objectCss, perspective } from 'choreo-film-app/lib/css3d';
import { tuneNumber } from 'choreo-film-app/lib/tuning';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import {
  createSylva,
  type Sylva,
  type SylvaAnchor,
} from '../../vendor/sylva-scene';

/**
 * Sylva's living world, full frame: the film app's third film. The gallery's
 * Sylva card shows a poster in the grid and mounts this, in its own document,
 * on the demo page and in theater.
 *
 * The other spatial demos put DOM behind ONE hole, in a plane that belongs to
 * the model: the phone's display, the laptop's screen. Both get their
 * occlusion free, because the mesh that hides the DOM was already in the GLB
 * and already in front. Sylva does the three things those cannot:
 *
 *   1. A FREE-FLOATING card — anchored to a point in a scene rather than
 *      inherited from a model — with a hole-punch proxy we author. See
 *      `anchor()` in the scene: a `NoBlending` plane at the card's pose, which
 *      is ordinary depth-tested geometry, so moss standing nearer the camera
 *      hides the card exactly where it should.
 *   2. SEVERAL at once, which needs depth ordering the browser will not do.
 *      The cards live under the canvas, so what shows through each hole is
 *      whichever DOM node is on top — paint order has to match view depth or a
 *      far card draws over a near one.
 *   3. INPUT, which the depth buffer does not touch either way. An occluded
 *      card still receives pointer events, because the DOM knows nothing about
 *      what is drawn over it. `swallow` below asks the scene first.
 *
 * The scene is Sylva's living world, vendored in `lib/sylva/scene.ts` and
 * picked for its geometry rather than its looks: a moss root with an arch and
 * a hollow is a shape that can stand IN FRONT of a card. A flat backdrop could
 * not test occlusion at all.
 */

interface Spot {
  /**
   * Where on the root, as a FRACTION of its measured box: [along, up, out].
   * The artwork's own landmarks are written this way — crest at 25% of the
   * width, valley at 50%, apex at 73% — so a hotspot is described in the same
   * terms the composition was, and the numbers survive a reflow.
   */
  at: [number, number, number];
  blurb: string;
  /** what a visit to this hotspot frames */
  camera: { dolly: number; pitch: number; x: number; y: number; yaw: number };
  /**
   * THE FIELD ACTION — not a note. Each card carries one trigger that makes
   * something happen in the world: the moth is flushed, the spores loosed,
   * the moss parted, the song heard. 'song' is the stage's own (WebAudio);
   * the rest are scene cues.
   */
  cue: { kind: 'breeze' | 'burst' | 'flight' | 'song'; label: string };
  id: string;
  kind: string;
  name: string;
  /**
   * Where the card sits relative to its pin, in camera-space pixels — right
   * and UP.
   *
   * A BALANCE, and the first pass had it wrong in both directions. Centred on
   * the pin, the card covers the thing it names and hangs off the bottom of
   * the frame. Lifted clear into the sky, it is perfectly readable and proves
   * nothing — there is no geometry up there to occlude it, which is the one
   * claim this route exists to make. So the offset lifts it far enough to read
   * and no further: the head of the card is in open air, the foot of it is
   * still over the moss.
   */
  off: [number, number];
  /** the voice-over line — what the narrator says while this card reads */
  story: string;
  /**
   * The plane's orientation in the scene, degrees.
   *
   * The near pair point roughly at the viewer; the far pair point roughly
   * AWAY, so their reading poses — derived from the normal by
   * `anchor.shot()` — stand behind the tree. That is deliberate: the fern
   * and the wren are read from round the back, which is what makes their
   * legs of the tour a real journey around the arch rather than a peek
   * through it. An earlier pass tried this and gave up because the pan took
   * the long way round the front between the two back cards and arrived
   * with the card off frame — that was a yaw-wrapping bug in the flight,
   * not a fault of the orientation, and `legs` unwraps yaw now.
   */
  tilt: [number, number, number];
}

/**
 * Four, and their placement is the experiment.
 *
 * Two sit in FRONT of the arch and two BEHIND it, because a card that is never
 * occluded proves nothing: the far pair are the ones that have to disappear
 * behind the root as the camera comes round and return when it carries on, and
 * the near pair are the control that says the difference is the geometry
 * rather than the code.
 *
 * `at` IS A POINT ON THE LIMB'S OWN CENTRELINE. The root is swept along a list
 * of artwork fractions — `[0.25, 0.566, 0.34]` is the crest, `[0.5, 0.779,
 * -0.28]` the valley — and these are lifted straight off that list, so a
 * hotspot is on the wood by construction rather than by tuning. The two with a
 * NEGATIVE z sit on the far side of the arch: those are the occlusion test,
 * and the two positive ones are the control.
 */
const SPOTS: Spot[] = [
  {
    // the crest at 25% — front of the arch, so the card is never occluded
    at: [0.25, 0.566, 0.34],
    blurb: 'Feeding on the moss crest, wings folded. Two seen this week.',
    // wider than the other reads, and framed a touch high: the butterfly
    // lives in the air over the crest, and scene 1 must show it
    camera: { dolly: 0.84, pitch: 7, x: 0.06, y: 0.05, yaw: -13 },
    cue: { kind: 'flight', label: 'Flush the moth' },
    id: 'moth',
    kind: 'Insect',
    name: 'Green oak moth',
    off: [175, 95],
    story: 'First light on the crest, and the moths come up to feed.',
    tilt: [0, -22, 0],
  },
  {
    at: [0.696, 0.661, 0.2],
    blurb: 'Fruiting bodies along the south flank, after rain.',
    camera: { dolly: 0.72, pitch: 3, x: -0.08, y: -0.05, yaw: 15 },
    // a hand swept through the moss: the sway radius flares and a wide
    // gust runs the length of the flank
    cue: { kind: 'breeze', label: 'Run a hand through' },
    id: 'cup',
    kind: 'Fungus',
    name: 'Scarlet elf cup',
    off: [-175, 92],
    story: 'After rain the south flank blooms scarlet — for a week, no more.',
    tilt: [0, 20, 0],
  },
  {
    // the valley at 50%, BEHIND the arch — turned away, so its reading
    // pose is behind the tree and the tour goes round to it
    at: [0.5, 0.779, -0.28],
    blurb: 'In the hollow under the arch, where the light does not reach.',
    // the camera ducks LOW and looks up into the hollow — level with the
    // wood, the crest lies straight across the panel
    // pedestal well negative: the card rides high in frame, clear of
    // the touring controls along the bottom edge
    camera: { dolly: 0.68, pitch: -13, x: 0.04, y: -0.12, yaw: 27 },
    // spores, not a gust: from this low back angle a parting of the moss
    // happens out of frame, and a thing you cannot see is not an action
    cue: { kind: 'burst', label: 'Loose the spores' },
    id: 'fern',
    kind: 'Plant',
    name: 'Hart’s-tongue fern',
    off: [55, -150],
    story:
      'Under the arch, where the light never follows, the hart’s-tongue holds on.',
    tilt: [0, 172, 0],
  },
  {
    // far right and behind — the second back-of-the-tree read. No truck
    // correction any more: the orbit is centred on the card itself.
    at: [0.93, 0.626, -0.3],
    blurb: 'Behind the crest. Only audible, most days.',
    camera: { dolly: 0.82, pitch: 4, x: -0.02, y: -0.03, yaw: -30 },
    cue: { kind: 'song', label: 'Hear the song' },
    id: 'wren',
    kind: 'Bird',
    name: 'Wren',
    off: [-140, 96],
    story: 'Round the back of the crest — heard long before it is ever seen.',
    tilt: [0, -168, 0],
  },
];

/**
 * THE ESTABLISHING SHOT, and everything starts here.
 *
 * `y` is a pedestal: raising the camera drops the subject in frame, so a
 * NEGATIVE value lifts the root up off the bottom edge. The scene was
 * composed for a landing page, where the root hugs the floor and the
 * headline sits in the sky above it — inherited unchanged that reads as a
 * picture that has slid out of frame, with every card pushed down after it.
 *
 * Wide, and held, before anything flies anywhere: a tour that opens mid-close-up
 * is a tour that never shows you what you are looking at. Wider than the
 * landing page framed it, on purpose — the film OPENS here, and the first
 * leg's dive into the moth card is the establishing zoom.
 */
const REST = { dolly: 1.34, pitch: 4, x: 0, y: -0.12, yaw: 0 };

/**
 * How far the reading pan travels, either side of the square-on pose.
 *
 * Degrees of yaw and a sliver of truck and dolly: enough that the shot is
 * visibly alive for the whole read, small enough that the card stays well
 * within its readable cone — the pan crosses the pose the shot was derived
 * for, so mid-read the card is exactly square.
 */
const SWING = { dolly: 0.05, x: 0.018, yaw: 7 } as const;

const CONTENT = { bounce: 0, type: 'spring', visualDuration: 0.3 } as const;

/** the card's own radius, shared with the hole so the corners agree */
const CARD_R = 14;

const CARD_W = 260;
const CARD_H = 168;

export class SylvaStage extends Component {
  @tracked status = 'growing the roots…';
  @tracked open: string | null = null;
  /** the pose the camera is actually at; Choreo writes it, the pointer writes it */
  @tracked pose = { ...REST };
  /** the tour runs itself until somebody takes the camera */
  @tracked playing = true;
  /**
   * Draw the scene's own dot at every anchor. Off by default, on with `?check`
   * — two projections agreeing is a thing to prove once and then stop paying
   * for, not a permanent feature.
   */
  @tracked checking =
    typeof location !== 'undefined' && /[?&]check\b/.test(location.search);
  /**
   * `?film` strips the controls: nothing on screen but the world and the
   * words — the frame the choreo player exports. The narration stays; it is
   * part of the picture, not part of the chrome.
   */
  readonly film =
    typeof location !== 'undefined' && /[?&]film\b/.test(location.search);
  /**
   * The spot the narration is still speaking about. Deliberately not `open`:
   * between one card closing and the next presenting, the camera is
   * travelling and the lower-third should hold its line rather than flash
   * the series title in every gap. It clears when the tour goes home.
   */
  @tracked private told: string | null = null;
  /** one viewing pose per card, derived after the scene is built */
  @tracked shots: {
    dolly: number;
    id: string;
    pitch: number;
    x: number;
    y: number;
    yaw: number;
  }[] = [];

  /** bumped to send the film round again — see `lapName` */
  @tracked private lap = 0;

  /**
   * The sequence's name, and the whole looping mechanism.
   *
   * The score is finite, so going round again is an EDITED timeline rather
   * than a repeat: changing the name changes what the region fingerprints, it
   * sees a score it has not played, and it replays from the top. That is the
   * same path an interruption takes, which is the point — there is no second
   * code path for "start over" to drift out of step with.
   */
  private get lapName() {
    return `tour-${this.lap}`;
  }

  readonly spots = SPOTS;

  private sylva?: Sylva;
  private raf = 0;
  private anchors = new Map<string, SylvaAnchor>();
  /**
   * THE ORBIT'S CENTRE, and it is host state, not score state.
   *
   * Choreo's `Camera3DState` is five numbers, and the look target is a point
   * in the scene — so it rides beside the score rather than in it: `look`
   * Perform cues (and a press on a dot) set the GOAL, and the render loop
   * eases the actual centre toward it, so a retarget is a slow re-aim rather
   * than a cut. Plain fields on purpose: they are written during the
   * region's own dispatch, where a tracked write would replay the pass and
   * cancel the run doing the dispatching.
   */
  private lookGoal = { x: 0, y: 0, z: 0 };
  private lookNow = { x: 0, y: 0, z: 0 };
  /** each card's own point, kept once the anchors exist */
  private lookOf = new Map<string, { x: number; y: number; z: number }>();
  private lastTick = 0;

  /**
   * THE CHASED POSE — Drift's chase camera, wearing this route's clothes.
   *
   * `pose` is what the SCORE says (and what a hand writes): the target. What
   * the lens actually stands at is `poseNow`, integrated toward the target
   * every frame by a critically-damped spring that carries VELOCITY as
   * state — `lib/drift.ts`'s doctrine, "a score for the scene change, a
   * loop for the simulation." This is what finally makes the camera unable
   * to stop: a chain of tweens has a velocity of zero at every seam unless
   * every ease is hand-matched, but a chaser's momentum crosses the seam by
   * construction — each boundary is rounded over the spring's own settle
   * (~half a second) instead of by curve arithmetic. It also swallows any
   * snap a lap restart or an interruption would otherwise produce: however
   * the target jumps, the lens only ever curves after it.
   */
  /**
   * TWO STAGES, because one is not smooth enough. A single spring chasing
   * a goal is C1: velocity crosses every seam, but ACCELERATION snaps the
   * moment the goal moves — the frame does not stop, it flinches. Feeding
   * the first stage's output to a second spring bounds the jerk as well:
   * stage two only ever sees a target that is already curving, so the lens
   * gets second- and third-derivative smoothing — the thing a dolly's mass
   * and a fluid head's damping do on a physical rig, done here with forty
   * lines of state instead of iron.
   */
  private poseMid = { ...REST };
  private poseMidV = { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 };
  private poseNow = { ...REST };
  private poseVel = { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 };

  /** a hand on the camera must not lag behind itself: snap both stages */
  private snapPose() {
    Object.assign(this.poseMid, this.pose);
    Object.assign(this.poseNow, this.pose);
    for (const k of ['dolly', 'pitch', 'x', 'y', 'yaw'] as const) {
      this.poseMidV[k] = 0;
      this.poseVel[k] = 0;
    }
  }

  /** the look centre gets the same cascade — its goal is a step function
   * (a cue simply names a new card), which is the WORST case for a single
   * stage: the jump lands straight in the acceleration */
  private lookMid = { x: 0, y: 0, z: 0 };
  private lookMidV = { x: 0, y: 0, z: 0 };
  private lookNowV = { x: 0, y: 0, z: 0 };

  /**
   * One cascaded chase step: goal → stage one → stage two, each stage a
   * critically-damped spring (c = 2ω) integrating velocity as state.
   */
  private chase2<K extends string>(
    goal: Record<K, number>,
    m: Record<K, number>,
    mv: Record<K, number>,
    o: Record<K, number>,
    ov: Record<K, number>,
    w1: number,
    w2: number,
    dt: number,
    keys: readonly K[]
  ) {
    for (const k of keys) {
      mv[k] += (w1 * w1 * (goal[k] - m[k]) - 2 * w1 * mv[k]) * dt;
      m[k] += mv[k] * dt;
      ov[k] += (w2 * w2 * (m[k] - o[k]) - 2 * w2 * ov[k]) * dt;
      o[k] += ov[k] * dt;
    }
  }
  private cardEls = new Map<string, HTMLElement>();
  private pinEls = new Map<string, HTMLElement>();
  /** each card's entrance, integrated by the host: 0 on the pin, 1 seated */
  private entry = new Map<string, { e: number; v: number }>();
  /** the loop's dt, for the entrance springs in placeCards */
  private frameDt = 0;
  private camEl?: HTMLElement;
  private cssEl?: HTMLElement;
  private pinCamEl?: HTMLElement;
  private pinCssEl?: HTMLElement;
  private heroEl?: HTMLElement;

  /**
   * Built on the second frame after mount, as the original does it: growing
   * two roots and compiling their shaders costs a few hundred milliseconds of
   * main thread, and doing it synchronously during insertion means the route
   * commits with a frozen tab and nothing on screen to say why.
   */
  private stage = modifier((el: HTMLElement) => {
    this.heroEl = el;
    const canvas = el.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    let live = true;
    const boot = () => {
      if (!live) {
        return;
      }
      try {
        const sylva = createSylva({
          blades: 45000,
          canvas,
          hero: el,
        });
        sylva.build();
        sylva.reveal();
        for (const spot of SPOTS) {
          const anchor = sylva.anchorOn(
            ...spot.at,
            CARD_W,
            CARD_H,
            ...spot.off,
            CARD_R,
            spot.tilt
          );
          anchor.check(this.checking);
          this.anchors.set(spot.id, anchor);
        }
        /**
         * THE TOUR IS BUILT FROM THE CARDS, not written alongside them.
         *
         * Each panel is fixed in the world and readable from one side, so the
         * shot that reads it is a fact about the panel — `anchor.shot()` takes
         * yaw and pitch straight off its normal. Hand-authoring four poses to
         * match four planes is the kind of duplication that is correct on the
         * day it is written and wrong the first time a hotspot moves.
         *
         * These are the READING poses. The sweep swings a few degrees either
         * side of each (`legs`) so the pan crosses square-on mid-read, and a
         * press on a dot flies to the same pose — one place per card, however
         * you got there.
         */
        this.shots = SPOTS.map((spot) => {
          const a = this.anchors.get(spot.id)!;
          const base = a.shot(spot.camera.dolly);
          /**
           * The derived pose gets the camera SQUARE to the card and the
           * orbit centred ON it — `base.look` is the card's own point, held
           * per spot for the look cues. `camera.x/y` then nudges the framing
           * in view space, because dead-centre is not the same as
           * well-composed; the nudges are small now, since the aiming is the
           * target's job rather than theirs.
           */
          this.lookOf.set(spot.id, base.look);
          return {
            id: spot.id,
            dolly: base.dolly,
            /* the pitch nudge is how a shot ducks under or looks over the
               limb between it and the card — see the fern */
            pitch: base.pitch + spot.camera.pitch,
            yaw: base.yaw,
            x: base.x + spot.camera.x,
            y: base.y + spot.camera.y,
          };
        });
        this.sylva = sylva;
        this.status = '';
        /**
         * `?poster` arms the tile-photograph hook: freeze a frame, scale
         * it down, hand back a webp data URL. A dev tool, not a feature —
         * it is how `public/sylva-poster.webp` gets refreshed when the
         * world changes.
         */
        if (/[?&]poster\b/.test(location.search)) {
          (window as unknown as { __poster?: () => string }).__poster = () => {
            /* a hidden tab has never run a frame, and pumping the loop
                 back-to-back advances almost nothing — dt is real elapsed
                 time, capped not floored. So the pump borrows the clock:
                 50ms per call, four hundred calls, twenty simulated
                 seconds — the reveal scan completes and the moss is grown
                 before the shot. */
            const realNow = performance.now.bind(performance);
            let fake = realNow();
            performance.now = () => (fake += 50);
            try {
              for (let i = 0; i < 400; i++) {
                sylva.renderFrame();
              }
            } finally {
              performance.now = realNow;
            }
            /* a photograph is POSED: stand the lens at the elf cup's own
               reading shot, close enough that the blades and bark carry */
            const rich = this.shots.find((sh) => sh.id === 'cup');
            const richLook = this.lookOf.get('cup');
            if (rich && richLook) {
              sylva.pose({ ...rich, dolly: rich.dolly * 0.95, look: richLook });
            }
            sylva.renderFrame();
            const out = document.createElement('canvas');
            const w = 1200;
            out.width = w;
            out.height = Math.round((canvas.height / canvas.width) * w);
            const g = out.getContext('2d')!;
            /* the sky is the PAGE's — the canvas itself is alpha */
            g.fillStyle = '#4a4d44';
            g.fillRect(0, 0, out.width, out.height);
            g.drawImage(canvas, 0, 0, out.width, out.height);
            return out.toDataURL('image/webp', 0.8);
          };
        }
        this.loop();
      } catch (err) {
        this.status = `the scene did not come up: ${String(err)}`;

        console.error(err);
      }
    };
    let kicked = false;
    const kick = () => {
      if (!kicked) {
        kicked = true;
        boot();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(kick));
    /* a capture tab may be BACKGROUND, where rAF never fires at all — the
       poster hook needs the scene regardless, so ?poster adds a timer */
    if (/[?&]poster\b/.test(location.search)) {
      setTimeout(kick, 800);
    }

    const onResize = () => this.sylva?.layout();
    window.addEventListener('resize', onResize);

    return () => {
      live = false;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(this.raf);
      this.anchors.forEach((a) => a.dispose());
      this.anchors.clear();
      this.sylva?.dispose();
      this.sylva = undefined;
    };
  });

  /**
   * One rAF, and nothing else may drive a frame.
   *
   * Stated as a rule because breaking it has a cost that is not the usual
   * cost: a scene of this weight rendered in a tight loop is not a slow page,
   * it is a wedged GPU. `document.hidden` is checked for the same reason —
   * a route nobody is looking at should not be drawing forty thousand blades
   * of moss.
   */
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) {
      return;
    }
    const sylva = this.sylva;
    if (!sylva) {
      return;
    }
    /**
     * The look centre chases its goal on a real clock, not a frame count —
     * capped so a starved tab does not teleport the aim on its first frame
     * back. ~2.6/s puts it substantially there inside an approach's 2.4s,
     * which is the point: the re-aim IS part of the approach.
     */
    const now = performance.now();
    const dt = Math.min(0.1, this.lastTick ? (now - this.lastTick) / 1000 : 0);
    this.lastTick = now;
    this.frameDt = dt;
    /**
     * The pose and the aim both CHASE the score rather than obeying it —
     * two cascaded critically-damped stages each (see `poseMid`), so the
     * lens carries velocity through every seam and bends, never snaps, its
     * acceleration. Pose stages are quick (the framing must not be late
     * for a card); the aim's are slower — a re-aim should read as the
     * approach's own slow pan, and its goal is a step function that needs
     * the most rounding.
     */
    this.chase2(
      this.pose,
      this.poseMid,
      this.poseMidV,
      this.poseNow,
      this.poseVel,
      tuneNumber('sylva', 20, 'Camera first spring response', 2, 40, 0.5),
      tuneNumber('sylva', 13, 'Camera second spring response', 2, 30, 0.5),
      dt,
      ['dolly', 'pitch', 'x', 'y', 'yaw'] as const
    );
    this.chase2(
      this.lookGoal,
      this.lookMid,
      this.lookMidV,
      this.lookNow,
      this.lookNowV,
      tuneNumber('sylva', 7, 'Aim first spring response', 1, 20, 0.5),
      tuneNumber('sylva', 4.5, 'Aim second spring response', 1, 15, 0.5),
      dt,
      ['x', 'y', 'z'] as const
    );
    sylva.pose({ ...this.poseNow, look: this.lookNow });
    this.placeCards(sylva);
    sylva.renderFrame();
  };

  /**
   * The DOM half of a frame: camera, then every card, then the order they
   * paint in.
   *
   * `face()` returns the billboarded world matrix AND seats the hole at the
   * same pose, so the card and the thing that cuts space for it cannot drift
   * apart — one call, one truth. The alternative is two code paths that agree
   * until the day they do not.
   */
  private placeCards(sylva: Sylva) {
    const view = sylva.view();
    const focal = perspective(view.projection, view.height);
    const cam = cameraCss(view.viewInverse, focal, view.width, view.height);
    /* two layers, one camera: the cards below the canvas and the pins above */
    for (const box of [this.cssEl, this.pinCssEl]) {
      if (box) {
        box.style.perspective = `${focal}px`;
      }
    }
    for (const el of [this.camEl, this.pinCamEl]) {
      if (el) {
        el.style.transform = cam;
      }
    }

    const order: { d: number; id: string }[] = [];
    for (const spot of this.spots) {
      const anchor = this.anchors.get(spot.id);
      const el = this.cardEls.get(spot.id);
      if (!anchor || !el) {
        continue;
      }
      const shown = this.open === spot.id;
      /**
       * One matrix, two elements. The pin and the card sit at the same anchor
       * and are billboarded the same way; `objectCss` centres both on it, so
       * the small always-visible marker and the panel that opens from it
       * cannot disagree about where the hotspot is.
       */
      /**
       * THE HOLE WEARS THE SHELL'S OWN POSE. The entrance is a Motion spring
       * on the shell — scale and translation from the pin out to its seat —
       * and the hole used to appear at full size the moment `open` flipped:
       * an empty outline hanging in the air while the panel was still
       * growing. So the shell's animated transform is measured off the DOM
       * here, each frame, and handed to `face()` for the hole to wear —
       * one spring, two rectangles, zero disagreement. The hole also stays
       * up while a CLOSING shell is still visibly shrinking, so the exit
       * reads instead of the content vanishing on the first frame.
       */
      const shell = el.firstElementChild as HTMLElement | null;
      const st = this.entry.get(spot.id) ?? { e: 0, v: 0 };
      this.entry.set(spot.id, st);
      /* critically damped toward seated (1) or parked-on-the-pin (0) —
         about the old entrance spring's pace, without its bounce */
      const EW = 12;
      st.v +=
        (EW * EW * ((shown ? 1 : 0) - st.e) - 2 * EW * st.v) * this.frameDt;
      st.e += st.v * this.frameDt;
      const eased = Math.max(0, Math.min(1, st.e));
      const entrance = {
        dx: -spot.off[0] * (1 - eased),
        /* CSS counts y downward; the offset was written in world up */
        dy: spot.off[1] * (1 - eased),
        /* the FULL journey: parked, the card is dot-sized — a close reads
           as the panel disappearing INTO the marker, never as a half-size
           slab winking out beside it */
        s: 0.1 + 0.9 * eased,
      };
      if (shell) {
        shell.style.transform =
          `translate(${entrance.dx.toFixed(2)}px, ` +
          `${entrance.dy.toFixed(2)}px) scale(${entrance.s.toFixed(4)})`;
        /**
         * OPACITY RIDES THE SAME SPRING. It was Motion's, on its own
         * clock, and the fade outran the shrink: a card mid-close spent
         * frames as a half-transparent full-size slab with the page's
         * grey showing through it — the jarring box. Derived from the
         * one integrator, the panel stays essentially opaque while it
         * travels and lets go only as it reaches the dot; the hole hides
         * on the same threshold, so nothing grey is ever left standing.
         */
        /* shrink AND dissolve, together: solid while seated, and the
           moment it leaves for the dot it starts giving up its ink too —
           fully dissolved as it reaches the marker */
        shell.style.opacity = Math.min(1, eased * 1.25).toFixed(3);
      }
      const show = shown || eased > 0.02;
      const m = anchor.face(show, entrance);
      el.style.transform = objectCss(m.card);
      const pin = this.pinEls.get(spot.id);
      if (pin) {
        pin.style.transform = objectCss(m.pin);
        /* dimmed, not hidden: a marker that vanishes behind a branch reads as
           a bug, one that dims reads as being back there */
        pin.classList.toggle('is-behind', anchor.hidden());
      }
      order.push({ d: anchor.depth(), id: spot.id });
    }

    /**
     * Nearest paints last. The browser has no idea these boxes are at
     * different depths — without this a card behind the root can draw over one
     * in front of it, which is the specific failure case 3 names.
     */
    order.sort((a, b) => b.d - a.d);
    order.forEach((entry, i) => {
      const el = this.cardEls.get(entry.id);
      if (el) {
        el.style.zIndex = String(i + 1);
      }
      const pin = this.pinEls.get(entry.id);
      if (pin) {
        pin.style.zIndex = String(i + 1);
      }
    });
  }

  private register = modifier((el: HTMLElement, [id]: [string]) => {
    this.cardEls.set(id, el);
    return () => this.cardEls.delete(id);
  });

  private pin = modifier((el: HTMLElement, [id]: [string]) => {
    this.pinEls.set(id, el);
    return () => this.pinEls.delete(id);
  });

  private cssHost = modifier((el: HTMLElement) => {
    this.cssEl = el;
    this.camEl = el.firstElementChild as HTMLElement;
    return () => {
      this.cssEl = undefined;
      this.camEl = undefined;
    };
  });

  private pinHost = modifier((el: HTMLElement) => {
    this.pinCssEl = el;
    this.pinCamEl = el.firstElementChild as HTMLElement;
    return () => {
      this.pinCssEl = undefined;
      this.pinCamEl = undefined;
    };
  });

  /**
   * Ask the scene before the card answers.
   *
   * A card behind a branch is still a live DOM node taking clicks, because the
   * compositing is one-way: the canvas draws over the DOM, and the DOM never
   * hears about it. So a press is raycast first, and if the root is nearer
   * along that ray than the card is, the press belongs to the moss.
   */
  private swallow = (id: string, event: PointerEvent) => {
    const sylva = this.sylva;
    const hero = this.heroEl;
    const anchor = this.anchors.get(id);
    if (!sylva || !hero || !anchor) {
      return;
    }
    const r = hero.getBoundingClientRect();
    const nx = ((event.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((event.clientY - r.top) / r.height) * 2 - 1);
    const blocked = sylva.hit(nx, ny);
    if (blocked !== null && blocked < anchor.depth()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /** the moss shaders read the pointer through a plane raycast of their own */
  private track = modifier((el: HTMLElement) => {
    const move = (event: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = this.sylva?.ndc;
      if (!ndc) {
        return;
      }
      ndc.x = ((event.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -(((event.clientY - r.top) / r.height) * 2 - 1);
    };
    const leave = () => {
      const ndc = this.sylva?.ndc;
      if (ndc) {
        ndc.x = 10;
        ndc.y = 10;
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  });

  /**
   * Drag to orbit, wheel to dolly — and taking hold means taking over.
   *
   * The same rule the mockup follows: a drag stops the shot. Leaving a flight
   * running under a hand that has just grabbed the camera is the demo talking
   * over whoever is using it.
   */
  private controls = modifier((el: HTMLElement) => {
    let from: { pitch: number; x: number; y: number; yaw: number } | null =
      null;
    const down = (event: PointerEvent) => {
      /**
       * Anything that is a control keeps its own press.
       *
       * `setPointerCapture` on the stage redirects every later pointer event
       * for that finger here — including the `pointerup` a button needs to
       * turn its press into a click. Capturing indiscriminately meant the
       * hotspot buttons could be pressed and never fired, so no card ever
       * opened and the whole rig looked like it had failed to build.
       */
      if (
        (event.target as HTMLElement).closest(
          '.sy-card, .sy-dot, .sy-narrate a'
        )
      ) {
        /* a control keeps its own press — and so does a CREDIT LINK:
           capturing its pointerdown retargets the click to the stage and
           the link never opens, which reads as a dead link */
        return;
      }
      el.setPointerCapture(event.pointerId);
      this.seize();
      from = {
        pitch: this.pose.pitch,
        x: event.clientX,
        y: event.clientY,
        yaw: this.pose.yaw,
      };
      this.open = null;
    };
    const move = (event: PointerEvent) => {
      if (!from) {
        return;
      }
      const yaw = from.yaw + (event.clientX - from.x) * 0.22;
      const pitch = Math.max(
        -32,
        Math.min(32, from.pitch - (event.clientY - from.y) * 0.16)
      );
      this.pose = { ...this.pose, pitch, yaw };
      this.snapPose();
    };
    const up = () => {
      from = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const dolly = Math.max(
        0.34,
        Math.min(1.6, this.pose.dolly + event.deltaY * 0.0012)
      );
      this.pose = { ...this.pose, dolly };
      this.snapPose();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  });

  /**
   * Choreo drives the flight. `c.Camera3D` writes a pose per frame and the
   * host applies it — the same seam the mockup uses, which is the point: a
   * scene this different from a phone should not need a different camera.
   */
  private shot = (state: {
    dolly: number;
    look?: { x: number; y: number; z: number };
    pitch: number;
    x: number;
    y: number;
    yaw: number;
  }) => {
    this.pose = {
      dolly: state.dolly,
      pitch: state.pitch,
      x: state.x,
      y: state.y,
      yaw: state.yaw,
    };
    /* the aim arrives WITH the pose now — `@look` rides the score's own
       clock (and the lap spline), so there is no side-channel left; the
       cascade below still rounds whatever the score hands it */
    if (state.look) {
      this.lookGoal = state.look;
    }
  };

  /**
   * Which hotspot the camera was last sent to by hand. Deliberately NOT
   * `open`: the card can be closed, or the shot dragged away from it, without
   * that counting as a fresh instruction to the camera.
   */
  @tracked private sent: string | null = null;

  /**
   * A CARD IS AN ANSWER, and only two things may ask.
   *
   * The first pass opened whichever card the camera happened to face —
   * `discover()`, a facing test run every frame. It felt clever and it was
   * wrong twice over: a card appearing merely because it CAN be seen reads as
   * the scene talking to itself, and the click on a pin never stuck, because
   * the very next frame's facing test overwrote whatever the click had set.
   * "The dot doesn't work" was that loop, not the dot.
   *
   * So there is no discovery. A card opens because YOU pressed its dot, or
   * because the TOUR has brought you to it and presents it — a `c.Perform`
   * cue on the score's own clock, which is also what closes it as the pan
   * moves on. Two askers, one owner each.
   */
  private visit = (spot: Spot) => {
    this.playing = false;
    this.open = spot.id;
    this.told = spot.id;
    this.sent = spot.id;
  };

  /**
   * The film's own actions, arriving on the run's clock.
   *
   * The writes are deferred a frame for the fold trap's reason: a command is
   * dispatched during the region's own pass, and a tracked write there
   * replays the pass and cancels the run that was dispatching. A frame later
   * it is an ordinary write. The guard re-checks `playing` at that moment —
   * a film someone has just seized must not go on opening cards under them.
   */
  private dispatch = (command: PerformCommand) => {
    if (command.action === 'lap') {
      /**
       * ROUND AGAIN. The score is a finite sequence, so looping is a new
       * score rather than a repeat: bumping `lap` edits the timeline, the
       * region sees an edited score and replays from the top. Restarting the
       * run in place would fight the very thing that makes an interruption
       * work — an edited timeline is never noise.
       */
      if (this.playing) {
        this.lap += 1;
      }
      return;
    }
    const id = String(command.target ?? '');
    requestAnimationFrame(() => {
      if (!this.playing) {
        return;
      }
      if (command.action === 'open') {
        this.open = id;
        this.told = id;
      } else if (command.action === 'close' && (!id || this.open === id)) {
        this.open = null;
        if (!id) {
          // the targetless close is the going-home one: the narration
          // hands back to the series title for the pull-out
          this.told = null;
        }
      }
    });
  };

  /**
   * A scrub backwards re-derives from zero: the opens at or before the clock
   * are the commanded state, so the host simply drops what it holds and lets
   * the replayed prefix put it back.
   */
  private resetPerform = () => {
    this.lookGoal = { x: 0, y: 0, z: 0 };
    requestAnimationFrame(() => {
      if (this.playing) {
        this.open = null;
      }
    });
  };

  /**
   * TAKING HOLD STOPS THE FILM, which is the mockup's rule and it is the right
   * one: leaving a camera track running under somebody who has just grabbed
   * the camera is the demo talking over them. Stopping it also drops the score
   * — the region has nothing left to replay — so the pose stays exactly where
   * the hand left it.
   */
  private seize = () => {
    if (this.playing) {
      this.playing = false;
    }
  };

  private toggle = () => {
    this.playing = !this.playing;
    if (this.playing) {
      this.open = null;
      this.told = null;
      this.sent = null;
    }
  };

  /** the timeline is in the title scene: nothing told, film running */
  private get titleOn() {
    return this.playing && this.chapter.id === 'rest';
  }

  /** from the top: a fresh lap, which begins at the title scene */
  private fromTheTop = () => {
    this.playing = true;
    this.open = null;
    this.told = null;
    this.sent = null;
    this.lap += 1;
  };

  /**
   * The hand-driven shot, for when the film is off. A region replays when its
   * SCORE changes, which is what turns a click on a pin into a flight — and if
   * this fell back to REST the moment the pose moved by hand, letting go of the
   * mouse would fly the camera home.
   *
   * It flies to the same DERIVED reading pose the tour uses — `anchor.shot()`
   * plus the spot's framing nudge — not the raw hand-authored numbers. Two
   * poses for one card is the drift bug waiting: the tour would read a panel
   * from one place and a click would read it from another.
   */
  private get aim() {
    const shot = this.shots.find((s) => s.id === this.sent);
    return shot ?? REST;
  }

  /**
   * THE SWEEP'S LEGS, derived from the reading poses.
   *
   * Each leg is the reading pose swung a few degrees either side: the
   * approach lands slightly BEFORE square-on and the reading pan carries on
   * slowly THROUGH it to slightly past — so the card is presented by a frame
   * that never stops moving, and is exactly square at the middle of its own
   * read. The pan also eases the dolly in a touch, the slow push a
   * documentary holds on a subject while the narration runs.
   */
  private get legs() {
    /**
     * YAW IS UNWRAPPED leg to leg. `anchor.shot()` reports yaw in
     * −180..180, and a numeric tween between two poses knows nothing about
     * circles: fern at 172 to wren at −168 would swing 340° back around the
     * FRONT of the scene instead of panning 20° across the back of it.
     * Each leg's yaw is therefore expressed in the previous leg's winding —
     * whichever multiple of 360 keeps the turn under a half circle — so the
     * tour walks round the tree and stays round the back while the back
     * pair read. This is exactly the bug that sank the first attempt at
     * rear-facing cards (see `Spot.tilt`).
     */
    let prev = REST.yaw;
    return this.shots.map((read) => {
      let yaw = read.yaw;
      while (yaw - prev > 180) {
        yaw -= 360;
      }
      while (yaw - prev < -180) {
        yaw += 360;
      }
      prev = yaw;
      return {
        id: read.id,
        /* the approach step's name, so cues can be clipped to its span */
        name: `in-${read.id}`,
        into: {
          ...read,
          dolly: read.dolly + SWING.dolly,
          x: read.x - SWING.x,
          yaw: yaw - SWING.yaw,
        },
        past: {
          ...read,
          dolly: read.dolly - SWING.dolly * 0.6,
          x: read.x + SWING.x,
          yaw: yaw + SWING.yaw,
        },
      };
    });
  }

  /**
   * THE LAP, as waypoints: each leg's swing pair with its card's own point
   * as the aim, and the way home last. `@through` splines the lot on one
   * clock — see the score below.
   */
  private get lapPath() {
    const home = { x: 0, y: 0, z: 0 };
    return [
      /* THE TITLE SCENE: two wide waypoints before any card — the camera
         drifts gently across the whole root while the title card reads,
         never resting, going nowhere in particular yet */
      { ...REST, dolly: 1.3, look: home, yaw: -6 },
      { ...REST, dolly: 1.26, look: home, yaw: 5 },
      ...this.legs.flatMap((leg) => {
        const look = this.lookOf.get(leg.id);
        return [
          { ...leg.into, look },
          { ...leg.past, look },
        ];
      }),
      { ...REST, look: home },
    ];
  }

  /** waypoints spent on the title scene before the first card */
  private readonly titlePts = 2;

  /** the whole lap's clock; segments are uniform, so timing is arithmetic */
  private get lapSeconds() {
    return tuneNumber('sylva', 31, 'Tour duration seconds', 10, 90, 1);
  }

  /** one uniform spline segment, seconds */
  private get lapSegment() {
    return this.lapSeconds / (this.legs.length * 2 + this.titlePts + 1);
  }

  /**
   * When each card is presented: just before its reading waypoint is
   * crossed — waypoint 2k+1 of the path, at (2k+1) segments — so the
   * entrance is airborne, never parked.
   */
  private get presents() {
    return this.legs.map((leg, k) => ({
      id: leg.id,
      open: Math.max(0, (2 * k + 1 + this.titlePts) * this.lapSegment - 0.9),
    }));
  }

  /** the last card lets go a beat into the pull-out */
  private get lapClose() {
    return (2 * this.legs.length + this.titlePts) * this.lapSegment + 0.6;
  }

  /** the aim a hand-flight carries — the visited card's point, or home */
  private get aimLook() {
    return (
      (this.sent ? this.lookOf.get(this.sent) : undefined) ?? {
        x: 0,
        y: 0,
        z: 0,
      }
    );
  }

  /**
   * THE NARRATION PLANE's current chapter: the visited spot's line, or the
   * series title over the establishing shot. Keyed by id in the template so
   * a hand-off replays the lower-third's entrance.
   */
  private get chapter(): {
    eyebrow: string;
    id: string;
    line: string;
    sub?: string;
    title?: boolean;
  } {
    const id = this.open ?? this.told;
    const spot = this.spots.find((s) => s.id === id);
    if (!spot) {
      /**
       * THE TITLE CARD, over every lap's establishing shot. Its copy is the
       * original landing page's, near-verbatim — "Step into the living
       * world" is Sylva's own headline — and the credit is owed: the world,
       * the roots, the moss and the butterfly are Meng To's "Living Green",
       * vendored from threeui.
       */
      return {
        eyebrow: 'A field survey',
        id: 'rest',
        line: 'Step into the living world',
        sub: 'One moss root, four residents — patient design, native planting, a deeper kind of stewardship.',
        title: true,
      };
    }
    const index = String(this.spots.indexOf(spot) + 1).padStart(2, '0');
    return {
      eyebrow: `${spot.kind} · ${index} / 04`,
      id: spot.id,
      line: spot.story,
    };
  }

  /**
   * A card's trigger. Three of the four are cues fired into the scene; the
   * wren's is the stage's own — a synthesised burst of song, because the
   * one thing a scene made of shaders cannot draw is a sound.
   */
  /** which card's trigger just fired — drives the button's own flash */
  @tracked private cued: string | null = null;
  private cuedTimer = 0;

  private act = (spot: Spot) => {
    this.cued = spot.id;
    clearTimeout(this.cuedTimer);
    this.cuedTimer = window.setTimeout(() => (this.cued = null), 750);
    if (spot.cue.kind === 'song') {
      this.trill();
      /* the song is HEARD from behind the crest — and the crest answers:
         a shiver of spores where the singer must be */
      this.sylva?.cue('burst', this.anchors.get(spot.id)?.at());
      return;
    }
    /* the gust aims at the PIN — the point on the wood, where there is
       moss to part; the BURST aims at the CARD's own midpoint, because
       the whole point of the spores is to be seen crossing the panel */
    this.sylva?.cue(
      spot.cue.kind,
      spot.cue.kind === 'burst'
        ? this.lookOf.get(spot.id)
        : this.anchors.get(spot.id)?.at()
    );
  };

  private cueClass = (id: string) =>
    this.cued === id ? 'sy-cue is-fired' : 'sy-cue';

  private audio?: AudioContext;

  /**
   * A wren, roughly: four falling chirps and a dry trill. Oscillators and
   * gain envelopes only — no asset, nothing to load, and it still reads
   * instantly as a small bird somewhere behind the crest.
   */
  private trill = () => {
    const ctx = (this.audio ??= new AudioContext());
    void ctx.resume();
    const chirp = (
      at: number,
      f0: number,
      f1: number,
      dur: number,
      g = 0.2
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(g, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    };
    let t = ctx.currentTime + 0.03;
    for (let i = 0; i < 4; i++) {
      chirp(t, 5200 - i * 320, 3300, 0.09);
      t += 0.12;
    }
    t += 0.05;
    for (let i = 0; i < 10; i++) {
      chirp(t, 4300, 3900, 0.035, 0.15);
      t += 0.045;
    }
  };

  private isOpen = (id: string) => this.open === id;

  /**
   * The rows, staggered behind it. A panel whose text is simply there the
   * instant it opens reads as a screenshot; letting the lines arrive lets the
   * eye follow them, which is the whole difference between a label and
   * something that is being told to you.
   */
  private row = (spot: Spot, i: number) =>
    this.open === spot.id
      ? {
          opacity: 1,
          transition: { ...CONTENT, delay: 0.08 + i * 0.055 },
          y: 0,
        }
      : { opacity: 0, transition: CONTENT, y: 8 };

  <template>
    <div class="sy-page is-theater {{if this.checking 'is-checking'}}">
      <div class="sy-hero" {{this.stage}} {{this.track}} {{this.controls}}>
        {{! THE DOM, UNDER THE CANVAS. Everything visible here arrives through
            a hole the scene cuts for it — see `anchor()`. }}
        <div class="sy-css" {{this.cssHost}}>
          <div class="sy-cam">
            {{#each this.spots as |spot|}}
              <div
                class="sy-card {{if (this.isOpen spot.id) 'is-open'}}"
                {{this.register spot.id}}
                {{on "pointerdown" (fn this.swallow spot.id)}}
              >
                <div class="sy-shell">
                  <p
                    class="sy-kind"
                    {{motion animate=(this.row spot 0)}}
                  >{{spot.kind}}</p>
                  <h2
                    class="sy-name"
                    {{motion animate=(this.row spot 1)}}
                  >{{spot.name}}</h2>
                  <p
                    class="sy-blurb"
                    {{motion animate=(this.row spot 2)}}
                  >{{spot.blurb}}</p>
                  <div class="sy-note" {{motion animate=(this.row spot 3)}}>
                    {{! A REAL CONTROL, and the reason the approach exists:
                    the card is not a picture of UI — this button is live,
                    occluded by a branch and still pressable, and pressing
                    it reaches back INTO the scene. }}
                    <button
                      type="button"
                      class={{this.cueClass spot.id}}
                      {{on "click" (fn this.act spot)}}
                    >
                      <span class="sy-cue-dot" aria-hidden="true"></span>
                      {{spot.cue.label}}
                    </button>
                  </div>
                </div>
              </div>
            {{/each}}
          </div>
        </div>

        <canvas class="sy-canvas"></canvas>

        {{! THE PINS RIDE OVER THE CANVAS, in a second camera layer.
            They were under it to begin with, alongside the cards, and the moss
            promptly swallowed them: only cards get a hole cut, so a pin behind
            a branch simply was not there. Correct for a card, wrong for a pin —
            occlusion is what the CARDS are here to demonstrate, whereas a
            marker that is hidden by scenery is a marker nobody can find.
            Same matrix, same billboard, opposite side of the canvas. }}
        <div class="sy-css sy-css--front" {{this.pinHost}}>
          <div class="sy-cam">
            {{#each this.spots as |spot|}}
              <button
                type="button"
                class="sy-pin {{if (this.isOpen spot.id) 'is-on'}}"
                title={{spot.name}}
                {{this.pin spot.id}}
                {{on "click" (fn this.visit spot)}}
              ></button>
            {{/each}}
          </div>
        </div>

        {{! THE NARRATION PLANE. A lower-third over everything: the voice
            over, written down. Keyed on the chapter so every hand-off
            replays its entrance, eyebrow first, then the line, risen and
            unblurred. It is part of the PICTURE, so film mode keeps it. }}
        <Choreo class="sy-narrate" aria-hidden="true" as |n|>
          {{#unless this.status}}
            {{#each (array this.chapter) key="id" as |ch|}}
              {{#if ch.title}}
                <p
                  class="sy-narrate-eyebrow"
                  {{motion id="t-eyebrow" role="tkick"}}
                >{{ch.eyebrow}}</p>
                <p
                  class="sy-ghost"
                  {{motion id="t-ghost" role="tghost"}}
                >Sylva</p>
                <p
                  class="sy-headline"
                  {{motion id="t-head" role="tword"}}
                >{{ch.line}}</p>
                <p
                  class="sy-sub"
                  {{motion id="t-sub" role="tblock"}}
                >{{ch.sub}}</p>
                <p class="sy-credit" {{motion id="t-credit" role="tblock"}}>
                  A living world by
                  <a
                    href="https://x.com/MengTo"
                    target="_blank"
                    rel="noopener noreferrer"
                  >Meng To</a>
                  ·
                  <a
                    href="https://threeui.com/browse"
                    target="_blank"
                    rel="noopener noreferrer"
                  >threeui</a>
                  — “Living Green”</p>
              {{else}}
                <p
                  class="sy-narrate-eyebrow"
                  {{motion id="n-eyebrow" role="tkick"}}
                >{{ch.eyebrow}}</p>
                <p
                  class="sy-narrate-line"
                  {{motion id="n-line" role="tword"}}
                >{{ch.line}}</p>
              {{/if}}
            {{/each}}
          {{/unless}}

          {{! THE TYPE IS DELIVERED, not faded: this is Choreo's own
                    text machinery doing the After Effects work. The
                    wordmark's characters pop centre-out on an overshoot;
                    the lines land word by word; the small print follows as
                    blocks; and a chapter swap drops the old type in one
                    quick fall. Every step is score vocabulary — @by,
                    @order, @stagger — nothing hand-keyed. }}
          <n.Parallel>
            <n.Tween
              @of={{array
                (n.removed "tkick")
                (n.removed "tghost")
                (n.removed "tword")
                (n.removed "tblock")
              }}
              @opacity={{array 1 0}}
              @y={{array 0 -12}}
              @duration={{0.18}}
              @ease="easeIn"
            />
            <n.Tween
              @of={{n.inserted "tkick"}}
              @by="character"
              @stagger={{0.016}}
              @opacity={{array 0 1}}
              @duration={{0.3}}
              @ease="easeOut"
            />
            <n.Tween
              @of={{n.inserted "tghost"}}
              @by="character"
              @order="center"
              @stagger={{0.05}}
              @delay={{0.12}}
              @y={{array 38 0}}
              @scale={{array 1.32 1}}
              @opacity={{array 0 1}}
              @duration={{0.7}}
              @ease={{array 0.26 1.4 0.42 1}}
            />
            <n.Tween
              @of={{n.inserted "tword"}}
              @by="word"
              @stagger={{0.055}}
              @delay={{0.3}}
              @y={{array 16 0}}
              @opacity={{array 0 1}}
              @filter={{array "blur(6px)" "blur(0px)"}}
              @duration={{0.55}}
              @ease={{array 0.22 1 0.36 1}}
            />
            <n.Tween
              @of={{n.inserted "tblock"}}
              @stagger={{0.22}}
              @delay={{0.85}}
              @y={{array 12 0}}
              @opacity={{array 0 1}}
              @duration={{0.6}}
              @ease={{array 0.22 1 0.36 1}}
            />
          </n.Parallel>
        </Choreo>

        {{! The dots are plain HUD, over everything: a hotspot you cannot find
            because the branch is in front of it is not a hotspot. `?film`
            removes them — chrome has no place in an export. }}
        {{#unless this.film}}
          <div class="sy-dots">
            <button
              type="button"
              class="sy-dot sy-play {{if this.playing 'is-on'}}"
              {{on "click" this.toggle}}
            >{{if this.playing "❙❙ touring" "▶ tour"}}</button>
            {{! lit like an active dot whenever the timeline is
                      actually showing the title }}
            <button
              type="button"
              class="sy-dot {{if this.titleOn 'is-on'}}"
              {{on "click" this.fromTheTop}}
            >↺ title</button>
            {{#each this.spots as |spot|}}
              <button
                type="button"
                class="sy-dot {{if (this.isOpen spot.id) 'is-on'}}"
                {{on "click" (fn this.visit spot)}}
              >{{spot.name}}</button>
            {{/each}}
            <span class="sy-hint">drag to look — the fern and the wren read from
              round the back</span>
          </div>
        {{/unless}}

        {{#if this.status}}
          <p class="sy-status">{{this.status}}</p>
        {{/if}}
      </div>

      <Choreo
        @onCamera3D={{this.shot}}
        @onPerform={{this.dispatch}}
        @onPerformReset={{this.resetPerform}}
        as |c|
      >
        {{! A region collects its score from a render pass, and a pass with no
            participants in it is a pass with nothing to run. The camera is the
            only thing this region drives, so it needs one member to exist for
            — a marker with no size and nothing to draw. }}
        <i class="sy-rig" {{motion id="rig"}} aria-hidden="true"></i>
        {{#if this.playing}}
          {{! THE SWEEP IS ONE STEP. Eight reading-swing waypoints and the
              way home, splined by `@through` on a single clock — so the
              camera crosses every pose with continuous velocity instead of
              parking at seams, and the whole lap stays a pure function of
              the clock (scrubbable, exportable), which the host-side chaser
              alone could never claim. The aim rides IN the waypoints via
              `@look`: no side-channel, no second easing. The ease is
              linear on purpose — the spline is the shape. }}
          <c.Sequence @name={{this.lapName}}>
            <c.Camera3D
              @name="lap"
              @through={{this.lapPath}}
              @duration={{this.lapSeconds}}
              @ease="linear"
            />
            {{! presents, CLIPPED into the path: each open fires just before
                its card's waypoint is crossed, mid-flight — and each open
                SWAPS the cards, so the leaver and the arrival cross-fade
                while the camera is still travelling }}
            {{#each this.presents as |present|}}
              <c.Perform
                @at={{at "lap"}}
                @delay={{present.open}}
                @action="open"
                @target={{present.id}}
              />
            {{/each}}
            {{! the last card lets go partway into the pull-out — a
                targetless close puts away whichever card is still up }}
            <c.Perform
              @at={{at "lap"}}
              @delay={{this.lapClose}}
              @action="close"
            />
            <c.Perform @action="lap" />
          </c.Sequence>
        {{else}}
          <c.Camera3D
            @yaw={{this.aim.yaw}}
            @pitch={{this.aim.pitch}}
            @dolly={{this.aim.dolly}}
            @x={{this.aim.x}}
            @y={{this.aim.y}}
            @look={{this.aimLook}}
            @duration={{1.1}}
          />
        {{/if}}
      </Choreo>
    </div>

    <style>
      .sy-page {
        /* the ORIGINAL's sky, verbatim: two soft radials over a near-flat
           #4a4d44 — the canvas is alpha, so this IS the scene's ground,
           and the tile, the theater and the iframe all read as one world */
        background:
          radial-gradient(
            64% 52% at 27% 84%,
            rgba(232, 238, 222, 0.085) 0%,
            rgba(232, 238, 222, 0) 72%
          ),
          radial-gradient(
            70% 60% at 92% 8%,
            rgba(24, 28, 20, 0.1) 0%,
            rgba(24, 28, 20, 0) 68%
          ),
          #4a4d44;
        overflow: hidden;
      }
      /* the floor of light the root stands in, also the original's */
      .sy-hero::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background:
          radial-gradient(
            72% 44% at 50% 117%,
            rgba(238, 243, 231, 0.5) 0%,
            rgba(238, 243, 231, 0.21) 42%,
            rgba(238, 243, 231, 0.04) 72%,
            rgba(238, 243, 231, 0) 88%
          ),
          linear-gradient(
            180deg,
            rgba(238, 243, 231, 0) 54%,
            rgba(238, 243, 231, 0.03) 78%,
            rgba(238, 243, 231, 0.085) 100%
          );
      }
      /* the theater owns the viewport; the stage face owns its box. Its
         z stays MODEST — the app chrome is faded out underneath rather
         than fought, and a huge z on a fixed flying sprite is exactly the
         thing that janks a route crossing's own raise ordering. */
      .sy-page.is-theater {
        position: fixed;
        inset: 0;
        z-index: 5;
      }
      .sy-hero {
        position: absolute;
        inset: 0;
        touch-action: none;
        cursor: grab;
      }
      .sy-hero:active {
        cursor: grabbing;
      }
      /* ABOVE the DOM: the hole is what lets the cards through, and anything
         that must appear over them has to be drawn in here. */
      .sy-canvas {
        position: absolute;
        inset: 0;
        z-index: 2;
        width: 100%;
        height: 100%;
        display: block;
        pointer-events: none;
      }
      .sy-css {
        position: absolute;
        inset: 0;
        z-index: 1;
        overflow: hidden;
      }
      .sy-css--front {
        z-index: 3;
        pointer-events: none;
      }
      .sy-css--front .sy-pin {
        pointer-events: auto;
      }
      .sy-cam {
        position: absolute;
        inset: 0;
        transform-style: preserve-3d;
      }
      /* the line-up test: a hollow ring, so the scene's magenta dot shows
         through the middle when the two projections agree */
      .sy-page.is-checking .sy-pin {
        width: 22px;
        height: 22px;
        border: 2px solid #7ef2ff;
        background: transparent;
      }
      .sy-page.is-checking .sy-pin::before,
      .sy-page.is-checking .sy-pin::after {
        display: none;
      }
      /* THE DOTS ARE ALIVE, and they are little spheres, not stickers.
         The button's own transform is written every frame by the host
         (objectCss), so the breathing and the ring live on pseudo-elements
         — the one place a CSS animation survives an inline transform. */
      .sy-pin {
        position: absolute;
        top: 0;
        left: 0;
        width: 18px;
        height: 18px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
      }
      .sy-pin::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 50%;
        /* a sphere: hot highlight up-left, shadowed limb down-right */
        background: radial-gradient(
          circle at 32% 28%,
          #eafff2 0%,
          #a5ecc2 32%,
          #5bb787 66%,
          #2a6e4d 100%
        );
        box-shadow:
          0 0 0 3px rgba(6, 18, 12, 0.4),
          0 2px 8px rgba(3, 10, 6, 0.55),
          0 0 16px rgba(126, 214, 160, 0.5);
        animation: sy-throb 2.6s ease-in-out infinite;
      }
      .sy-pin::after {
        content: "";
        position: absolute;
        inset: -3px;
        border-radius: 50%;
        border: 1.5px solid rgba(158, 232, 188, 0.7);
        animation: sy-ring 2.6s ease-out infinite;
      }
      /* the four breathe out of phase, like things that are each alive */
      .sy-pin:nth-of-type(2)::before,
      .sy-pin:nth-of-type(2)::after {
        animation-delay: -0.7s;
      }
      .sy-pin:nth-of-type(3)::before,
      .sy-pin:nth-of-type(3)::after {
        animation-delay: -1.4s;
      }
      .sy-pin:nth-of-type(4)::before,
      .sy-pin:nth-of-type(4)::after {
        animation-delay: -2.1s;
      }
      @keyframes sy-throb {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.16);
        }
      }
      @keyframes sy-ring {
        0% {
          transform: scale(0.65);
          opacity: 0.9;
        }
        70%,
        100% {
          transform: scale(1.9);
          opacity: 0;
        }
      }
      .sy-pin.is-on::before {
        background: radial-gradient(
          circle at 32% 28%,
          #ffffff 0%,
          #c9f7db 30%,
          #7ed6a0 64%,
          #3c8f66 100%
        );
        box-shadow:
          0 0 0 3px rgba(6, 18, 12, 0.4),
          0 2px 8px rgba(3, 10, 6, 0.55),
          0 0 24px rgba(126, 214, 160, 0.9);
      }
      .sy-pin.is-behind {
        opacity: 0.34;
      }
      .sy-pin.is-behind::after {
        display: none;
      }
      /**
       * THE PANEL LIVES ON THE SHELL, not on the positioned box.
       *
       * The card element is only a rectangle that `objectCss` puts in space —
       * giving it the background and border meant a closed card was still a
       * fully painted panel with invisible content inside it, which is what
       * the stray glass rectangles turned out to be. Everything you can see
       * belongs to the thing that fades.
       */
      .sy-shell {
        /* HIDDEN AT REST, in the stylesheet. Presence is written inline
           by the host's spring every frame — but until the loop's first
           frame (boot takes seconds), and for any card not yet placed,
           the inline write does not exist, and a default-visible shell
           stands full-size wherever its untransformed box happens to be:
           the grey box, parked at the viewport corner. The base state of
           a card is closed; only the loop may say otherwise. */
        opacity: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 14px 16px;
        border-radius: 14px;
        /* the glass grammar is threeui's, rim included: a SPECULAR
           border — bright and cool along the top, a warm glint on the
           right shoulder, near-dark at the foot — worn as a conic sweep
           under a transparent border. (It took the blame for a jank that
           was really the shell's opacity fading on a second clock; with
           presence host-owned, it is innocent and reinstated.) */
        border: 1px solid transparent;
        background:
          linear-gradient(
              158deg,
              rgba(16, 34, 23, 0.82) 0%,
              rgba(7, 15, 10, 0.74) 100%
            )
            padding-box,
          conic-gradient(
              from -90deg,
              rgba(240, 250, 255, 0.85) 0%,
              rgba(170, 205, 255, 0.5) 8%,
              rgba(255, 205, 150, 0.45) 18%,
              rgba(255, 255, 255, 0.08) 32%,
              rgba(255, 255, 255, 0.03) 50%,
              rgba(255, 255, 255, 0.08) 68%,
              rgba(200, 230, 255, 0.4) 90%,
              rgba(240, 250, 255, 0.85) 100%
            )
            border-box;
        box-shadow:
          inset 0 1px 0 rgba(220, 255, 232, 0.12),
          0 24px 60px rgba(2, 8, 5, 0.4);
        transform-origin: 50% 50%;
        will-change: transform;
      }
      .sy-card {
        /* the entrance is transform/opacity only — keep the subtree's
           paint self-contained and pre-promoted so the spring never asks
           layout for anything */
        contain: layout paint;
        position: absolute;
        top: 0;
        left: 0;
        width: 260px;
        height: 168px;
        color: #dff3e6;
        font:
          13px/1.45 ui-sans-serif,
          system-ui,
          sans-serif;
        pointer-events: none;
      }
      .sy-card.is-open {
        pointer-events: auto;
      }
      .sy-kind {
        margin: 0;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #7ed6a0;
      }
      .sy-name {
        margin: 2px 0 4px;
        font-size: 16px;
        font-weight: 600;
      }
      .sy-blurb {
        margin: 0 0 8px;
        color: #a9c9b6;
        font-size: 12px;
      }
      .sy-note {
        display: flex;
        flex-direction: column;
        margin-top: auto;
      }
      .sy-cue {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 10px 0;
        border-radius: 10px;
        border: 1px solid rgba(126, 214, 160, 0.36);
        /* no backdrop-filter here: a re-blur riding a springing parent is
           the single most expensive pixel in the card */
        background: linear-gradient(
          160deg,
          rgba(126, 214, 160, 0.18),
          rgba(126, 214, 160, 0.05)
        );
        color: #bdf0d2;
        font:
          500 11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background-color 160ms ease;
      }
      .sy-cue:hover {
        background: rgba(126, 214, 160, 0.24);
      }
      .sy-cue:active {
        background: rgba(126, 214, 160, 0.32);
      }
      .sy-cue-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #7ed6a0;
        box-shadow: 0 0 10px #7ed6a0;
      }
      /* the fired flash: the button goes solid and throws a ring, so a
         press is unmistakably a press even before the world answers */
      .sy-cue.is-fired {
        animation: sy-fire 0.7s ease-out;
      }
      @keyframes sy-fire {
        0% {
          background: rgba(126, 214, 160, 0.95);
          color: #06120c;
          box-shadow: 0 0 0 0 rgba(126, 214, 160, 0.8);
        }
        100% {
          background: rgba(126, 214, 160, 0.05);
          color: #bdf0d2;
          box-shadow: 0 0 0 30px rgba(126, 214, 160, 0);
        }
      }
      /* ── the narration plane ──────────────────────────────────────
         Sized with clamp() against the viewport, so a 4K export gets 4K
         typography rather than a 1080p HUD scaled up. */
      .sy-narrate {
        position: absolute;
        z-index: 4;
        left: clamp(20px, 4.5vw, 110px);
        bottom: clamp(100px, 17vh, 280px);
        max-width: min(680px, 60vw);
        pointer-events: none;
      }
      .sy-narrate-eyebrow {
        margin: 0 0 clamp(6px, 0.8vh, 16px);
        font:
          500 clamp(10px, 0.85vw, 20px) / 1 ui-monospace,
          monospace;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: #7ed6a0;
        text-shadow: 0 1px 12px rgba(3, 10, 6, 0.9);
      }
      .sy-narrate-line {
        margin: 0;
        font:
          300 clamp(20px, 2.1vw, 48px) / 1.28 ui-serif,
          Georgia,
          serif;
        letter-spacing: 0.01em;
        color: #eef7f0;
        text-shadow: 0 2px 26px rgba(3, 10, 6, 0.85);
        text-wrap: balance;
      }
      /* the title card — the landing page's own hero, restaged: the SYLVA
         wordmark wide-tracked the way its ghost type was, the headline
         beneath, the credit where a film puts one */
      .sy-ghost {
        margin: 0 0 clamp(8px, 1.2vh, 22px);
        font:
          300 clamp(40px, 5.4vw, 124px) / 0.95 ui-sans-serif,
          system-ui,
          sans-serif;
        letter-spacing: 0.32em;
        text-transform: uppercase;
        color: rgba(226, 245, 232, 0.95);
        text-shadow: 0 4px 44px rgba(3, 10, 6, 0.9);
      }
      .sy-headline {
        margin: 0 0 clamp(6px, 0.9vh, 16px);
        font:
          300 clamp(19px, 2vw, 46px) / 1.2 ui-serif,
          Georgia,
          serif;
        color: #dff0e4;
        text-shadow: 0 2px 26px rgba(3, 10, 6, 0.85);
      }
      .sy-sub {
        margin: 0;
        max-width: 46ch;
        font:
          300 clamp(12px, 1vw, 23px) / 1.5 ui-sans-serif,
          system-ui,
          sans-serif;
        color: #9fc2ac;
        text-shadow: 0 1px 16px rgba(3, 10, 6, 0.8);
      }
      .sy-narrate a {
        pointer-events: auto;
        color: #9fe0ba;
        text-decoration: underline dotted rgba(126, 214, 160, 0.6);
        text-underline-offset: 3px;
      }
      .sy-credit {
        margin: clamp(10px, 1.6vh, 28px) 0 0;
        font:
          500 clamp(9px, 0.72vw, 15px) / 1 ui-monospace,
          monospace;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: #6f9a80;
      }
      .sy-dots {
        position: absolute;
        z-index: 3;
        inset-inline: 0;
        bottom: clamp(14px, 2.4vh, 40px);
        display: flex;
        gap: clamp(6px, 0.6vw, 14px);
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
      }
      .sy-dot {
        padding: clamp(6px, 0.5vw, 12px) clamp(12px, 1vw, 24px);
        border-radius: 999px;
        border: 1px solid rgba(126, 214, 160, 0.26);
        background: rgba(6, 18, 12, 0.6);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #cfe9da;
        font:
          clamp(10px, 0.8vw, 19px) / 1 ui-monospace,
          monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
        transition:
          background-color 180ms ease,
          color 180ms ease;
      }
      .sy-dot:hover {
        background: rgba(20, 44, 30, 0.8);
      }
      .sy-dot.is-on {
        background: #7ed6a0;
        color: #06120c;
      }
      .sy-rig {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      .sy-hint {
        flex-basis: 100%;
        text-align: center;
        margin-top: clamp(2px, 0.4vh, 8px);
        color: #587a63;
        font:
          clamp(10px, 0.7vw, 15px) / 1 ui-monospace,
          monospace;
        letter-spacing: 0.05em;
      }
      .sy-status {
        position: absolute;
        z-index: 3;
        inset-inline: 0;
        top: 50%;
        margin: 0;
        text-align: center;
        color: #9fd8b4;
        font:
          12px/1.4 ui-monospace,
          monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
    </style>
  </template>
}
