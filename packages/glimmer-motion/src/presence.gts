import { isDestroying, registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { consumeTag, VOLATILE_TAG } from '@glimmer/validator';
import { frame, type PresenceContextProps } from 'motion-dom';

import { snapshotOnRender } from './layout-group.gts';
import { flushPendingMounts } from './node.ts';
import type { PopMeasurable, PresenceHandle } from './presence-types.ts';
import { postRender } from './scheduler.ts';
import { captureExit, type ExitCopy } from './snapshot.ts';

/**
 * AnimatePresence for Glimmer — the same algorithm as Motion's
 * components/AnimatePresence (diff present vs rendered, keep leavers until
 * every exit inside them completes, `exitComplete` map, mode="wait", custom,
 * onExitComplete, propagate).
 *
 *   <Presence @items={{this.crumbs}} @key={{this.keyOf}} @mode="popLayout" as |crumb p|>
 *     <span {{motion presence=p initial=… animate=… exit=…}}>…</span>
 *   </Presence>
 *
 * Motion elements nested deeper inside a child inherit its presence through
 * their parent VisualElement, as React's PresenceContext would provide it.
 *
 * `@mode="snapshot"` is this package's own: a leaver's block is torn down in
 * the render that removes it, and a static copy of the element the handle was
 * passed to plays that element's exit, lifted out of flow at the seat the last
 * frame showed the element in. Use it where a leaver's content comes from
 * state that moves on as it leaves, such as a component's blocks: a live
 * leaver would re-render from that state, and stay focusable, with its ids
 * and form controls, beside its replacement. The copy is kept as a memory
 * (see memory.ts). See snapshot.ts.
 */
interface Signature<T> {
  Args: {
    anchorX?: 'left' | 'right';
    anchorY?: 'top' | 'bottom';
    custom?: unknown;
    initial?: boolean;
    items: T[];
    key: (item: T) => string;
    mode?: 'sync' | 'wait' | 'popLayout' | 'snapshot';
    onExitComplete?: () => void;
    parent?: PresenceHandle;
    /** nested presence: exit with the parent handle when it leaves */
    propagate?: boolean;
  };
  Blocks: { default: [T, PresenceHandle] };
}

let presenceId = 0;

/** PresenceChild: one context per rendered child, tracking the motion elements registered inside it */
class Entry<T> implements PresenceHandle {
  @tracked item: T;
  /** last presence seen by the diff — plain state, never read during render tracking */
  wasPresent = true;
  readonly id = `presence-${presenceId++}`;
  private children = new Map<string | number, boolean>();
  private subscribers = new Set<() => void>();
  /** popLayout and snapshot: the direct children, so they can be read before the DOM changes */
  private popCandidates = new Set<PopMeasurable>();
  subscribe(refresh: () => void) {
    this.subscribers.add(refresh);
    return () => this.subscribers.delete(refresh);
  }
  popCandidate(node: PopMeasurable) {
    this.popCandidates.add(node);
    return () => {
      this.popCandidates.delete(node);
    };
  }
  /** snapshot: each direct child reads its seat now; returns the elements those seats depend on */
  recordSeats(): Element[] {
    const watched: Element[] = [];
    this.popCandidates.forEach((node) => watched.push(...node.recordSeat()));
    return watched;
  }
  /** snapshot: static copies of the direct children, taken before the render that removes them */
  copiesForExit(): ExitCopy[] {
    const copies: ExitCopy[] = [];
    this.popCandidates.forEach((node) => {
      const source = node.exitForCopy();
      const copy = source && captureExit(source);
      if (copy) {
        copies.push(copy);
      }
    });
    return copies;
  }
  readonly key: string;
  private owner: Presence<T>;
  readonly initialBlocked: boolean;
  constructor(
    key: string,
    item: T,
    owner: Presence<T>,
    initialBlocked: boolean,
  ) {
    this.key = key;
    this.item = item;
    this.owner = owner;
    this.initialBlocked = initialBlocked;
  }
  /** derived from @items (and the parent handle) — nothing is mutated during render */
  get isPresent() {
    return this.owner.isKeyPresent(this.key);
  }
  get mode() {
    return this.owner.args.mode ?? 'sync';
  }
  get anchorX() {
    return this.owner.args.anchorX ?? 'left';
  }
  get anchorY() {
    return this.owner.args.anchorY ?? 'top';
  }
  get context(): PresenceContextProps {
    return {
      id: this.id,
      isPresent: this.isPresent,
      initial: this.initialBlocked ? (false as const) : undefined,
      custom: this.owner.args.custom,
      register: (childId) => {
        // React never re-renders a leaving child: the exiting subtree is the
        // element tree captured before the diff, so nothing can mount into it.
        // A Glimmer block re-runs from live state, so late arrivals DO mount
        // here — they have no exit of their own to wait for and must never be
        // able to block the exit that is already under way.
        const leaving = !this.isPresent;
        this.children.set(childId, leaving);
        if (leaving) {
          postRender(() => this.checkComplete());
        }
        return () => {
          this.children.delete(childId);
          if (!this.isPresent && !this.children.size) {
            this.owner.onExit(this.key);
          }
        };
      },
      onExitComplete: (childId) => {
        this.children.set(childId, true);
        this.checkComplete();
      },
    };
  }
  /** presence flipped (PresenceChild's isPresent effects): children report again; no children → done at once */
  presenceChanged(present: boolean) {
    if (!present && this.mode === 'popLayout') {
      // React's PopChildMeasure measures in getSnapshotBeforeUpdate — BEFORE
      // the DOM is patched. That timing is the whole of it. This runs from the
      // diff in `rendered`, the nearest slot Glimmer has: this <Presence>'s
      // newcomers for the pass have not been inserted yet, so the container
      // they would grow or re-center has not moved. Content earlier in the
      // template than this <Presence> has already been patched for the pass,
      // though, and a leaver it moves is measured where it was moved to.
      // (Snapshot mode pins its copies to a seat recorded before the pass
      // instead; see `seatWatch`.)
      //
      // Measure it afterwards and you read a layout that already contains the
      // arrivals: the container has grown, a centered one has re-centered, and
      // the leaver gets pinned at a place it never was. On a stage that
      // replays, every generation lands further from home than the last, and
      // what you see is a stack of ghosts drifting away from the newcomers.
      this.popCandidates.forEach((node) => node.measureForPop());
    }
    this.children.forEach((_, k) => this.children.set(k, false));
    postRender(() => this.notify());
    if (!present) {
      postRender(() => this.checkImmediateExit());
    }
  }
  notify() {
    flushPendingMounts();
    this.subscribers.forEach((fn) => fn());
  }
  /** every registered child has reported: the leaver is done */
  checkComplete() {
    if (this.isPresent) {
      return;
    }
    for (const done of this.children.values()) {
      if (!done) {
        return;
      }
    }
    this.owner.onExit(this.key);
  }
  checkImmediateExit() {
    flushPendingMounts();
    if (!this.isPresent && !this.children.size) {
      this.owner.onExit(this.key);
    }
  }
}

export class Presence<T> extends Component<Signature<T>> {
  private entries = new Map<string, Entry<T>>();
  private order: string[] = [];
  private lastItems?: T[];
  private firstRender = true;
  /** React's exitComplete map + exitingComponents set */
  private exitComplete = new Map<string, boolean>();
  private exiting = new Set<string>();
  private pendingItems: T[] = [];
  private registeredWithParent?: () => void;
  private readonly selfId = `presence:${presenceId++}`;
  /** snapshot: copies still playing an exit, by the key of the item they copied */
  private copies = new Map<ExitCopy, string>();
  /** snapshot: a read of the children's seats is booked for the next frame */
  private seatReadBooked = false;
  /** snapshot: re-reads the seats when a child, or the box it is pinned inside, resizes */
  private resizes?: ResizeObserver;
  private watched = new Set<Element>();
  @tracked private version = 0;

  constructor(owner: Owner, args: Signature<T>['Args']) {
    super(owner, args);
    registerDestructor(this, () => {
      this.registeredWithParent?.();
      this.copies.forEach((_, copy) => copy.cut());
      this.copies.clear();
      this.stopWatchingSeats();
    });
  }

  get parentPresent() {
    const { propagate, parent } = this.args;
    return !propagate || !parent || parent.isPresent;
  }

  /** the keys @items currently asks for (empty while a propagating parent is leaving) */
  get presentKeys(): string[] {
    return this.parentPresent ? this.args.items.map(this.args.key) : [];
  }
  isKeyPresent(key: string) {
    return this.presentKeys.includes(key);
  }

  /* eslint-disable ember/no-side-effects -- a render detector (see LayoutGroup): re-evaluated in every
     render pass, it books a read of the seats the pass leaves the children in */
  /**
   * Snapshot: a leaver's copy is pinned to the seat its element last
   * recorded. Each direct child reads its seat in the frame after every
   * render, and again whenever it or the box it is pinned inside resizes (see
   * MotionNode.recordSeat). The diff cannot read it: Glimmer patches the DOM
   * in template order, so content earlier in the template than this
   * <Presence> has been patched by the time it diffs, and may have moved or
   * resized the leaver. A move that is neither a render nor one of those
   * resizes, such as a transition on a sibling's width, is not seen.
   */
  get seatWatch(): undefined {
    if (this.args.mode !== 'snapshot') {
      this.stopWatchingSeats();
      return undefined;
    }
    consumeTag(VOLATILE_TAG);
    if (!this.seatReadBooked) {
      this.seatReadBooked = true;
      frame.read(() => {
        this.seatReadBooked = false;
        this.readSeats();
      });
    }
    return undefined;
  }
  /* eslint-enable ember/no-side-effects */

  /**
   * Reads every child's seat. After a render it also moves the resize watch
   * onto the elements those seats depend on now; a read from the watch itself
   * leaves it alone, since a target observed inside a resize callback can be
   * left undelivered, which the browser reports as an error.
   */
  private readSeats(rewatch = true) {
    if (isDestroying(this) || this.args.mode !== 'snapshot') {
      return;
    }
    const watched = new Set<Element>();
    this.entries.forEach((e) =>
      e.recordSeats().forEach((el) => watched.add(el)),
    );
    if (!rewatch) {
      return;
    }
    const resizes = (this.resizes ??= new ResizeObserver(() =>
      this.readSeats(false),
    ));
    this.watched.forEach((el) => {
      if (!watched.has(el)) {
        resizes.unobserve(el);
      }
    });
    watched.forEach((el) => {
      if (!this.watched.has(el)) {
        resizes.observe(el);
      }
    });
    this.watched = watched;
  }

  private stopWatchingSeats() {
    this.resizes?.disconnect();
    this.resizes = undefined;
    this.watched.clear();
  }

  /* eslint-disable ember/no-side-effects -- AnimatePresence's diff of present vs rendered children runs
     during render; this getter is that render step (entries, order and exit bookkeeping are its output) */
  get rendered(): Entry<T>[] {
    void this.version; // exits re-run this
    const items = this.args.items;
    const parentPresent = this.parentPresent;
    if (this.args.propagate && this.args.parent && !this.registeredWithParent) {
      this.registeredWithParent = this.args.parent.context.register(
        this.selfId,
      );
    }
    if (items !== this.lastItems || this.lastParentPresent !== parentPresent) {
      // React commits every render, and MeasureLayout's getSnapshotBeforeUpdate
      // fires for every projecting node on every commit — so a layout change
      // caused by AnimatePresence is snapshotted like any other. Here the
      // snapshot is explicit and someone has to ask for it, and the pass that
      // unmounts a leaver is one nobody else was going to ask about: it is
      // driven by this component's own bookkeeping, not by a re-render of the
      // <LayoutGroup> above.
      //
      // Without this, `sync` looks broken in exactly one place. The newcomer is
      // laid out BELOW the leaver (both are in flow — that is what sync means),
      // animates most of the way up as the leaver fades, and then covers the
      // last stretch in a single frame when the leaver is finally unmounted,
      // because that frame was never measured.
      snapshotOnRender();
      this.lastItems = items;
      this.lastParentPresent = parentPresent;
      this.pendingItems = items;
      const presentKeys = this.presentKeys;
      const blockInitial = this.firstRender && this.args.initial === false;
      const snapshot = this.args.mode === 'snapshot';
      items.forEach((item) => {
        const k = this.args.key(item);
        const e = this.entries.get(k);
        if (e) {
          e.item = item;
        } else {
          // a static copy cannot be retargeted: an item that comes back
          // replaces the copy of it still leaving
          this.cutCopies(k);
          this.entries.set(k, new Entry(k, item, this, blockInitial));
        }
      });
      // diff rendered vs present, keeping leavers in their slots (AnimatePresence's splice loop)
      const exitingKeys: string[] = [];
      const copied: ExitCopy[] = [];
      let snapshotLeft = false;
      let next = parentPresent ? [...presentKeys] : [];
      let insertionIndex = 0;
      for (const k of this.order) {
        const presentIndex = presentKeys.indexOf(k);
        if (presentIndex === -1 && snapshot) {
          // copied now, before this render patches the block, so the copy
          // shows the last frame's content (and is pinned to the seat
          // recorded before this render; see `seatWatch`); the block itself
          // leaves with this render
          snapshotLeft = true;
          for (const copy of this.entries.get(k)?.copiesForExit() ?? []) {
            this.copies.set(copy, k);
            copied.push(copy);
          }
          this.entries.delete(k);
          this.exitComplete.delete(k);
          this.exiting.delete(k);
        } else if (presentIndex === -1) {
          next.splice(insertionIndex++, 0, k);
          exitingKeys.push(k);
        } else {
          insertionIndex = presentIndex + exitingKeys.length + 1;
        }
      }
      if (snapshotLeft) {
        postRender(() => this.startCopies(copied));
      }
      if ((this.args.mode ?? 'sync') === 'wait' && exitingKeys.length) {
        next = exitingKeys;
      }
      this.order = next.filter((k, i) => next.indexOf(k) === i);
      // presence bookkeeping for the rendered set
      for (const k of this.order) {
        const e = this.entries.get(k)!;
        const present = presentKeys.includes(k);
        if (!present) {
          if (this.exitComplete.get(k) !== true) {
            this.exitComplete.set(k, false);
          }
        } else {
          this.exitComplete.delete(k);
          this.exiting.delete(k);
        }
        if (e.wasPresent !== present) {
          e.wasPresent = present;
          e.presenceChanged(present);
        }
      }
      this.firstRender = false;
      // a leaving parent waits on this <Presence>: with nothing left to
      // render it is done, unless copies are still playing their exits (they
      // report when they finish; see checkCopiesLeft)
      if (
        this.args.propagate &&
        !parentPresent &&
        !this.order.length &&
        !snapshotLeft &&
        !this.copies.size
      ) {
        postRender(() => this.safeToRemove());
      }
    }
    return this.order.map((k) => this.entries.get(k)!);
  }
  /* eslint-enable ember/no-side-effects */
  private lastParentPresent?: boolean;

  /** AnimatePresence's onExit for one child: once every exiting child is done, show what's pending */
  onExit(key: string) {
    if (this.exiting.has(key)) {
      return;
    }
    if (!this.exitComplete.has(key)) {
      return;
    }
    this.exiting.add(key);
    this.exitComplete.set(key, true);
    for (const done of this.exitComplete.values()) {
      if (!done) {
        return;
      }
    }
    // everything that was leaving has left
    const presentKeys = this.parentPresent
      ? this.pendingItems.map(this.args.key)
      : [];
    for (const k of this.order) {
      if (!presentKeys.includes(k)) {
        this.entries.delete(k);
      }
    }
    this.lastItems = undefined; // re-diff against what is pending
    this.exitComplete.clear();
    this.exiting.clear();
    this.order = presentKeys;
    this.version++;
    if (this.args.propagate) {
      this.safeToRemove();
    }
    this.args.onExitComplete?.();
  }

  private safeToRemove() {
    this.args.parent?.context.onExitComplete?.(this.selfId);
  }

  /** snapshot: after the render that removed their items, the copies go back in and play their exits */
  private startCopies(copies: ExitCopy[]) {
    const placement = {
      anchorX: this.args.anchorX ?? 'left',
      anchorY: this.args.anchorY ?? 'top',
      custom: this.args.custom,
    } as const;
    for (const copy of copies) {
      if (this.copies.has(copy)) {
        copy.start(placement, () => this.copyLeft(copy));
      }
    }
    // each copy reports its own end; a pass that copied nothing reports here
    if (!copies.length) {
      this.checkCopiesLeft();
    }
  }

  private copyLeft(copy: ExitCopy) {
    this.copies.delete(copy);
    this.checkCopiesLeft();
  }

  /** every copy has finished its exit, and no live leaver is still playing one: report as onExit does */
  private checkCopiesLeft() {
    if (this.copies.size || this.exitComplete.size || isDestroying(this)) {
      return;
    }
    if (this.args.propagate) {
      this.safeToRemove();
    }
    this.args.onExitComplete?.();
  }

  private cutCopies(key: string) {
    this.copies.forEach((k, copy) => {
      if (k === key) {
        this.copies.delete(copy);
        copy.cut();
      }
    });
  }

  <template>
    {{this.seatWatch}}
    {{#each this.rendered key='key' as |e|}}
      {{yield e.item e}}
    {{/each}}
  </template>
}

export default Presence;
