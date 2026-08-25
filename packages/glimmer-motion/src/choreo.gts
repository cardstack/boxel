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
import compile, { sameScore } from './choreo/compile.ts';
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
  Camera,
  collect,
  Crossing,
  Gate,
  Hold,
  Move,
  Parallel,
  Raise,
  Scroll,
  Sequence,
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
  Camera: typeof Camera;
  Crossing: typeof Crossing;
  Gate: typeof Gate;
  Hold: typeof Hold;
  Move: typeof Move;
  Parallel: typeof Parallel;
  Raise: typeof Raise;
  Scroll: typeof Scroll;
  Sequence: typeof Sequence;
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
    Camera,
    Crossing,
    Gate,
    Hold,
    Move,
    Parallel,
    Raise,
    Scroll,
    Sequence,
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
      if (this.run && !this.run.isDone() && !this.run.parked) {
        return `<Choreo${this.args.id ? ` ${this.args.id}` : ''}> run in flight`;
      }
      return false;
    });
    registerDestructor(this, () => {
      stopProbe();
      leavePass(this);
      this.run?.cancel();
      this.run = undefined;
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
    // the zoom every box below was measured under (§6.3): the prior run's
    // live camera if a run was in flight, the resting state otherwise —
    // geometry that becomes inline pixels divides back by it
    const measureZoom = this.run?.camera.zoom ?? this.restingCamera.zoom;
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
    if (!cues.length) {
      // nothing to play: let every leaver go now
      for (const node of claimed) {
        this.drop(node);
      }
      for (const s of removed) {
        this.finish(s);
      }
      return;
    }
    // An unrelated render replays every region's pass — the detector is
    // volatile by design, so on a busy page (the gallery: a neighbouring
    // demo writing tracked state per frame) a region re-passes on every
    // app render. If nothing changed — no arrivals, no leavers, and the
    // compiled score IS the one already in flight — the run is kept:
    // sixty noisy frames a second must not restart this region's clock.
    // A finished run replays (§3.1's Hold re-fire is an event on a done
    // region), and any real difference — an edit, a move, a new sprite —
    // replays exactly as before.
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
    prior?.cancel(new Set([...named].map((s) => s.node)));
    for (const s of removed) {
      if (!named.has(s)) {
        this.finish(s);
      } else if (!s.element.isConnected || claimed.includes(s.node)) {
        this.orphan(s, removed);
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
    this.run = execute(compiled, {
      camera: { ...this.restingCamera },
      cameraFrame: this.element,
      // the aim point in force carries run to run, so a re-aim lerps from
      // what is actually applied rather than assuming an unaimed frame
      cameraAim: this.run?.cameraAim,
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
      onSpriteDone: (s) => this.finish(s),
      removed: removed.filter((s) => named.has(s)),
    });
  }

  /* ---- orphans: a removed participant kept alive, locked where it was ---- */

  private orphanBounds = new Map<ChoreoNode, Bounds>();

  private orphan(s: Sprite, removed: Sprite[]) {
    // only the topmost removed element is moved; what it contains comes with it
    const inside = removed.some(
      (o) =>
        o !== s && o.element !== s.element && o.element.contains(s.element),
    );
    if (inside || !s.initial) {
      return;
    }
    const layer = this.orphanLayer;
    const root = this.element;
    if (!layer || !root) {
      return;
    }
    // locked where it was ON THE PAGE: the region itself may have moved in the same pass
    const { page } = s.initial;
    const now = root.getBoundingClientRect();
    const el = s.element;
    el.style.position = 'absolute';
    el.style.left = `${page.x - now.left}px`;
    el.style.top = `${page.y - now.top}px`;
    el.style.width = `${page.width}px`;
    el.style.height = `${page.height}px`;
    el.style.boxSizing = 'border-box';
    el.style.margin = '0';
    el.style.pointerEvents = 'none';
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
