import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { PresenceContextProps } from 'motion-dom';

import { snapshotOnRender } from './layout-group.gts';
import { flushPendingMounts } from './node.ts';
import type { PopMeasurable, PresenceHandle } from './presence-types.ts';
import { postRender } from './scheduler.ts';

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
 */
interface Signature<T> {
  Args: {
    anchorX?: 'left' | 'right';
    anchorY?: 'top' | 'bottom';
    custom?: unknown;
    initial?: boolean;
    items: T[];
    key: (item: T) => string;
    mode?: 'sync' | 'wait' | 'popLayout';
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
  /** popLayout: the direct children, so they can be measured before the DOM changes */
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
      // diff in `rendered`, which is Glimmer's equivalent slot: the newcomers
      // for this pass have not been inserted yet, so the leaver's offsetTop is
      // still the seat it actually occupies.
      //
      // Measure it afterwards and you read a layout that already contains the
      // arrivals: the container has grown, a centred one has re-centred, and
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
  @tracked private version = 0;

  constructor(owner: Owner, args: Signature<T>['Args']) {
    super(owner, args);
    registerDestructor(this, () => this.registeredWithParent?.());
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
      items.forEach((item) => {
        const k = this.args.key(item);
        const e = this.entries.get(k);
        if (e) {
          e.item = item;
        } else {
          this.entries.set(k, new Entry(k, item, this, blockInitial));
        }
      });
      // diff rendered vs present, keeping leavers in their slots (AnimatePresence's splice loop)
      const exitingKeys: string[] = [];
      let next = parentPresent ? [...presentKeys] : [];
      let insertionIndex = 0;
      for (const k of this.order) {
        const presentIndex = presentKeys.indexOf(k);
        if (presentIndex === -1) {
          next.splice(insertionIndex++, 0, k);
          exitingKeys.push(k);
        } else {
          insertionIndex = presentIndex + exitingKeys.length + 1;
        }
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
      if (this.args.propagate && !parentPresent && !this.order.length) {
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

  <template>
    {{#each this.rendered key='key' as |e|}}
      {{yield e.item e}}
    {{/each}}
  </template>
}

export default Presence;
