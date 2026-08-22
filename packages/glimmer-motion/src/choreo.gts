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
import { consumeTag, VOLATILE_TAG } from '@glimmer/validator';
import { modifier } from 'ember-modifier';

import Changeset from './choreo/changeset.ts';
import compile from './choreo/compile.ts';
import { type ChoreoHost, setChoreoHost } from './choreo/registry.ts';
import { execute, type Run } from './choreo/run.ts';
import {
  collect,
  Hold,
  Move,
  Parallel,
  Sequence,
  Spring,
  Tween,
  Wait,
} from './choreo/steps.gts';
import type {
  Bounds,
  ChoreoNode,
  Cue,
  Query,
  Rect,
  Sprite,
  SpriteType,
} from './choreo/types.ts';
import { flushPendingMounts } from './node.ts';
import { postRender } from './scheduler.ts';

/** `{{c.kept 'card'}}` narrows by role; bare `{{c.kept}}` is handed over uncalled, so the function is a Query too */
type Selector = ((role?: string) => Query) & Query;
const selector = (type?: Query['type']): Selector =>
  Object.assign(
    (role?: string): Query => (role === undefined ? { type } : { role, type }),
    { type },
  );

/** what the region yields: the step components and the sprite queries */
export interface ChoreoContext {
  Hold: typeof Hold;
  Move: typeof Move;
  Parallel: typeof Parallel;
  Sequence: typeof Sequence;
  Spring: typeof Spring;
  Tween: typeof Tween;
  Wait: typeof Wait;
  all: Selector;
  id: (id: string) => Query;
  inserted: Selector;
  kept: Selector;
  moved: Selector;
  removed: Selector;
  role: (role: string) => Query;
  still: Selector;
}

const context: ChoreoContext = {
  Hold,
  Move,
  Parallel,
  Sequence,
  Spring,
  Tween,
  Wait,
  all: selector(),
  id: (id) => ({ id }),
  inserted: selector('inserted'),
  kept: selector('kept'),
  moved: selector('moved'),
  removed: selector('removed'),
  role: (role) => ({ role }),
  still: selector('still'),
};

interface Signature {
  Args: {
    /** outline the region and its participants; console.table each run */
    debug?: boolean;
    id?: string;
  };
  Blocks: { default: [ChoreoContext] };
  Element: HTMLDivElement;
}

interface Snapshot {
  el: DOMRect;
  parent: DOMRect;
}

const rect = (r: DOMRect): Rect => ({
  height: r.height,
  width: r.width,
  x: r.left,
  y: r.top,
});
const minus = (a: DOMRect, b: DOMRect): Rect => ({
  height: a.height,
  width: a.width,
  x: a.left - b.left,
  y: a.top - b.top,
});
const bounds = (snap: Snapshot, root: DOMRect): Bounds => ({
  context: minus(snap.el, root),
  page: rect(snap.el),
  parent: minus(snap.el, snap.parent),
});
const measure = (el: Element): Snapshot => ({
  el: el.getBoundingClientRect(),
  parent: (
    (el as HTMLElement).offsetParent ??
    el.parentElement ??
    el
  ).getBoundingClientRect(),
});

let debugStyle: HTMLStyleElement | undefined;

export default class Choreo extends Component<Signature> implements ChoreoHost {
  private element?: HTMLDivElement;
  private orphanLayer?: HTMLDivElement;
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
  private run?: Run;
  /** the last changeset this region built — read it from a property function or a test */
  changeset?: Changeset;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    registerDestructor(this, () => {
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
    if (!this.passPending) {
      this.passPending = true;
      this.snapshot();
      postRender(() => this.afterPass());
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

  private afterPass() {
    this.passPending = false;
    flushPendingMounts();
    const root = this.element;
    if (!root) {
      return;
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
              height: final.parent.height - initial.parent.height,
              width: final.parent.width - initial.parent.width,
              x: final.parent.x - initial.parent.x,
              y: final.parent.y - initial.parent.y,
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
        s.counterpart = old;
        s.initial = old.initial;
        s.type = 'kept';
        s.delta = s.initial &&
          s.final && {
            height: s.final.parent.height - s.initial.parent.height,
            width: s.final.parent.width - s.initial.parent.width,
            x: s.final.parent.x - s.initial.parent.x,
            y: s.final.parent.y - s.initial.parent.y,
          };
      }
    }
    const changeset = new Changeset(
      inserted.filter((s) => s.type === 'inserted'),
      removed,
      [...kept, ...inserted.filter((s) => s.type === 'kept')],
    );
    this.changeset = changeset;
    this.arrived.clear();
    this.snapshots.clear();
    const claimed = [...this.claimed];
    this.claimed.clear();

    const firstRender = !this.rendered;
    this.rendered = true;
    const tree = firstRender || !changeset.dirty ? [] : collect(root);
    const cues = tree.length ? compile(tree, changeset) : [];
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
    // the removed participants the run names stay; the rest go now
    const named = new Set(cues.map((c) => c.sprite));
    for (const s of [...kept, ...inserted]) {
      if (s.counterpart && named.has(s)) {
        named.add(s.counterpart);
      }
    }
    this.run?.cancel(new Set([...named].map((s) => s.node)));
    for (const s of removed) {
      if (!named.has(s)) {
        this.finish(s);
      } else if (!s.element.isConnected || claimed.includes(s.node)) {
        this.orphan(s, removed);
      }
    }
    if (this.args.debug) {
      this.log(changeset, cues);
    }
    this.run = execute(cues, {
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

  <template>
    {{this.renderDetector}}
    <div data-choreo={{if @id @id ''}} {{this.host}} ...attributes>
      <div
        data-choreo-orphans
        style='position:absolute;inset:0;pointer-events:none;overflow:visible'
        {{this.layer}}
      ></div>
      {{yield context}}
    </div>
  </template>
}
