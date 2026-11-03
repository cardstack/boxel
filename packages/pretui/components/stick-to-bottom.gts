// Pretui — StickToBottom: the scroll container of a live transcript. Follows new content while the reader is at the end, lets go the moment they read elsewhere, and keeps their line still when older history loads above.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type Owner from '@ember/owner';

// ── The follow model ─────────────────────────────────────────────────────
// Two states, and the asymmetry between them is the design:
//
//   following  content growth scrolls to the end, instantly (a smooth
//              catch-up animation behind a stream reads as lag)
//   detached   content growth leaves the viewport alone
//
// Detaching is easy on purpose: any upward user scroll of more than half a
// pixel, a wheel-up, or selecting text while the content is still changing.
// Re-pinning is deliberate: reaching within `@threshold` of the end, or a
// `scrollToEnd()` call. So a one-pixel nudge up lets go, and a collapse that
// shortens the content still clamps the reader to the end.
//
// No timer anywhere (realm law, and a re-arming timer would hang
// `await settled()`). The component's own scrolls are recognised by the
// position they were aiming at, not by a time window, and that record is
// cleared by the first scroll event that does not match it.

const UNPIN_EPSILON = 0.5;

// One device pixel in CSS pixels: the finest step a scroll can show.
const devicePixel = () => 1 / (globalThis.devicePixelRatio || 1);
// A scroll the component writes lands on a whole device pixel. A target
// between two let the browser round it one way and the next correction
// the other: the transcript shivered a pixel down and back while a row
// ran.
const toDevicePixel = (value: number) => {
  let px = devicePixel();
  return Math.round(value / px) * px;
};
// How long a reader's own move up from the end is remembered: nothing
// follows them back down (not the threshold, not growth, not a revision)
// until it passes, so momentum landing near the end doesn't undo it.
const UP_INTENT_MS = 1500;
const OWN_SCROLL_SLACK = 2;
const TRANSCRIPT_ID = 'data-transcript-id';
// How long after the reader's wheel, touch or key a scroll still counts as
// theirs (a wheel's momentum, a key's smooth scroll)
const INPUT_MS = 600;
// How long the element the reader pressed (a toggle, a choice, Undo) stays
// the anchor: what it opens or closes moves around it, not it
const PRESS_MS = 2000;
// How long the app's own navigation target (reveal) stays the anchor
const NAVIGATE_MS = 2000;
// The reading line: where in the viewport the reader's attention is taken
// to be, as a fraction of its height from the top
const READING_LINE = 1 / 3;
// Anchor candidates: messages, rows, steps, answer blocks. Picking stops at
// the first marked element under the reading line that fits in the view
const ANCHOR_ATTR = 'data-scroll-anchor';
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);
const NESTED_REGION = '[data-scroll-region]';

export type FollowChangeSource = 'user' | 'api';

export interface StickToBottomApi {
  /** Whether content growth currently scrolls to the end. */
  readonly following: boolean;
  /** The scrolling viewport, once rendered. Not tracked: read it from a
   * modifier or an action, not from a template. */
  readonly scrollElement: HTMLElement | undefined;
  /** Scroll to the end and follow again. `smooth` degrades to `auto` under
   * reduced motion. */
  scrollToEnd(behavior?: ScrollBehavior): void;
  /** Bring the row carrying `data-transcript-id="<id>"` into view and stop
   * following. Returns false when no such row is in the DOM. */
  reveal(id: string, opts?: { block?: 'start' | 'center' }): boolean;
  /** Bring an element in the content into view and stop following; it is
   * the anchor while the scroll lands. The app's way to show something (a
   * gate to review, the first unread message), instead of its own
   * scrollIntoView, which would fight the anchor. */
  navigate(
    element: HTMLElement,
    opts?: { block?: 'start' | 'center'; behavior?: ScrollBehavior },
  ): void;
  /** Hold the anchor now: one step of the scroll anchoring protocol. A host
   * with a motion layer calls it after the render pass commits and before
   * the motion layer measures, so the scroll lands before anything
   * measures. */
  settle(): void;
  /** With `@holdTail`: rows that arrived after the reader detached, held
   * back from the list until they return to the end. 0 otherwise. */
  readonly pendingCount: number;
  /** With `@holdTail`: `items` cut at the last row the reader had when they
   * detached; the whole list otherwise. Use it as a helper:
   * `{{#each (scroll.visibleItems this.rows) …}}` */
  visibleItems<T extends { id: string }>(items: T[]): T[];
}

export interface StickToBottomSignature {
  Args: {
    /** Controlled following state. Pair with `@onFollowChange`. */
    following?: boolean;
    /** Uncontrolled initial state. Default true. */
    defaultFollowing?: boolean;
    /** Fires when following changes. `by` says whether the reader caused it
     * (`user`) or a `scrollToEnd` / `reveal` call did (`api`). */
    onFollowChange?: (following: boolean, by: FollowChangeSource) => void;
    /** The content is still changing (a response is streaming). While
     * active, selecting text detaches; when it turns false, a following
     * viewport settles on the final end. */
    active?: boolean;
    /** Distance from the end, in px, that counts as "at the end" when
     * re-pinning. Default 8. */
    threshold?: number;
    /** Called once each time the reader scrolls up into `@startMargin` of the
     * top. The reader's line is held still across whatever it prepends. */
    onReachStart?: () => Promise<void> | void;
    /** Distance from the top, in px, that triggers `@onReachStart`. Default 400. */
    startMargin?: number;
    /** Accessible name. Supplying one promotes the viewport to a `region`. */
    label?: string;
    /** Hold the tail while the reader is away: rows arriving after they
     * detach stay out of the list (render `scroll.visibleItems(rows)`) and
     * are counted in `scroll.pendingCount`, then land together when they
     * return to the end. Needs `@itemIds`. */
    holdTail?: boolean;
    /** the ids of the caller's rows, in order. Read with `@holdTail` */
    itemIds?: string[];
    /** Any value that changes when the content changes (a message lands, a
     * row grows). While following, a change pins to the end in the same
     * render commit, before anything measures the frame after the render,
     * so a motion layer sees the follow as part of the pass instead of a
     * jump after it. Without it, growth is pinned by the resize observer. */
    revision?: unknown;
    /** Turn on the prominence ramp inside the transcript: settled work
     * (ToolRow, ToolGroup, WorkItem) recedes to this opacity. true means
     * 0.45 */
    recede?: boolean | number;
  };
  Blocks: {
    default: [StickToBottomApi];
    /** Rendered over the viewport, positioned against the component's root:
     * the JumpChip slot. */
    overlay: [StickToBottomApi];
  };
  Element: HTMLDivElement;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

type RecordedAnchor =
  | { kind: 'end'; gap: number }
  | {
      kind: 'navigation' | 'pressed' | 'reading';
      chain: { el: HTMLElement; offset: number; top: number }[];
    };

function distanceFromEnd(el: HTMLElement): number {
  return el.scrollHeight - el.clientHeight - el.scrollTop;
}

/** Installs every listener and observer once, for the component's lifetime.
 * It takes only the component, which never changes, so it never re-runs. */
const follow = modifier((viewport: HTMLElement, [owner]: [StickToBottom]) =>
  owner.install(viewport),
);

/** Sets one CSS custom property on the element, or removes it, without
 * touching the rest of its style attribute (which may be the caller's). */
const customProperty = modifier(
  (el: HTMLElement, [name, value]: [string, string | undefined]) => {
    if (value === undefined) {
      el.style.removeProperty(name);
    } else {
      el.style.setProperty(name, value);
    }
    return () => el.style.removeProperty(name);
  },
);

/** Reports a value to a callback on install and on every change, so a
 * component can react to an argument changing without a side-effecting
 * getter. */
const watch = modifier(
  (
    _el: HTMLElement,
    [callback, value]: [(value: unknown) => void, unknown],
  ) => {
    callback(value);
  },
);

/**
 * The scroll owner of a live transcript.
 *
 * ```hbs
 * <StickToBottom @active={{this.generating}} @label='Conversation'>
 *   <:default as |scroll|>…rows, each carrying data-transcript-id…</:default>
 *   <:overlay as |scroll|>
 *     <JumpChip @visible={{not scroll.following}} @onJump={{fn scroll.scrollToEnd 'smooth'}} />
 *   </:overlay>
 * </StickToBottom>
 * ```
 *
 * Its own scrolls are recognised by the position they aim at, not by a timer
 * window. Something the reader opens that grows the content out of view
 * detaches instead of being pulled back to the end. Holding the reader's
 * line when history loads above is part of the component, not left to each
 * caller. The rules it holds are ADR 012.
 */
export class StickToBottom extends Component<StickToBottomSignature> {
  @tracked private internalFollowing = this.args.defaultFollowing ?? true;
  @tracked anchoring = false;
  /** with @holdTail: the last row id the reader had when they detached */
  @tracked private heldAfter: string | undefined;
  /** counts resizes: each one is settled in the render pass it starts */
  @tracked private resizes = 0;

  private viewport: HTMLElement | undefined;
  private content: HTMLElement | undefined;
  /** scrollTop the component itself is scrolling to, until a scroll event
   * shows something else moved the viewport. */
  private ownTarget: number | undefined;
  /** whether the scroll to `ownTarget` is a smooth one, which spans frames */
  private ownSmooth = false;
  private get smoothInFlight(): boolean {
    return this.ownSmooth && this.ownTarget !== undefined;
  }
  private lastTop = 0;
  /** when the reader last moved up from the end themselves */
  private leftAt = -Infinity;
  private get holdingIntent() {
    return performance.now() - this.leftAt < UP_INTENT_MS;
  }
  private lastActive = false;
  private reachPending = false;
  private wasInStartMargin = false;
  /** the anchor held through the next settle: what it is, the element (and
   * its marked ancestors, to fall back on if it leaves), its offset from
   * the viewport's top and its top, by layout, or the gap to the end when it
   * is the end */
  private recorded: RecordedAnchor | undefined;
  /** the element the reader last pressed in the content, and when */
  private pressed: { el: HTMLElement; at: number } | undefined;
  /** the element the app last brought into view, and when */
  private navigation: { el: HTMLElement; at: number } | undefined;
  /** when the reader last scrolled by hand (wheel, touch, a scrolling key)
   * and whether a pointer is down on the viewport (its scrollbar, a drag):
   * only those moves are theirs */
  private inputAt = -Infinity;
  /** the content's and viewport's heights at the last scroll */
  private lastHeights: [number, number] = [0, 0];
  private sizeChanged(el: HTMLElement): boolean {
    return (
      el.scrollHeight !== this.lastHeights[0] ||
      el.clientHeight !== this.lastHeights[1]
    );
  }
  private pointerHeld = false;
  private get readerScrolling(): boolean {
    return this.pointerHeld || performance.now() - this.inputAt < INPUT_MS;
  }
  private noteInput = () => {
    this.inputAt = performance.now();
    // the reader's hand on the scroll takes over from what they pressed and
    // from any navigation: from here the reading line is the anchor
    this.pressed = undefined;
    this.navigation = undefined;
  };
  // A press on the viewport itself is its scrollbar (or a drag on its
  // bare edge): a scroll that follows is the reader's. A press on the
  // content is a click: what it opens or closes is not a scroll, so a
  // collapse that pulls the position up must not let go of the end.
  private onPointerDown = (event: PointerEvent) => {
    if (event.target === this.viewport) {
      this.pointerHeld = true;
      this.noteInput();
      return;
    }
    this.press(event.target);
  };
  private onPointerRelease = () => {
    if (this.pointerHeld) {
      this.pointerHeld = false;
      this.noteInput();
    }
  };
  // Listened for on the owner document: after a click on text that cannot
  // take focus, a scrolling key's target is the body, and the browser
  // scrolls the viewport the click was in.
  private onScrollKey = (event: KeyboardEvent) => {
    let target = event.target;
    let inViewport =
      target instanceof Node && Boolean(this.viewport?.contains(target));
    let onBody =
      target === this.viewport?.ownerDocument.body ||
      target === this.viewport?.ownerDocument.documentElement;
    if (!inViewport && !onBody) {
      return;
    }
    if (inViewport && (event.key === 'Enter' || event.key === ' ')) {
      // a press on a focused control: Space on the viewport itself scrolls
      if (target !== this.viewport) {
        this.press(target);
        return;
      }
    }
    if (SCROLL_KEYS.has(event.key)) {
      this.noteInput();
    }
  };
  // Focus that lands in the content, other than by a pointer press, makes
  // the focused element the anchor: the browser scrolls it into view (Tab,
  // a skip link, the app's focus()), and that scroll is not a clamp to undo.
  // The anchor is recorded again at the next settle or scroll, after the
  // browser's scroll has landed.
  private onFocusIn = (event: FocusEvent) => {
    let target = event.target;
    if (!(target instanceof HTMLElement) || !this.content?.contains(target)) {
      return;
    }
    let pressed = this.pressed;
    if (
      pressed &&
      performance.now() - pressed.at < INPUT_MS &&
      target.contains(pressed.el)
    ) {
      return;
    }
    this.noteInput();
    this.navigation = { el: target, at: performance.now() };
    this.recorded = undefined;
  };

  /** The reader pressed something in the content: it is the anchor while
   * what it opens or closes lands. */
  private press(target: EventTarget | null) {
    if (!(target instanceof HTMLElement) || !this.content?.contains(target)) {
      return;
    }
    this.pressed = { el: target, at: performance.now() };
    this.record();
  }

  readonly api: StickToBottomApi;

  constructor(owner: Owner, args: StickToBottomSignature['Args']) {
    super(owner, args);
    let component = this;
    this.api = {
      get following() {
        return component.following;
      },
      get scrollElement() {
        return component.viewport;
      },
      scrollToEnd: (behavior?: ScrollBehavior) => this.scrollToEnd(behavior),
      settle: () => this.settle(),
      navigate: (
        element: HTMLElement,
        opts?: { block?: 'start' | 'center'; behavior?: ScrollBehavior },
      ) => this.navigate(element, opts),
      reveal: (id: string, opts?: { block?: 'start' | 'center' }) =>
        this.reveal(id, opts),
      get pendingCount() {
        return component.pendingCount;
      },
      visibleItems: <T extends { id: string }>(items: T[]) =>
        component.visibleItems(items),
    };
  }

  get following(): boolean {
    return this.args.following ?? this.internalFollowing;
  }
  get threshold(): number {
    return this.args.threshold ?? 8;
  }
  get startMargin(): number {
    return this.args.startMargin ?? 400;
  }
  get role(): string | undefined {
    return this.args.label ? 'region' : undefined;
  }
  get recedeOpacity(): string | undefined {
    let recede = this.args.recede;
    if (recede === undefined || recede === false) {
      return undefined;
    }
    return String(recede === true ? 0.45 : Math.min(1, Math.max(0, recede)));
  }

  // ── holding the tail ───────────────────────────────────────────────────

  private get holding(): boolean {
    return (
      Boolean(this.args.holdTail) &&
      !this.following &&
      this.heldAfter !== undefined
    );
  }
  get pendingCount(): number {
    if (!this.holding) {
      return 0;
    }
    let ids = this.args.itemIds ?? [];
    let index = ids.indexOf(this.heldAfter!);
    return index < 0 ? 0 : ids.length - index - 1;
  }
  visibleItems<T extends { id: string }>(items: T[]): T[] {
    if (!this.holding) {
      return items;
    }
    let index = items.findIndex((item) => item.id === this.heldAfter);
    return index < 0 ? items : items.slice(0, index + 1);
  }

  // ── state changes ──────────────────────────────────────────────────────

  private setFollowing(next: boolean, by: FollowChangeSource) {
    if (next === this.following) {
      return;
    }
    if (this.args.following === undefined) {
      this.internalFollowing = next;
    }
    if (this.args.holdTail) {
      // leaving: freeze the list at what the reader had; returning: release
      let ids = this.args.itemIds ?? [];
      this.heldAfter = next ? undefined : ids[ids.length - 1];
    }
    this.args.onFollowChange?.(next, by);
  }

  /** Programmatic scroll; the scroll event it causes is recognised as ours. */
  private scrollTo(top: number, behavior: ScrollBehavior = 'auto') {
    let el = this.viewport;
    if (!el) {
      return;
    }
    let max = Math.max(0, el.scrollHeight - el.clientHeight);
    let target = toDevicePixel(Math.min(Math.max(0, top), max));
    if (
      Math.abs(el.scrollTop - target) < Math.max(UNPIN_EPSILON, devicePixel())
    ) {
      // no scroll event will come, so leave no record waiting for one
      return;
    }
    this.ownTarget = target;
    this.ownSmooth = behavior === 'smooth' && !prefersReducedMotion();
    if (this.ownSmooth) {
      el.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      // assigning scrollTop bypasses any CSS scroll-behavior: smooth
      el.scrollTop = target;
    }
  }

  private pinToEnd() {
    let el = this.viewport;
    if (el && distanceFromEnd(el) > UNPIN_EPSILON) {
      this.scrollTo(el.scrollHeight);
    }
  }

  scrollToEnd = (behavior?: ScrollBehavior) => {
    let el = this.viewport;
    if (!el) {
      return;
    }
    this.setFollowing(true, 'api');
    this.scrollTo(el.scrollHeight, behavior ?? 'auto');
  };

  reveal = (id: string, opts?: { block?: 'start' | 'center' }): boolean => {
    let el = this.viewport;
    let target = this.findRow(id);
    if (!el || !target) {
      return false;
    }
    this.setFollowing(false, 'api');
    this.navigation = { el: target, at: performance.now() };
    let offset = this.offsetOf(target);
    if (opts?.block === 'center') {
      offset -=
        (el.clientHeight -
          target.getBoundingClientRect().height / this.scale()) /
        2;
    }
    this.scrollTo(el.scrollTop + offset);
    return true;
  };

  navigate = (
    element: HTMLElement,
    opts?: { block?: 'start' | 'center'; behavior?: ScrollBehavior },
  ) => {
    let el = this.viewport;
    if (!el || !this.content?.contains(element)) {
      return;
    }
    this.setFollowing(false, 'api');
    this.navigation = { el: element, at: performance.now() };
    let offset = this.offsetOf(element);
    if (opts?.block === 'center') {
      offset -=
        (el.clientHeight -
          element.getBoundingClientRect().height / this.scale()) /
        2;
    }
    this.scrollTo(el.scrollTop + offset, opts?.behavior ?? 'auto');
  };

  /** Ratio of rendered to layout size. Bounding rects come back transformed
   * (a zoomed or scaled ancestor), scrollTop does not, so every rect delta is
   * divided by this before it is added to a scroll position. */
  private scale(): number {
    let el = this.viewport;
    if (!el || el.offsetHeight === 0) {
      return 1;
    }
    let rendered = el.getBoundingClientRect().height;
    return rendered > 0 ? rendered / el.offsetHeight : 1;
  }

  /** A row's distance below the viewport's top edge, in layout pixels. */
  private offsetOf(row: HTMLElement): number {
    let el = this.viewport;
    if (!el) {
      return 0;
    }
    return (
      (row.getBoundingClientRect().top - el.getBoundingClientRect().top) /
      this.scale()
    );
  }

  private findRow(id: string): HTMLElement | undefined {
    let el = this.viewport;
    if (!el) {
      return undefined;
    }
    for (let row of Array.from(
      el.querySelectorAll<HTMLElement>(`[${TRANSCRIPT_ID}]`),
    )) {
      if (row.getAttribute(TRANSCRIPT_ID) === id) {
        return row;
      }
    }
    return undefined;
  }

  // ── argument watchers ──────────────────────────────────────────────────

  activeChanged = (value: unknown) => {
    let active = Boolean(value);
    if (this.lastActive && !active) {
      // the stream settled: hold the anchor on its final layout
      this.settle({ inRender: true });
    }
    this.lastActive = active;
  };

  // the content changed in this render: the anchor is held in the same
  // commit (not the frame after, when the resize observer would), so a
  // motion layer measuring this pass sees the result, not a jump after it
  revisionChanged = () => {
    this.settle({ inRender: true });
  };

  followingArgChanged = (value: unknown) => {
    // a controlling caller switching following back on means "go to the end"
    if (value === true) {
      this.pinToEnd();
    }
  };

  // ── listeners ──────────────────────────────────────────────────────────

  private onScroll = () => {
    let el = this.viewport;
    if (!el) {
      return;
    }
    let top = el.scrollTop;
    let movedUp = top < this.lastTop - UNPIN_EPSILON;

    let own = false;
    if (this.ownTarget !== undefined) {
      let before = this.lastTop - this.ownTarget;
      let now = top - this.ownTarget;
      if (Math.abs(now) <= OWN_SCROLL_SLACK) {
        own = true;
        this.ownTarget = undefined;
      } else if (!movedUp && now < 0) {
        // still on its way down to the target
        own = true;
      } else if (
        this.ownSmooth &&
        !this.readerScrolling &&
        Math.sign(now) === Math.sign(before) &&
        Math.abs(now) < Math.abs(before)
      ) {
        // a smooth scroll still on its way up to the target
        own = true;
      } else {
        this.ownTarget = undefined;
      }
    }

    if (!own && this.readerScrolling) {
      // a touch's momentum, or a wheel's, scrolls on after the last input
      // event: each of its scrolls keeps the move the reader's
      this.inputAt = performance.now();
    }

    if (!own) {
      // the reader's own move up wins, even a small one near the end, and
      // is remembered for a moment
      if (movedUp && !this.readerScrolling && this.sizeChanged(el)) {
        // the position fell without the reader's hand because the layout
        // moved: content shrank or the viewport grew. The anchor recorded
        // before it is still the one to hold; settle puts it back. (A move
        // up with no size change is a scroll someone asked for, the app's
        // scrollIntoView included.)
        this.lastTop = top;
        this.settle();
        this.writeEdges();
        return;
      } else if (movedUp) {
        this.leftAt = performance.now();
        this.setFollowing(false, 'user');
      } else if (
        distanceFromEnd(el) <= this.threshold &&
        // the reader scrolling back down to the end follows at once; the
        // end arriving under them by itself (growth, a reflow) waits out
        // their move up
        (top > this.lastTop + UNPIN_EPSILON || !this.holdingIntent)
      ) {
        this.setFollowing(true, 'user');
      }
    }

    let inStartMargin = top <= this.startMargin;
    if (inStartMargin && !this.wasInStartMargin && movedUp) {
      void this.reachStart();
    }
    this.wasInStartMargin = inStartMargin;
    this.lastTop = top;
    this.lastHeights = [el.scrollHeight, el.clientHeight];
    // a scroll on a layout that changed since the anchor was recorded (a
    // late event from our own earlier scroll, landing after content grew)
    // must not take the changed layout as the new baseline: hold the
    // anchor through the change first
    if (this.layoutChangedSinceRecord(el)) {
      this.settle();
    } else {
      this.record();
    }
    this.writeEdges();
  };

  /** the content's and viewport's heights when the anchor was recorded */
  private recordedHeights: [number, number] = [0, 0];
  private layoutChangedSinceRecord(el: HTMLElement): boolean {
    return (
      el.scrollHeight !== this.recordedHeights[0] ||
      el.clientHeight !== this.recordedHeights[1]
    );
  }

  private onWheel = (event: WheelEvent) => {
    this.noteInput();
    if (event.deltaY >= 0) {
      return;
    }
    let target = event.target instanceof Element ? event.target : null;
    let nested = target?.closest(NESTED_REGION);
    if (nested && nested !== this.viewport && this.viewport?.contains(nested)) {
      return;
    }
    let el = this.viewport;
    if (el && el.scrollHeight - el.clientHeight > 1) {
      this.leftAt = performance.now();
      this.setFollowing(false, 'user');
    }
  };

  private onPointerUp = () => {
    if (!this.args.active) {
      return;
    }
    let selection =
      typeof window !== 'undefined' ? window.getSelection() : null;
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      this.viewport?.contains(selection.anchorNode)
    ) {
      this.setFollowing(false, 'user');
    }
  };

  // A resize is not settled here: it starts a render pass and is settled
  // in its commit, so a motion layer measuring that pass sees the follow
  // it implies as a move, not a jump after it (ADR 013 §1.7). The render
  // runs in a microtask, before the frame paints.
  private onResize = () => {
    this.resizes++;
  };

  resizeChanged = () => {
    let el = this.viewport;
    if (!el) {
      return;
    }
    this.settle({ inRender: true });
    this.lastTop = el.scrollTop;
    // a frame's scroll events run before its resize callbacks, so a clamp
    // that a shrink caused still compares against the heights before it
    this.lastHeights = [el.scrollHeight, el.clientHeight];
    this.writeEdges();
  };

  // ── the anchor ─────────────────────────────────────────────────────────
  // One invariant, held in every settle: one element keeps its distance
  // from the viewport's top, by layout, from one settle to the next; or,
  // when the anchor is the end, the content's bottom keeps its distance from
  // the viewport's bottom. The anchor is chosen by priority:
  //
  //   1. the app's navigation target (reveal), for a moment after it
  //   2. the element the reader pressed (a toggle, a choice), for a moment
  //      after, unless they have scrolled since
  //   3. the end, while following
  //   4. the reading line: the element a third of the way down the view
  //
  // Positions are read from layout (offsets), which a motion layer's
  // transforms do not move, so the correction and the motion never fight.
  // See packages/pretui/docs/scroll-anchoring-protocol.md.

  /** an element's top by layout, which transforms do not move */
  private layoutTop(el: HTMLElement): number {
    let y = 0;
    for (
      let e: HTMLElement | null = el;
      e;
      e = e.offsetParent as HTMLElement | null
    ) {
      y += e.offsetTop;
    }
    return y;
  }

  /** The element under the reading line: down through the content to the
   * first marked anchor that fits in the view, or the smallest element the
   * line crosses. */
  private readingElement(): HTMLElement | undefined {
    let el = this.viewport;
    let content = this.content;
    if (!el || !content) {
      return undefined;
    }
    let view = el.getBoundingClientRect();
    let line = view.top + view.height * READING_LINE;
    let pick: HTMLElement | undefined;
    let level: Element = content;
    for (let depth = 0; depth < 10; depth++) {
      // in flow only: a motion layer's overlays sit absolutely over
      // everything and are never what the reader reads
      let inFlow = (child: Element) =>
        getComputedStyle(child).position !== 'absolute';
      let next: HTMLElement | undefined;
      let below: HTMLElement | undefined;
      for (let child of Array.from(level.children)) {
        let rect = child.getBoundingClientRect();
        if (rect.height === 0) {
          continue;
        }
        if (rect.top <= line && rect.bottom > line && inFlow(child)) {
          next = child as HTMLElement;
          break;
        }
        if (!below && rect.top > line && inFlow(child)) {
          below = child as HTMLElement;
        }
      }
      // the line falls in a gap: the first element below it
      next ??= below;
      if (!next) {
        break;
      }
      pick = next;
      let rect = next.getBoundingClientRect();
      if (next.hasAttribute(ANCHOR_ATTR) && rect.height <= view.height) {
        break;
      }
      if (rect.top > line) {
        break;
      }
      level = next;
    }
    return pick;
  }

  /** The anchor the next settle holds, by the priority above. */
  private chooseAnchor():
    | { kind: 'end' }
    | { kind: 'navigation' | 'pressed' | 'reading'; el: HTMLElement }
    | undefined {
    let now = performance.now();
    let navigation = this.navigation;
    if (
      navigation &&
      navigation.el.isConnected &&
      now - navigation.at < NAVIGATE_MS
    ) {
      return { kind: 'navigation', el: navigation.el };
    }
    let pressed = this.pressed;
    if (pressed && pressed.el.isConnected && now - pressed.at < PRESS_MS) {
      return { kind: 'pressed', el: pressed.el };
    }
    if (this.following) {
      return { kind: 'end' };
    }
    let reading = this.readingElement();
    return reading ? { kind: 'reading', el: reading } : undefined;
  }

  /** Record the anchor and where it sits now. */
  private record() {
    let el = this.viewport;
    let anchor = this.chooseAnchor();
    if (el) {
      this.recordedHeights = [el.scrollHeight, el.clientHeight];
    }
    if (!el || !anchor) {
      this.recorded = undefined;
      return;
    }
    if (anchor.kind === 'end') {
      this.recorded = { kind: 'end', gap: distanceFromEnd(el) };
      return;
    }
    // the element and its marked ancestors: if what was pressed leaves the
    // DOM (a choice collapsing into its answer), its row holds instead
    let chain: HTMLElement[] = [anchor.el];
    for (
      let up = anchor.el.parentElement?.closest<HTMLElement>(
        `[${ANCHOR_ATTR}]`,
      );
      up && this.content?.contains(up);
      up = up.parentElement?.closest<HTMLElement>(`[${ANCHOR_ATTR}]`)
    ) {
      chain.push(up);
    }
    this.recorded = {
      kind: anchor.kind,
      chain: chain.map((node) => {
        let top = this.layoutTop(node);
        return { el: node, offset: top - el.scrollTop, top };
      }),
    };
  }

  /** Hold the recorded anchor through whatever changed since, then record
   * again. Runs at every render commit, every resize, and when a stream
   * settles. `inRender` when a render commit calls it: a change to
   * following then waits for the commit to end, so the caller's
   * `@onFollowChange` never updates state the render has already read. */
  private settle(opts?: { inRender?: boolean }) {
    let el = this.viewport;
    let recorded = this.recorded;
    if (!el) {
      return;
    }
    let minDrift = Math.max(UNPIN_EPSILON, devicePixel());
    if (this.smoothInFlight) {
      // The component's own smooth scroll is on its way: writing a position
      // now would cut it short. Its target moves by what layout moved.
      let target = this.ownTarget!;
      if (this.following) {
        target = el.scrollHeight;
      } else if (recorded && recorded.kind !== 'end') {
        let held = recorded.chain.find((entry) => entry.el.isConnected);
        if (held) {
          target += this.layoutTop(held.el) - held.top;
        }
      }
      let max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(Math.min(target, max) - this.ownTarget!) >= minDrift) {
        this.scrollTo(target, 'smooth');
      }
    } else if (recorded?.kind === 'end') {
      if (this.following) {
        this.pinToEnd();
      }
    } else if (recorded) {
      let held = recorded.chain.find((entry) => entry.el.isConnected);
      if (held) {
        // While the reader scrolls, the position is theirs: a settle can run
        // between their scroll and its scroll event (a fast wheel), and
        // holding the recorded offset would take their last step back. Only
        // what layout moved is held. Otherwise the offset is, which also
        // undoes a clamp when content shrank.
        let drift = this.readerScrolling
          ? this.layoutTop(held.el) - held.top
          : this.layoutTop(held.el) - el.scrollTop - held.offset;
        // less than a device pixel of drift is rounding, not movement
        if (Math.abs(drift) >= minDrift) {
          this.scrollTo(el.scrollTop + drift);
        }
      }
      // a reader at the end who opened something, or moved focus to
      // something, that grew past it is reading it now, not following the
      // end
      if (
        recorded.kind !== 'reading' &&
        this.following &&
        distanceFromEnd(el) > this.threshold
      ) {
        this.detachForAnchor(Boolean(opts?.inRender));
      }
    }
    this.record();
  }

  private detachForAnchor(inRender: boolean) {
    if (!inRender) {
      this.setFollowing(false, 'user');
      return;
    }
    queueMicrotask(() => {
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      let el = this.viewport;
      if (el && this.following && distanceFromEnd(el) > this.threshold) {
        this.setFollowing(false, 'user');
      }
    });
  }

  private async reachStart() {
    let load = this.args.onReachStart;
    if (!load || this.reachPending) {
      return;
    }
    this.reachPending = true;
    this.anchoring = true;
    this.record();
    try {
      await load();
    } catch (error) {
      // the caller's load failed: the reader can scroll to the start again
      // to retry, and the error is reported, not left unhandled
      console.error(error);
    } finally {
      // The prepend may already be laid out, or may land on the next resize:
      // hold the reader's line now and once more a frame later.
      this.settle();
      let release = () => {
        this.settle();
        this.reachPending = false;
        this.anchoring = false;
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(release);
      } else {
        release();
      }
    }
  }

  // ── edges and focus ────────────────────────────────────────────────────

  /** Written as attributes, read only by CSS: a scroll costs no render. */
  private writeEdges() {
    let el = this.viewport;
    if (!el) {
      return;
    }
    let scrollable = el.scrollHeight - el.clientHeight > 1;
    el.dataset['startY'] = scrollable && el.scrollTop > 1 ? 'clipped' : 'flush';
    // keyboard-reachable exactly when there is something to scroll
    if (scrollable) {
      if (el.getAttribute('tabindex') === null) {
        el.setAttribute('tabindex', '0');
      }
    } else if (el.getAttribute('tabindex') === '0') {
      el.removeAttribute('tabindex');
    }
  }

  // ── lifetime ───────────────────────────────────────────────────────────

  install(viewport: HTMLElement): () => void {
    this.viewport = viewport;
    this.content =
      (viewport.querySelector(
        '[data-stick-to-bottom-content]',
      ) as HTMLElement | null) ?? undefined;

    viewport.addEventListener('scroll', this.onScroll, { passive: true });
    viewport.addEventListener('wheel', this.onWheel, { passive: true });
    viewport.addEventListener('pointerup', this.onPointerUp);
    viewport.addEventListener('pointerdown', this.onPointerDown);
    viewport.addEventListener('touchmove', this.noteInput, { passive: true });
    viewport.addEventListener('focusin', this.onFocusIn);
    let doc = viewport.ownerDocument;
    doc.addEventListener('keydown', this.onScrollKey);
    window.addEventListener('pointerup', this.onPointerRelease);
    window.addEventListener('pointercancel', this.onPointerRelease);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(this.onResize);
      observer.observe(viewport);
      if (this.content) {
        observer.observe(this.content);
      }
    }

    if (this.following) {
      this.pinToEnd();
    }
    this.record();
    this.lastTop = viewport.scrollTop;
    this.lastHeights = [viewport.scrollHeight, viewport.clientHeight];
    this.wasInStartMargin = viewport.scrollTop <= this.startMargin;
    this.writeEdges();

    return () => {
      viewport.removeEventListener('scroll', this.onScroll);
      viewport.removeEventListener('wheel', this.onWheel);
      viewport.removeEventListener('pointerup', this.onPointerUp);
      viewport.removeEventListener('pointerdown', this.onPointerDown);
      viewport.removeEventListener('touchmove', this.noteInput);
      viewport.removeEventListener('focusin', this.onFocusIn);
      doc.removeEventListener('keydown', this.onScrollKey);
      window.removeEventListener('pointerup', this.onPointerRelease);
      window.removeEventListener('pointercancel', this.onPointerRelease);
      observer?.disconnect();
      this.viewport = undefined;
      this.content = undefined;
    };
  }

  <template>
    <div
      class='pretui-stick-to-bottom'
      {{customProperty '--pretui-recede-opacity' this.recedeOpacity}}
      data-holding={{if this.holding 'true'}}
      data-following={{if this.following 'true' 'false'}}
      data-test-pretui-stick-to-bottom
      ...attributes
    >
      <div
        class='pretui-stick-to-bottom-viewport'
        role={{this.role}}
        aria-label={{@label}}
        aria-busy={{if this.anchoring 'true'}}
        data-following={{if this.following 'true' 'false'}}
        data-test-pretui-stick-to-bottom-viewport
        {{follow this}}
        {{watch this.activeChanged @active}}
        {{watch this.followingArgChanged @following}}
        {{watch this.revisionChanged @revision}}
        {{watch this.resizeChanged this.resizes}}
      >
        <div
          class='pretui-stick-to-bottom-content'
          data-stick-to-bottom-content
          data-test-pretui-stick-to-bottom-content
        >
          {{yield this.api}}
        </div>
      </div>
      <div class='pretui-stick-to-bottom-edge' aria-hidden='true'></div>
      {{#if (has-block 'overlay')}}
        <div
          class='pretui-stick-to-bottom-overlay'
          data-test-pretui-stick-to-bottom-overlay
        >
          {{yield this.api to='overlay'}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-stick-to-bottom {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 0;
          height: 100%;
        }
        .pretui-stick-to-bottom-viewport {
          flex: 1 1 auto;
          min-height: 0;
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-gutter: stable;
          /* The component owns the scroll position: following, it pins
             the end; detached, it holds the anchor (settle). The browser
             must not anchor as well. */
          overflow-anchor: none;
        }
        .pretui-stick-to-bottom-viewport:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-stick-to-bottom-content {
          display: flow-root;
        }
        .pretui-stick-to-bottom-edge {
          position: absolute;
          inset-inline: 0;
          inset-block-start: 0;
          block-size: var(--pretui-stick-to-bottom-fade, var(--boxel-sp-lg));
          pointer-events: none;
          opacity: 0;
          background: linear-gradient(
            to bottom,
            var(--pretui-stick-to-bottom-ground, var(--card)),
            transparent
          );
          transition: opacity 140ms linear;
        }
        .pretui-stick-to-bottom-viewport[data-start-y='clipped']
          ~ .pretui-stick-to-bottom-edge {
          opacity: 1;
        }
        /* The overlay adds no box: its children position against the root,
           which is what JumpChip expects of its nearest positioned ancestor. */
        .pretui-stick-to-bottom-overlay {
          display: contents;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-stick-to-bottom-edge {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
