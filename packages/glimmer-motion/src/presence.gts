import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import type { PresenceContextProps } from 'motion-dom';
import type { PresenceHandle } from './presence-types';
import { flushPendingMounts } from './node';
import { postRender } from './scheduler';

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
    items: T[];
    key: (item: T) => string;
    mode?: 'sync' | 'wait' | 'popLayout';
    initial?: boolean;
    custom?: unknown;
    onExitComplete?: () => void;
    /** nested presence: exit with the parent handle when it leaves */
    propagate?: boolean;
    parent?: PresenceHandle;
    anchorX?: 'left' | 'right';
    anchorY?: 'top' | 'bottom';
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
  subscribe(refresh: () => void) {
    this.subscribers.add(refresh);
    return () => this.subscribers.delete(refresh);
  }
  constructor(readonly key: string, item: T, private owner: Presence<T>, readonly initialBlocked: boolean) {
    this.item = item;
  }
  /** derived from @items (and the parent handle) — nothing is mutated during render */
  get isPresent() { return this.owner.isKeyPresent(this.key); }
  get mode() { return this.owner.args.mode ?? 'sync'; }
  get anchorX() { return this.owner.args.anchorX ?? 'left'; }
  get anchorY() { return this.owner.args.anchorY ?? 'top'; }
  get context(): PresenceContextProps {
    return {
      id: this.id,
      isPresent: this.isPresent,
      initial: this.initialBlocked ? (false as const) : undefined,
      custom: this.owner.args.custom,
      register: (childId) => {
        this.children.set(childId, false);
        return () => {
          this.children.delete(childId);
          if (!this.isPresent && !this.children.size) this.owner.onExit(this.key);
        };
      },
      onExitComplete: (childId) => {
        this.children.set(childId, true);
        for (const done of this.children.values()) if (!done) return;
        this.owner.onExit(this.key);
      },
    };
  }
  /** presence flipped (PresenceChild's isPresent effects): children report again; no children → done at once */
  presenceChanged(present: boolean) {
    this.children.forEach((_, k) => this.children.set(k, false));
    postRender(() => this.notify());
    if (!present) postRender(() => this.checkImmediateExit());
  }
  notify() {
    flushPendingMounts();
    this.subscribers.forEach((fn) => fn());
  }
  checkImmediateExit() {
    flushPendingMounts();
    if (!this.isPresent && !this.children.size) this.owner.onExit(this.key);
  }
}

export default class Presence<T> extends Component<Signature<T>> {
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

  get rendered(): Entry<T>[] {
    this.version; // exits re-run this
    const items = this.args.items;
    const parentPresent = this.parentPresent;
    if (this.args.propagate && this.args.parent && !this.registeredWithParent) {
      this.registeredWithParent = this.args.parent.context.register(this.selfId);
    }
    if (items !== this.lastItems || this.lastParentPresent !== parentPresent) {
      this.lastItems = items;
      this.lastParentPresent = parentPresent;
      this.pendingItems = items;
      const presentKeys = this.presentKeys;
      const blockInitial = this.firstRender && this.args.initial === false;
      items.forEach((item, i) => {
        const k = this.args.key(item);
        const e = this.entries.get(k);
        if (e) e.item = item;
        else this.entries.set(k, new Entry(k, item, this, blockInitial));
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
      if ((this.args.mode ?? 'sync') === 'wait' && exitingKeys.length) next = exitingKeys;
      this.order = next.filter((k, i) => next.indexOf(k) === i);
      // presence bookkeeping for the rendered set
      for (const k of this.order) {
        const e = this.entries.get(k)!;
        const present = presentKeys.includes(k);
        if (!present) {
          if (this.exitComplete.get(k) !== true) this.exitComplete.set(k, false);
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
      if (this.args.propagate && !parentPresent && !this.order.length) postRender(() => this.safeToRemove());
    }
    return this.order.map((k) => this.entries.get(k)!);
  }
  private lastParentPresent?: boolean;

  /** AnimatePresence's onExit for one child: once every exiting child is done, show what's pending */
  onExit(key: string) {
    if (this.exiting.has(key)) return;
    if (!this.exitComplete.has(key)) return;
    this.exiting.add(key);
    this.exitComplete.set(key, true);
    for (const done of this.exitComplete.values()) if (!done) return;
    // everything that was leaving has left
    const presentKeys = this.parentPresent ? this.pendingItems.map(this.args.key) : [];
    for (const k of this.order) if (!presentKeys.includes(k)) this.entries.delete(k);
    this.lastItems = undefined; // re-diff against what is pending
    this.exitComplete.clear();
    this.exiting.clear();
    this.order = presentKeys;
    this.version++;
    if (this.args.propagate) this.safeToRemove();
    this.args.onExitComplete?.();
  }

  private safeToRemove() {
    this.args.parent?.context.onExitComplete?.(this.selfId);
  }

  <template>
    {{#each this.rendered key="key" as |e|}}
      {{yield e.item e}}
    {{/each}}
  </template>
}
