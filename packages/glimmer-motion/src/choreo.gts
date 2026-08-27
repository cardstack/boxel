/**
 * <Choreo> — boxel-motion's AnimationContext for glimmer-motion: a region that
 * watches its render passes, hands each one's changeset (inserted / removed /
 * kept participants, with their bounds before and after) to the timeline
 * declared inside it, and plays that timeline on the motion-dom engine.
 *
 *   <Choreo as |c|>
 *     <div {{motion id='a' role='card'}}>…</div>
 *     <c.Sequence>
 *       <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @ms={{200}} />
 *       <c.Move  @of={{c.kept 'card'}} />
 *     </c.Sequence>
 *   </Choreo>
 *
 * docs/choreography.md has the whole design and the legacy it descends from.
 */
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { consumeTag, VOLATILE_TAG } from '@glimmer/validator';
import { modifier } from 'ember-modifier';

import { registerBusyProbe } from './activity.ts';
import { type BeaconRef, measureBeacons } from './choreo/beacons.ts';
import Changeset from './choreo/changeset.ts';
import compile, { continuation, sameScore } from './choreo/compile.ts';
import {
  join as joinPass,
  leave as leavePass,
  type Pass,
  setBeforeMeasure,
  setPassScheduler,
} from './choreo/far.ts';
import { GESTURE, type GestureRef, trackGestures } from './choreo/gesture.ts';
import {
  boundsOf as bounds,
  measure,
  type Snapshot,
} from './choreo/measure.ts';
import { type ChoreoHost, setChoreoHost } from './choreo/registry.ts';
import { type ChoreoRun, execute } from './choreo/run.ts';
import {
  Aim,
  Camera,
  collect,
  Crossing,
  Follow,
  Frame,
  Gate,
  Hold,
  Move,
  Pan,
  Parallel,
  Perform,
  Raise,
  Scroll,
  Sequence,
  SlowZoom,
  Spring,
  Tether,
  Tween,
  Wait,
} from './choreo/steps.gts';
import type {
  Bounds,
  CameraState,
  ChoreoNode,
  Cue,
  PerformCommand,
  Query,
  Sprite,
  SpriteType,
} from './choreo/types.ts';
import { snapshotOnRender } from './layout-group.gts';
import { flushPendingMounts } from './node.ts';
import { postRender } from './scheduler.ts';
import { motionSpeed } from './speed.ts';

/** `{{c.kept 'card'}}` narrows by role; bare `{{c.kept}}` is handed over uncalled, so the function is a Query too */
type Selector = ((role?: string) => Query) & Query;
const selector = (type?: Query['type']): Selector =>
  Object.assign(
    (role?: string): Query => (role === undefined ? { type } : { role, type }),
    { type },
  );

/** what the region yields: the step components and the sprite queries */
export interface ChoreoContext {
  Aim: typeof Aim;
  Camera: typeof Camera;
  Crossing: typeof Crossing;
  Follow: typeof Follow;
  Frame: typeof Frame;
  Gate: typeof Gate;
  Hold: typeof Hold;
  Move: typeof Move;
  Pan: typeof Pan;
  Parallel: typeof Parallel;
  Perform: typeof Perform;
  Raise: typeof Raise;
  Scroll: typeof Scroll;
  Sequence: typeof Sequence;
  SlowZoom: typeof SlowZoom;
  Spring: typeof Spring;
  Tether: typeof Tether;
  Tween: typeof Tween;
  Wait: typeof Wait;
  /** open the gate the run is parked at; template-stable, because gates are wired in templates */
  advance: () => void;
  all: Selector;
  /** `{{c.beacon 'trash'}}` — a named box to borrow, for Move's @from / @to */
  beacon: (name: string) => BeaconRef;
  /**
   * Where the region's frame stands — tracked, updated when a camera step
   * lands or cancels, deliberately not per frame (§9): app logic may derive
   * from it (the zoom-threshold transmute) without a feedback loop.
   */
  readonly camera: CameraState;
  /** the removed half an arriving element claimed — orphaned, ready to cross-fade */
  counterpart: Selector;
  /** the live drag as geometry: its pose as a box, its velocity into springs */
  gesture: GestureRef;
  id: (id: string) => Query;
  inserted: Selector;
  kept: Selector;
  moved: Selector;
  /** narrow any query to sprites a viewport can actually see (§4.7) */
  onstage: (query: Query) => Query;
  /** kept only because it claimed a leaver's identity: the receiving half of a counterpart or far match */
  received: Selector;
  removed: Selector;
  role: (role: string) => Query;
  /** the current pass's run, as a value you can hold — null between passes (§4.6) */
  readonly run: ChoreoRun | null;
  still: Selector;
}

function contextFor(region: Choreo): ChoreoContext {
  return {
    Aim,
    Camera,
    Crossing,
    Follow,
    Frame,
    Gate,
    Hold,
    Move,
    Pan,
    Parallel,
    Perform,
    Raise,
    Scroll,
    Sequence,
    SlowZoom,
    Spring,
    Tether,
    Tween,
    Wait,
    advance: () => region.run?.advance(),
    all: selector(),
    beacon: (beacon) => ({ beacon }),
    gesture: GESTURE,
    counterpart: selector('counterpart'),
    id: (id) => ({ id }),
    inserted: selector('inserted'),
    kept: selector('kept'),
    moved: selector('moved'),
    onstage: (query) => ({ ...query, onstage: true }),
    received: selector('received'),
    removed: selector('removed'),
    role: (role) => ({ role }),
    get camera() {
      return region.cameraState;
    },
    get run() {
      return region.run ?? null;
    },
    still: selector('still'),
  };
}

interface Signature {
  Args: {
    /** outline the region and its participants; console.table each run */
    debug?: boolean;
    id?: string;
    /**
     * The dispatcher for `<c.Perform>` commands (§C4). Called once per
     * command as the run's clock comes to include it — during forward
     * playback as the clock crosses it, after a seek that lands past it,
     * and again for the whole remaining prefix after a backward fold.
     * Dispatches are deferred past the render pass, so a command may
     * mutate tracked state freely.
     */
    onPerform?: (command: PerformCommand) => void;
    /**
     * The backward half of the fold: the clock moved to before a command
     * the host already holds. Reset every commanded state here; the run
     * re-dispatches the remaining prefix, in order, immediately after.
     */
    onPerformReset?: () => void;
    /**
     * Freeze the rest of the page for the span of each run (§4.7): when a
     * run starts, every animation in the document that is running AT THAT
     * MOMENT — and that the run itself does not own — is paused, and played
     * again when the run lands or is cancelled. The run's own animations
     * are exempt by construction: the sweep happens before they exist.
     * Pausing is not stopping — a loop resumes exactly where it was, which
     * is what makes this safe to do to work the region did not write.
     * Animations that START during the run are not caught; gating those is
     * the host's job (the crossing flag the gallery's entrances check).
     */
    quiet?: boolean;
    /**
     * Treat a subtree swap as one crossing pass (§4.7): scroll intent is
     * applied inside the pass — after the swap renders, before final bounds
     * are measured — and the tempo control's zero means no run at all. The
     * region stays router-agnostic (§9): any swap qualifies, however the
     * host caused it.
     */
    route?: boolean;
    /** where the arriving scene wants the window: the top, or wherever the thunk says */
    scroll?: 'top' | (() => number);
  };
  Blocks: { default: [ChoreoContext] };
  Element: HTMLDivElement;
}

let debugStyle: HTMLStyleElement | undefined;

/**
 * One rule every region shares: an orphaned skin flies with its
 * backdrop-filters OFF. A backdrop-filter can never be cached — it
 * re-samples and re-blurs whatever is behind it on every frame — and
 * inside a scaling, fading leaver that is paid at full price for the
 * whole flight (the camera demo's four glass panels, over its gradient
 * washes, was the return trip's jank). It is also the wrong picture: a
 * skin is a memory of the OLD scene, and its glass sampling the new
 * scene behind it shows the wrong world. The panels keep their own
 * translucent grounds, so they still read as glass in the crossfade.
 */
let orphanStyle: HTMLStyleElement | undefined;
function ensureOrphanStyle() {
  if (orphanStyle) {
    return;
  }
  orphanStyle = document.createElement('style');
  orphanStyle.setAttribute('data-choreo-style', '');
  orphanStyle.textContent =
    '[data-choreo-orphans] *{backdrop-filter:none!important;' +
    '-webkit-backdrop-filter:none!important;}';
  document.head.appendChild(orphanStyle);
}

/**
 * A fingerprint of the collected timeline tree, for telling an EDIT from
 * noise while a run's own orphans are aloft. Mid-flight, compiled cues are
 * value-laden (every re-measure shifts them), so sameScore cannot answer
 * "did the author change the timeline?" — but the tree can: it is template
 * state, identical under noise, different under any real edit. Functions
 * (property sources) print by identity: a fresh function is a change we
 * cannot disprove, and recompiling is the safe answer.
 */
const fnIds = new WeakMap<object, number>();
let nextFnId = 0;
function treePrint(tree: unknown): string {
  return JSON.stringify(tree, (_key, value: unknown) => {
    if (typeof value === 'function') {
      let id = fnIds.get(value);
      if (id === undefined) {
        fnIds.set(value, (id = ++nextFnId));
      }
      return `fn#${id}`;
    }
    return value;
  });
}

/**
 * The color the page actually shows behind this region — the nearest
 * ancestor (the region itself included) wearing a background with any
 * alpha at all. What a crossing blends a semi-transparent skin against
 * when it turns opacity into an actual color (§4.7). Undefined when the
 * whole chain is transparent; the crossfade then stays a plain dissolve.
 */
function groundOf(root: Element): string | undefined {
  let el: Element | null = root;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) {
      return bg;
    }
    el = el.parentElement;
  }
  return undefined;
}

/**
 * The barrier books one post-render callback for every region taking part in a
 * pass. `joinPass(this)` is where the region's PassHost contract (measurePass /
 * finishPass) is type-checked — it is not on the class, because a `.gts` class
 * header cannot carry two `implements` clauses through the build.
 */
setPassScheduler((run) => postRender(run));
setBeforeMeasure(() => flushPendingMounts());

export class Choreo extends Component<Signature> implements ChoreoHost {
  private element?: HTMLDivElement;
  private orphanLayer?: HTMLDivElement;
  private raisedLayer?: HTMLDivElement;
  private tetherLayer?: SVGSVGElement;
  /** tracked mirror of the frame's resting state — see ChoreoContext.camera */
  @tracked cameraState: CameraState = { x: 0, y: 0, zoom: 1 };
  /**
   * The same state, untracked, for the pass pipeline itself. A pass runs
   * inside computations that must not CONSUME the tracked mirror — a pass
   * that read it would be invalidated by the very landing it causes, and
   * the region would render forever.
   */
  private restingCamera: CameraState = { x: 0, y: 0, zoom: 1 };
  private participants = new Set<ChoreoNode>();
  /** registered since the last pass */
  private arrived = new Set<ChoreoNode>();
  /** destroyed before the pass that removed them has been processed */
  private claimed = new Set<ChoreoNode>();
  /** removed participants this region is keeping alive in its orphan layer */
  private orphans = new Set<ChoreoNode>();
  /** participants whose Presence is letting them go: removed once, not on every pass while they leave */
  private leaving = new Set<ChoreoNode>();
  private snapshots = new Map<ChoreoNode, Snapshot>();
  private rootSnapshot?: DOMRect;
  private passPending = false;
  private rendered = false;
  run?: ChoreoRun;
  private context = contextFor(this);
  /** the last changeset this region built — read it from a property function or a test */
  changeset?: Changeset;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    trackGestures();
    // what `animationsSettled()` waits for: a pass announced but not yet run,
    // or a timeline still playing. Orphans are deliberately not counted — a
    // leaver stranded in the layer is a bug, and a probe that reported it
    // would turn every one of those into a timeout instead of a failed
    // assertion with a name on it.
    const stopProbe = registerBusyProbe(() => {
      if (this.passPending) {
        return `<Choreo${this.args.id ? ` ${this.args.id}` : ''}> pass pending`;
      }
      // parked is a still and STANDING is an annotation that is simply on
      // (a score of nothing but open steps never ends): both are settled,
      // and a probe that called either one "in flight" would turn every
      // wire the page leaves up into a suite-wide timeout
      if (
        this.run &&
        !this.run.isDone() &&
        !this.run.parked &&
        !this.run.standing
      ) {
        return `<Choreo${this.args.id ? ` ${this.args.id}` : ''}> run in flight`;
      }
      return false;
    });
    registerDestructor(this, () => {
      stopProbe();
      leavePass(this);
      this.run?.cancel();
      this.run = undefined;
      // a quiet region must not take its pause to the grave
      this.unquiet();
      for (const node of [...this.orphans, ...this.claimed]) {
        this.drop(node);
      }
    });
  }

  /* ---- ChoreoHost ---- */

  register(node: ChoreoNode) {
    this.participants.add(node);
    this.arrived.add(node);
    if (this.args.debug && node.element) {
      (node.element as HTMLElement).style.outline = '1px dotted #16a34a';
      // the seam lints (§5.3): inside a region the timeline is the only
      // animation authority, and Presence double-retains participants
      if (node.ownAnimation) {
        console.warn(
          `choreo: participant '${node.id ?? node.role}' carries its own ` +
            'animate/exit/initial — a second scheduler beside the timeline',
        );
      }
      if (node.presenceManaged) {
        console.warn(
          `choreo: participant '${node.id ?? node.role}' is inside a ` +
            '<Presence> — the region already retains its own leavers',
        );
      }
    }
    return () => {
      // a destroyed participant may still be claimed (below); the sets that decide that survive until drop()
      this.participants.delete(node);
      this.arrived.delete(node);
    };
  }

  claim(node: ChoreoNode) {
    if (this.orphans.has(node)) {
      return true;
    }
    if (this.passPending) {
      // its pass has not been processed yet: decide then
      this.claimed.add(node);
      return true;
    }
    return false;
  }

  /* ---- the render pass ---- */

  /* eslint-disable ember/no-side-effects -- this getter IS the render hook: boxel-motion's render detector,
     re-evaluated on every render pass before the DOM is patched (React's getSnapshotBeforeUpdate slot) */
  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    // A region is a layout boundary as well: projecting participants
    // (`layout` / `layoutId`) snapshot here too, so `{{motion layout=true}}`
    // works inside a <Choreo> without a <LayoutGroup> wrapped around it.
    snapshotOnRender();
    if (!this.passPending) {
      this.passPending = true;
      this.snapshot();
      // every region announces here, while Glimmer is still rendering, so the
      // barrier knows the whole cast before anybody measures
      joinPass(this);
    }
    return undefined;
  }
  /* eslint-enable ember/no-side-effects */

  private snapshot() {
    this.snapshots.clear();
    this.rootSnapshot = this.element?.getBoundingClientRect();
    for (const node of this.participants) {
      const el = node.element;
      if (el?.isConnected && !this.orphans.has(node)) {
        this.snapshots.set(node, measure(el));
      }
    }
  }

  /** phase 1: what changed this pass, measured — nothing is played yet */
  measurePass(): Pass | undefined {
    this.passPending = false;
    const root = this.element;
    if (!root) {
      return undefined;
    }
    // THE FAST PATH: a volatile re-pass that cannot change the run. On a
    // busy page every app render replays every region's pass, and the full
    // pipeline is destructive even when its verdict is "keep" — release
    // puts the world at rest (stopping the very animations it measures
    // around), and standing them back up once per frame IS the jitter the
    // keep exists to prevent. So a pass with no arrivals, no new leavers
    // and the same timeline tree is declined before anything is touched:
    // the run plays on, undisturbed.
    if (this.fastKeep(root)) {
      return undefined;
    }
    // `initial` was captured before the DOM changed, with any in-flight Move's
    // values still on the elements — that is what was on screen. `final` must
    // be the layout the stylesheet actually asks for, so put everything the
    // last run touched back to rest before measuring anything.
    this.run?.releaseForMeasure();
    // @route: scroll is part of the move (§4.7) — the window is placed where
    // the arriving scene wants it after the swap renders and BEFORE final
    // bounds are measured, so every landing is measured where it will live
    if (this.args.route && this.arrived.size && this.snapshots.size) {
      const intent = this.args.scroll ?? 'top';
      const y = intent === 'top' ? 0 : intent();
      window.scrollTo(0, y);
    }
    const before = this.rootSnapshot ?? root.getBoundingClientRect();
    const after = root.getBoundingClientRect();
    const inserted: Sprite[] = [];
    const removed: Sprite[] = [];
    const kept: Sprite[] = [];
    const sprite = (
      node: ChoreoNode,
      type: SpriteType,
      initial?: Bounds,
      final?: Bounds,
    ): Sprite => ({
      delta:
        initial && final
          ? {
              height: final.page.height - initial.page.height,
              width: final.page.width - initial.page.width,
              x: final.page.x - initial.page.x,
              y: final.page.y - initial.page.y,
            }
          : undefined,
      element: node.element as HTMLElement,
      final,
      id: node.id,
      initial,
      node,
      role: node.role,
      type,
    });
    const candidates = new Set([
      ...this.participants,
      ...this.claimed,
      ...this.orphans,
    ]);
    for (const node of candidates) {
      const el = node.element;
      if (!el) {
        continue;
      }
      const snap = this.snapshots.get(node);
      if (this.orphans.has(node)) {
        // still in flight from an earlier run: addressable again as removed
        const prior = this.orphanBounds.get(node);
        removed.push(sprite(node, 'removed', prior));
      } else if (this.arrived.has(node)) {
        inserted.push(
          sprite(node, 'inserted', undefined, bounds(measure(el), after)),
        );
      } else if (!el.isConnected || this.claimed.has(node)) {
        if (this.leaving.has(node)) {
          // its Presence has let it go — we already played its exit
          this.leaving.delete(node);
          this.drop(node);
        } else if (snap) {
          removed.push(sprite(node, 'removed', bounds(snap, before)));
        } else if (this.claimed.has(node)) {
          this.drop(node);
        }
      } else if (!node.isPresent) {
        if (!this.leaving.has(node) && snap) {
          this.leaving.add(node);
          removed.push(sprite(node, 'removed', bounds(snap, before)));
        }
      } else if (snap) {
        this.leaving.delete(node);
        kept.push(
          sprite(
            node,
            'kept',
            bounds(snap, before),
            bounds(measure(el), after),
          ),
        );
      }
    }
    // an inserted id that matches a removed one: the new element carries the old as its counterpart
    for (const s of inserted) {
      if (s.id === null) {
        continue;
      }
      const old = removed.find((r) => r.id === s.id && !r.counterpart);
      if (old) {
        old.claimed = true;
        s.counterpart = old;
        s.initial = old.initial;
        s.type = 'kept';
        s.delta = s.initial &&
          s.final && {
            height: s.final.page.height - s.initial.page.height,
            width: s.final.page.width - s.initial.page.width,
            x: s.final.page.x - s.initial.page.x,
            y: s.final.page.y - s.initial.page.y,
          };
      }
    }
    this.arrived.clear();
    this.snapshots.clear();
    const claimed = [...this.claimed];
    this.claimed.clear();
    // the barrier now pairs any id inserted here against the same id removed in
    // ANOTHER region, before finishPass compiles a timeline against the result
    return { claimed, host: this, inserted, kept, removed, root };
  }

  /** phase 3: identities are settled — compile this region's timeline and play it */
  finishPass(pass: Pass) {
    const { claimed, inserted, kept, root } = pass;
    // a sprite whose identity was received by another region is not leaving:
    // the element that carries it on is already being animated over there
    const removed = pass.removed.filter((s) => !s.sent);
    for (const s of pass.removed) {
      if (s.sent) {
        this.finish(s);
      }
    }
    const after = root.getBoundingClientRect();
    // The zoom every box below was measured under (§6.3) — read from the
    // PAINTED frame, never from the run's bookkeeping. While a camera cue
    // flies on WAAPI the shadow value is one rAF behind the compositor,
    // and inside a fast cue that one frame is the whole flight: fitted
    // zooms cancel the mismatch, but translate targets keep it forever,
    // and a chain of replacement passes compounds it (the reel's loop
    // seams landed every shot hundreds of pixels off, differently per
    // loop). getComputedStyle samples the same frozen timeline the rects
    // above were measured under, so zoom and boxes are one measurement.
    const paintedTf = getComputedStyle(root).transform;
    const painted =
      paintedTf === 'none' || paintedTf === ''
        ? 1
        : parseFloat(/^matrix\(([-\d.eE+]+),/.exec(paintedTf)?.[1] ?? '');
    const shadow = this.run?.camera.zoom ?? this.restingCamera.zoom;
    // …snapped to the exact bookkeeping value whenever the two agree: the
    // computed matrix is serialized to a handful of digits, and letting
    // that quantisation into the divide gives two passes of the same
    // still landings a thousandth of a pixel apart. The painted value
    // only OVERRULES the shadow when they genuinely diverge.
    const measureZoom =
      !painted || Math.abs(painted - shadow) < 0.002 ? shadow : painted;
    const changeset = new Changeset(
      inserted.filter((s) => s.type === 'inserted'),
      removed,
      [...kept, ...inserted.filter((s) => s.type === 'kept')],
      // measured in the same window as `final`, and re-measured every pass: a
      // beacon can move without this region rendering at all
      measureBeacons(after),
      measureZoom,
      // the frame's own size in the same final layout, local pixels — the
      // camera's centre reference, so aim terms are internally consistent
      {
        height: after.height / measureZoom,
        width: after.width / measureZoom,
      },
      groundOf(root),
    );
    this.changeset = changeset;

    const firstRender = !this.rendered;
    this.rendered = true;
    // instant means instant on a crossing: no run, not a zero-length run
    if (this.args.route && motionSpeed() === 0) {
      for (const node of claimed) {
        this.drop(node);
      }
      for (const s of removed) {
        this.finish(s);
      }
      return;
    }
    // A pass whose changeset is all-kept still runs its timeline (§3.1):
    // the share badge, the hot wire — a Hold with a lifetime fired by an
    // event that inserts, removes and moves nothing. Steps that select
    // change (inserted / removed / moved) produce no cues on such a pass.
    const tree = firstRender ? [] : collect(root);
    const compiled = tree.length
      ? compile(tree, changeset)
      : { cues: [], gates: [] };
    const cues = compiled.cues;
    // CONTINUITY (§3.1): sprites the prior run is still driving through
    // space, which this new score does not name, would be dropped to
    // rest in ONE FRAME — the whole-bay snap every conditional timeline
    // had to hand-patch with a `c.moved` twin. The changeset already
    // reads a flying sprite as kept-and-moved (its initial is the painted
    // box, by design), so the score is completed rather than overridden:
    // each gets a continuation move from where it is painted to its rest.
    // Before the empty-score bail on purpose — a timeline that un-renders
    // mid-flight compiles NOTHING, and that bail neither cancels the run
    // nor reasserts the world: the release itself was the snap. A sprite
    // that merely REFLOWED is untouched — it was never driven.
    if (this.run && !this.run.isDone()) {
      const scored = new Set(cues.map((c) => c.sprite.node));
      for (const [node, transition] of this.run.midflight()) {
        if (scored.has(node)) {
          continue;
        }
        const s = changeset.kept.find((k) => k.node === node);
        if (!s) {
          continue;
        }
        const cue = continuation(s, changeset, transition);
        if (cue) {
          cues.push(cue);
        }
      }
    }
    if (!cues.length) {
      // nothing to play: let every leaver go now
      for (const node of claimed) {
        this.drop(node);
      }
      for (const s of removed) {
        // §5.3, from the other side of the seam: on a pass this region
        // declines to animate, a <Presence>-managed leaver still mid-exit
        // belongs to its Presence — calling exitComplete here would cut
        // that animation short. The region stands aside; when the exit
        // ends, Presence unmounts the element and it leaves for real.
        if (
          s.node.presenceManaged &&
          !s.node.isPresent &&
          s.element.isConnected &&
          !this.orphans.has(s.node)
        ) {
          this.leaving.delete(s.node);
          continue;
        }
        this.finish(s);
      }
      return;
    }
    // An unrelated render replays every region's pass — the detector is
    // volatile by design, so on a busy page (the gallery: a neighbouring
    // demo writing tracked state per frame) a region re-passes on every
    // app render. A finished run replays (§3.1's Hold re-fire). An
    // all-still pass — no arrivals, leavers, or moved boxes — is noise
    // (a parent writing `hot`, a neighbour ticking at 60fps) and must
    // not restart the clock. Gates and path-moves make a freshly compiled
    // cue list incomparable (zero-delta Moves drop; flights exist), so
    // sameScore cannot be the only detector.
    //
    // A removed sprite that is one of this region's own ORPHANS is not a
    // new leaver: it re-enters every changeset on purpose (addressable
    // again), and while one is aloft a recompiled score is NOT
    // authoritative — the pairing that produced the run's flights lived
    // in the pass that removed and inserted together, and a later pass
    // sees only the orphan half. Counting orphans as dirt meant a
    // crossing on a busy page was cancelled into a leave-only rump by
    // its own neighbours' renders, every frame.
    const print = treePrint(tree);
    const nothingNew =
      !inserted.length &&
      pass.removed.every((s) => this.orphans.has(s.node)) &&
      // A sprite mid-flight reads as "moved" on every re-pass — its initial
      // is the painted box, by design — so while this run's own orphans are
      // aloft, kept-motion cannot justify a recompile either: the score it
      // would produce is the degraded one above.
      (this.orphans.size > 0 || !changeset.sprites({ type: 'moved' }).length) &&
      // …but an EDITED timeline is never noise: a changed tree replays,
      // exactly as it would with no orphans aloft (the build-order
      // transport's delay nudge, made while a leaver is frozen mid-park)
      print === this.scorePrint;
    if (this.run && !this.run.isDone() && nothingNew) {
      for (const node of claimed) {
        this.drop(node);
      }
      // the measurement above put the run's world at rest; a keep must be
      // invisible, so the run stands its picture back up (see reassert)
      this.run.reassert();
      return;
    }
    // dirty but the compiled score is the one already in flight (tween-only
    // measurement jitter): keep that run too.
    if (
      this.run &&
      !this.run.isDone() &&
      !inserted.length &&
      !pass.removed.length &&
      !compiled.gates.length &&
      sameScore(this.run.cues, cues)
    ) {
      for (const node of claimed) {
        this.drop(node);
      }
      this.run.reassert();
      return;
    }
    // the removed participants the run names stay; the rest go now
    const named = new Set(cues.map((c) => c.sprite));
    for (const s of [...kept, ...inserted]) {
      if (s.counterpart && named.has(s)) {
        named.add(s.counterpart);
      }
    }
    const prior = this.run;
    // Which camera the replacement starts from is decided by WHAT it is.
    // The same score recompiled mid-run is a re-execution of the same
    // timeline: it inherits the prior run's fold origin, so a seek's
    // reconstruction folds the score's prefix once and only once —
    // handing it the pose in force would fold every relative cue on top
    // of the pose that cue already produced, and the world doubles
    // (world-dock-test). A NEW score responds to the world as it stands:
    // it starts from the pose actually applied, which mid-flight is the
    // prior run's live shadow, not the last landed state.
    const inherited =
      prior !== undefined && !prior.isDone()
        ? print === this.scorePrint
          ? { aim: prior.initialAim, camera: prior.initialCamera }
          : { aim: prior.cameraAim, camera: prior.camera }
        : { aim: prior?.cameraAim ?? null, camera: this.restingCamera };
    prior?.cancel(new Set([...named].map((s) => s.node)));
    for (const s of removed) {
      if (!named.has(s)) {
        this.finish(s);
      } else if (!s.element.isConnected || claimed.includes(s.node)) {
        this.orphan(s, removed, s.claimed === true);
      }
    }
    if (this.args.debug) {
      // the hierarchy lint (§6.3): a removed participant no step names will
      // simply vanish — the uncanny valley the deck warns about
      for (const s of removed) {
        if (!named.has(s)) {
          console.warn(
            `choreo: removed participant '${s.id ?? s.role}' is named by ` +
              'no step — it vanishes without a frame',
          );
        }
      }
      this.log(changeset, cues);
    }
    this.scorePrint = print;
    // taken here, with the world released and measured: the resting layout
    // this run is about to fly away from (see fastKeep)
    this.layoutPrint = this.layoutOf();
    // @quiet: pause everything running RIGHT NOW — the run's own animations
    // do not exist yet, so they are exempt by construction. Accumulated,
    // not replaced: an interrupted run's replacement sweeps again, and
    // everything resumes together when the run that survives settles.
    if (this.args.quiet) {
      this.quiet();
    }
    this.run = execute(compiled, {
      camera: { ...inherited.camera },
      cameraFrame: this.element,
      // the aim point in force carries run to run, so a re-aim lerps from
      // what is actually applied rather than assuming an unaimed frame —
      // except a same-score re-execution, which carries the fold origin
      cameraAim: inherited.aim,
      // updated at step boundaries only — a still value app logic can
      // read. Guarded by equality: the landing itself renders, the render
      // is an all-kept pass, and the pass replays the camera step — an
      // unguarded set would revalidate forever.
      onCamera: (state) => {
        const prior = this.restingCamera;
        this.restingCamera = state;
        if (
          prior.zoom !== state.zoom ||
          prior.x !== state.x ||
          prior.y !== state.y
        ) {
          // the library's own host hook — the Ember adapter installs the
          // runloop's afterRender behind it, and this file stays host-blind
          postRender(() => (this.cameraState = state));
        }
      },
      raisedLayer: this.raisedLayer,
      tetherLayer: this.tetherLayer,
      // ember-animated's continuity, in the terms motion-dom offers: it sums a
      // corrective curve onto the one it interrupted, which transfers velocity
      // implicitly; a spring takes a velocity outright, so the run that is
      // being replaced hands over how fast everything was going.
      inherit: prior?.velocities,
      onPerform: this.args.onPerform,
      onPerformReset: this.args.onPerformReset,
      onSpriteDone: (s) => this.finish(s),
      removed: removed.filter((s) => named.has(s)),
    });
    if (this.args.quiet) {
      const run = this.run;
      void run.finished.then(() => {
        // only the run still in charge hands the page back — a cancelled
        // one was replaced, and its replacement holds the pause
        if (this.run === run) {
          this.unquiet();
        }
      });
    }
  }

  /* ---- orphans: a removed participant kept alive, locked where it was ---- */

  private orphanBounds = new Map<ChoreoNode, Bounds>();

  /** the fingerprint of the tree the current run compiled from (see treePrint) */
  private scorePrint?: string;

  /** the layout every participant stood in when the run compiled (see layoutPrint) */
  private layoutPrint?: string;

  /**
   * Where the stylesheet puts each participant, as a string.
   *
   * `offsetLeft/Top/Width/Height` and NOT a bounding rect, because the
   * difference is the whole point: a rect includes the transform a flight
   * is writing, so a moving element reads as different on every frame,
   * while offsets are the box layout asked for — steady under a transform,
   * and different the moment something actually reflows. Integers, too,
   * which quietly forgives the sub-pixel noise a busy page generates.
   *
   * A Move that animates real width/height (`@size={{true}}`) does change
   * these, so such a run never takes the fast path. That is the honest
   * answer rather than a missed optimisation: a run writing layout cannot
   * be told apart from a page writing layout without measuring.
   *
   * Offsets are accumulated up the offset chain to the region, not read
   * at the participant alone, because what a render moves may be an
   * ANCESTOR that is no participant of anything — Escort's seat, one
   * positioned wrapper carrying three participants. Read flat, the
   * fingerprint was blind to exactly the reflow a retarget makes, the
   * pass was declined, and the old run played on against the moved
   * layout: card, badge and shadow teleported a whole bay, together. The
   * walk stops at the region's edge so the page above it stays out of the
   * print — a busy neighbour reflowing above the region must not cancel
   * its runs.
   */
  private layoutOf(): string {
    const root = this.element;
    const parts: string[] = [];
    for (const node of this.participants) {
      const el = node.element as HTMLElement | undefined | null;
      if (!el || !el.isConnected) {
        continue;
      }
      let x = 0;
      let y = 0;
      let walk: HTMLElement | null = el;
      while (walk && walk !== root && root?.contains(walk)) {
        x += walk.offsetLeft;
        y += walk.offsetTop;
        const parent: Element | null = walk.offsetParent;
        walk = parent instanceof HTMLElement ? parent : null;
      }
      parts.push(
        `${node.id ?? node.role ?? ''}@${x},${y},` +
          `${el.offsetWidth},${el.offsetHeight}`,
      );
    }
    return parts.join('|');
  }

  /**
   * Can this pass be declined outright? Only while a run is in flight, and
   * only when nothing the pass could discover would change it: no arrivals,
   * no retentions pending, every participant either present or already a
   * known leaver, the collected timeline tree fingerprints identical to the
   * one the run compiled from (an EDIT always replays), and every
   * participant standing in the same layout box it compiled in (a REFLOW
   * always replays — it is what a Move is FOR). Anything else takes the
   * full pipeline.
   */
  private fastKeep(root: HTMLElement): boolean {
    if (
      !this.run ||
      this.run.isDone() ||
      this.claimed.size ||
      this.arrived.size
    ) {
      return false;
    }
    for (const node of this.participants) {
      const el = node.element;
      if (!el || !el.isConnected) {
        return false;
      }
      if (
        !node.isPresent &&
        !this.leaving.has(node) &&
        !this.orphans.has(node)
      ) {
        return false;
      }
    }
    return (
      treePrint(collect(root)) === this.scorePrint &&
      this.layoutOf() === this.layoutPrint
    );
  }

  /* ---- @quiet: the rest of the page, paused for the span of a run ---- */

  /** what quiet() paused, accumulated across replaced runs, resumed as one */
  private quieted: Animation[] = [];

  private quiet() {
    for (const animation of document.getAnimations()) {
      if (animation.playState === 'running') {
        animation.pause();
        this.quieted.push(animation);
      }
    }
  }

  private unquiet() {
    for (const animation of this.quieted.splice(0)) {
      try {
        animation.play();
      } catch {
        // an animation whose element left with the old scene: nothing to resume
      }
    }
  }

  private orphan(s: Sprite, removed: Sprite[], extract = false) {
    // Only the topmost removed element is moved; what it contains comes with
    // it — EXCEPT a claimed skin. Its whole job is to cross inside the flight,
    // and riding a fading ancestor instead is the View Transitions nesting
    // rule (never name a container of named things) sneaking back in. A
    // claimed sprite is lifted out of the doomed subtree; both end up locked
    // to the same page coordinates in the same layer, so the lift is
    // invisible — all it leaves behind is a hole in the ancestor, which is
    // exactly where the eye expects one while the skin is elsewhere.
    const inside = removed.some(
      (o) =>
        o !== s && o.element !== s.element && o.element.contains(s.element),
    );
    if ((inside && !extract) || !s.initial) {
      return;
    }
    const layer = this.orphanLayer;
    const root = this.element;
    if (!layer || !root) {
      return;
    }
    // Page measurements carry every transform above the region — its own
    // camera, and whatever is carrying the whole region this frame (a
    // page crossing scaling the stage). The lock is written as LOCAL
    // pixels inside the equally-transformed orphan layer, so the scale
    // must come back out or it is applied twice and the leaver jumps the
    // moment it is lifted — the raise learned this same rule.
    const now = root.getBoundingClientRect();
    const sx = root.offsetWidth ? now.width / root.offsetWidth : 1;
    const sy = root.offsetHeight ? now.height / root.offsetHeight : 1;
    if (inside) {
      // hold the seat: the ancestor is itself a leaver, and without this its
      // remaining children reflow into the gap mid-fade. The placeholder
      // lives only inside that doomed subtree, so it leaves with it.
      const seat = document.createElement('div');
      seat.style.width = `${s.initial.page.width / sx}px`;
      seat.style.height = `${s.initial.page.height / sy}px`;
      s.element.parentElement?.insertBefore(seat, s.element);
    }
    // locked where it was ON THE PAGE: the region itself may have moved in the same pass
    const { page } = s.initial;
    const el = s.element;
    el.style.position = 'absolute';
    el.style.left = `${(page.x - now.left) / sx}px`;
    el.style.top = `${(page.y - now.top) / sy}px`;
    el.style.width = `${page.width / sx}px`;
    el.style.height = `${page.height / sy}px`;
    el.style.boxSizing = 'border-box';
    el.style.margin = '0';
    el.style.pointerEvents = 'none';
    // one texture, transformed — not a subtree re-rastered per frame
    el.style.willChange = 'transform, opacity';
    layer.appendChild(el);
    this.orphans.add(s.node);
    this.orphanBounds.set(s.node, s.initial);
  }

  /** a removed sprite's row has ended */
  private finish(s: Sprite) {
    if (this.orphans.has(s.node) || this.participants.has(s.node)) {
      if (!s.element.isConnected || this.orphans.has(s.node)) {
        this.drop(s.node);
      } else if (!s.node.isPresent) {
        s.node.exitComplete();
      }
    } else {
      this.drop(s.node);
    }
  }

  private drop(node: ChoreoNode) {
    const el = node.element;
    if (el && this.orphans.has(node) && el.parentElement === this.orphanLayer) {
      el.remove();
    }
    this.orphans.delete(node);
    this.orphanBounds.delete(node);
    this.claimed.delete(node);
    this.leaving.delete(node);
    this.participants.delete(node);
    node.release();
  }

  /* ---- debug ---- */

  private log(changeset: Changeset, cues: Cue[]) {
    const id = this.args.id ?? '';
    const row = (s: Sprite) => ({
      choreo: id,
      final: s.final ? JSON.stringify(s.final.context) : null,
      id: s.id,
      initial: s.initial ? JSON.stringify(s.initial.context) : null,
      role: s.role,
      type: s.type,
    });
    console.table(changeset.all.map(row));
    console.table(
      cues.map((c) => ({
        choreo: id,
        duration: Math.round(c.duration),
        sprite: c.sprite.id ?? c.sprite.role,
        start: Math.round(c.start),
        step: c.kind,
        values: JSON.stringify(c.target ?? c.hold?.values ?? null),
      })),
    );
  }

  /* ---- template ---- */

  host = modifier((el: HTMLDivElement) => {
    this.element = el;
    setChoreoHost(el, this);
    ensureOrphanStyle();
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
    if (this.args.debug) {
      el.style.outline = '1px dashed #2563eb';
      if (!debugStyle) {
        debugStyle = document.createElement('style');
        debugStyle.textContent =
          '[data-choreo-orphans] > * { outline: 1px dotted #dc2626 !important; }';
        document.head.appendChild(debugStyle);
      }
    }
    return () => {
      setChoreoHost(el, undefined);
      this.element = undefined;
    };
  });

  layer = modifier((el: HTMLDivElement) => {
    this.orphanLayer = el;
    return () => {
      this.orphanLayer = undefined;
    };
  });

  raised = modifier((el: HTMLDivElement) => {
    this.raisedLayer = el;
    return () => {
      this.raisedLayer = undefined;
    };
  });

  tethers = modifier((el: SVGSVGElement) => {
    this.tetherLayer = el;
    return () => {
      this.tetherLayer = undefined;
    };
  });

  /**
   * The host is the scene: participants are its DIRECT children, so the
   * author's own grid/flex layout on the region element applies to them —
   * a wrapper here would silently unhook every gap and track. c.Camera
   * therefore drives the host element itself (§6.3), and the overlay
   * layers ride the frame with the content they annotate.
   */
  <template>
    {{this.renderDetector}}
    <div data-choreo={{if @id @id ''}} {{this.host}} ...attributes>
      <div
        data-choreo-orphans
        style='position:absolute;inset:0;pointer-events:none;overflow:visible'
        {{this.layer}}
      ></div>
      {{! the elevated layer: where c.Raise promotes the living — above every
          stacking context and clip in the region (§6.3) }}
      <div
        data-choreo-raised
        style='position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:2147483000'
        {{this.raised}}
      ></div>
      {{! the wires: geometry drawn between sprites, every frame (§6.1) }}
      <svg
        data-choreo-tethers
        style='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible'
        {{this.tethers}}
      ></svg>
      {{yield this.context}}
    </div>
  </template>
}

export default Choreo;
