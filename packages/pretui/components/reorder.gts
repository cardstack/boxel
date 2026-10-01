// Pretui — Reorder: rearrange a list by dragging a handle, and, with exactly
// equal capability, from the keyboard. It decorates a list rather than
// owning one.
//
// ── The drag foundation is CONSUMED, not re-invented ────────────────────
//
// An audit of five comparable drag implementations found four were
// pointer-only. Rather than add a third drag engine to this kit, Reorder
// consumes the shared one from `internal/design-tools.gts`:
//
//   dragsSurface   pointer capture, one listener set for any number of rows,
//                  a stable `origin` element so the row that was grabbed is
//                  known for the whole gesture
//   keyboardNudge  THE key map for every drag in the kit — arrows, PageUp/
//                  PageDown, Home/End, and the modifier scaling — decided in
//                  one place so a reorder list and a scrub input cannot
//                  disagree about what Shift+Arrow means
//
// The keyboard path is not a fallback: focus a handle, Enter or Space picks
// the row up, the arrows move it with the list visibly rearranging under
// them, Enter drops it, Escape returns it to where it started. Every phase is
// announced in a live region, because a reader who cannot see the rows move
// has no other channel.
//
// Only a press on a row's handle starts a drag (`dragsSurface`'s `handle`
// selector), so controls inside a row keep their own pointer focus.

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { focusWhen, rovingTabindex } from '../focus';
import { dragsSurface, keyboardNudge } from '../internal/design-tools';
import type { NudgeIntent, SurfaceFrame } from '../internal/design-tools';

// ═══════════════════════════════════════════════════════════════════════
// Reorder — pure maths. No DOM. Unit-tested in controls-reorder.test.gts
// ═══════════════════════════════════════════════════════════════════════

/** Clamp an index into `0 … count - 1`; an empty list clamps to 0. */
function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, index));
}

/**
 * Move one member of a list, returning a NEW array.
 *
 * This is the whole state change a reorder makes, and it is separated from
 * every component concern so it can be checked without a browser. Splice-in-
 * place is the usual implementation and it is wrong for a Glimmer consumer:
 * mutating the array a caller passed in changes it under them without
 * telling the tracking system anything.
 *
 * Out-of-range indices clamp rather than throw — a drag that ends past the
 * last row means "put it last", not "crash".
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  let next = list.slice();
  if (next.length === 0) {
    return next;
  }
  let source = clampIndex(from, next.length);
  let target = clampIndex(to, next.length);
  if (source === target) {
    return next;
  }
  let [moved] = next.splice(source, 1);
  next.splice(target, 0, moved as T);
  return next;
}

/**
 * Where a key press wants to move the grabbed row.
 *
 * Consumes the kit's shared `keyboardNudge` for the key map, then does the
 * one thing a LIST needs that a numeric control does not: collapse the
 * intent to whole positions. `keyboardNudge` scales by modifier keys, so
 * Alt+Arrow yields ±0.1 — meaningless between two rows. Truncating toward
 * zero and then forcing a minimum magnitude of one keeps the fine modifier
 * from silently doing nothing at all, which would read as a broken key.
 *
 * Note `dy` is SCREEN space: ArrowDown is positive, and a list's positions
 * increase downward, so the two frames already agree and no sign flip is
 * needed. (`delta`, the VALUE-space member of the same intent, is inverted —
 * using it here would send ArrowDown up the list.)
 */
export function reorderTarget(
  from: number,
  intent: NudgeIntent,
  count: number,
): number {
  if (!intent.handled || count <= 0) {
    return clampIndex(from, count);
  }
  if (intent.toMin) {
    return 0;
  }
  if (intent.toMax) {
    return count - 1;
  }
  let raw = intent.dy !== 0 ? intent.dy : intent.dx;
  let steps = Math.trunc(raw);
  if (steps === 0 && raw !== 0) {
    steps = raw > 0 ? 1 : -1;
  }
  return clampIndex(from + steps, count);
}

/**
 * The row a pointer at `offset` is over, given each row's centre line.
 *
 * Centres rather than edges: a row is "reached" once the pointer passes its
 * middle, which is what makes a drag feel like it commits at the point the
 * two rows would visually swap rather than a full row-height later. Works
 * with rows of different heights, which a `Math.round(y / rowHeight)`
 * implementation — the common one — does not.
 */
export function indexFromCentres(
  centres: readonly number[],
  offset: number,
): number {
  let index = 0;
  while (index < centres.length && offset > (centres[index] as number)) {
    index = index + 1;
  }
  return clampIndex(index, centres.length);
}

/** The phases a keyboard move passes through. */
export type ReorderPhase = 'grab' | 'move' | 'drop' | 'cancel';

/**
 * What the live region says. Exported and pure because it is the part of
 * this component a sighted reviewer never sees and therefore the part most
 * likely to be wrong; and because a consumer rendering its own status should
 * use the same words rather than invent a second vocabulary.
 *
 * `position` is 1-based — screen-reader copy counts from one, always.
 */
export function reorderAnnouncement(
  phase: ReorderPhase,
  label: string,
  position: number,
  count: number,
): string {
  let place = 'position ' + position + ' of ' + count;
  switch (phase) {
    case 'grab':
      return (
        label +
        ' grabbed, ' +
        place +
        '. Use the arrow keys to move it, Enter to drop, Escape to cancel.'
      );
    case 'move':
      return label + ', ' + place + '.';
    case 'drop':
      return label + ' dropped at ' + place + '.';
    case 'cancel':
      return 'Move cancelled. ' + label + ' returned to ' + place + '.';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Reorder — the component
// ═══════════════════════════════════════════════════════════════════════

/** One rendered row, precomputed so the template stays declarative. */
interface ReorderRow<T> {
  key: string;
  item: T;
  /** where the row sits right now, INCLUDING an in-flight move */
  index: number;
  label: string;
  handleLabel: string;
  grabbed: boolean;
  grabbedAttr: 'true' | 'false';
  isFocus: boolean;
  takesFocus: boolean;
}

export interface ReorderSignature<T = unknown> {
  Args: {
    /** the list, in its current order. Reorder never mutates it. */
    items: readonly T[];
    /** a stable key per item — without one, moving a row re-creates every
     * row after it and focus is lost mid-drag. Defaults to the index, which
     * is correct only for a list whose members never change identity. */
    keyFor?: (item: T, index: number) => string;
    /** the row's name, used for the handle's accessible name and for every
     * announcement. Defaults to the item's own `toString`. */
    labelFor?: (item: T, index: number) => string;
    /** receives the reordered list plus where the row came from and went.
     * Called once per completed move, never during one. */
    onReorder?: (next: T[], from: number, to: number) => void;
    /** accessible name for the list */
    label?: string;
    /** dimmed; neither pointer nor keyboard can move a row */
    disabled?: boolean;
    /** verb prefixed to each handle's accessible name (default 'Reorder') */
    handleVerb?: string;
  };
  Blocks: {
    /** the row's content; only the handle starts a drag, so controls here
     * keep their own focus */
    default: [T, number];
  };
  Element: HTMLDivElement;
}

export class Reorder<T = unknown> extends Component<ReorderSignature<T>> {
  private guid = guidFor(this);
  // Not @tracked: written from a modifier body, read only from event
  // handlers. A tracked value written from a modifier and read in the same
  // computation is a backtracking re-render (menu.gts pays for this lesson).
  private listEl: HTMLElement | undefined;
  private originIndex = 0;

  /** The in-flight order while a move is happening; `undefined` means "the
   * order is exactly `@items`". Holding it separately is what lets Escape
   * restore the original without the caller ever having been told. */
  @tracked private working: T[] | undefined;
  @tracked private grabbed: number | undefined;
  @tracked private focusIndex = 0;
  /** true only while the keyboard is driving, so `focusWhen` never steals
   * focus on a plain re-render or during a pointer drag */
  @tracked private navigating = false;
  @tracked private announcement = '';

  get hintId(): string {
    return this.guid + '-reorder-hint';
  }
  get listLabel(): string {
    return this.args.label ?? 'Reorderable list';
  }
  get order(): readonly T[] {
    return this.working ?? this.args.items ?? [];
  }
  get count(): number {
    return this.order.length;
  }

  private labelAt(item: T, index: number): string {
    if (this.args.labelFor) {
      return this.args.labelFor(item, index);
    }
    return String(item);
  }
  private keyAt(item: T, index: number): string {
    if (this.args.keyFor) {
      return this.args.keyFor(item, index);
    }
    return String(index);
  }

  get rows(): ReorderRow<T>[] {
    let verb = this.args.handleVerb ?? 'Reorder';
    let total = this.count;
    return this.order.map((item, index) => {
      let label = this.labelAt(item, index);
      let grabbed = this.grabbed === index;
      return {
        key: this.keyAt(item, index),
        item,
        index,
        label,
        handleLabel:
          verb + ' ' + label + ', position ' + (index + 1) + ' of ' + total,
        grabbed,
        grabbedAttr: grabbed ? ('true' as const) : ('false' as const),
        isFocus: index === this.focusIndex,
        takesFocus: index === this.focusIndex && this.navigating,
      };
    });
  }

  private capturesList = modifier((el: HTMLElement) => {
    this.listEl = el;
    return () => {
      if (this.listEl === el) {
        this.listEl = undefined;
      }
    };
  });

  private say(phase: ReorderPhase, index: number) {
    let item = this.order[index];
    if (item === undefined) {
      return;
    }
    this.announcement = reorderAnnouncement(
      phase,
      this.labelAt(item, index),
      index + 1,
      this.count,
    );
  }

  private startMove(index: number) {
    this.originIndex = index;
    this.working = (this.args.items ?? []).slice();
    this.grabbed = index;
    this.focusIndex = index;
    this.say('grab', index);
  }

  private applyMove(to: number) {
    let from = this.grabbed;
    if (from === undefined || from === to) {
      return;
    }
    this.working = moveItem(this.order, from, to);
    this.grabbed = to;
    this.focusIndex = to;
  }

  private commit() {
    let to = this.grabbed;
    let next = this.working;
    this.grabbed = undefined;
    this.working = undefined;
    if (to === undefined || next === undefined) {
      return;
    }
    if (to !== this.originIndex) {
      this.args.onReorder?.(next, this.originIndex, to);
    }
    this.focusIndex = to;
    // Announce against the committed order, which is `next` — `this.order`
    // has already fallen back to @items and the caller may not have applied
    // the change yet.
    let item = next[to];
    this.announcement = reorderAnnouncement(
      'drop',
      item === undefined ? '' : this.labelAt(item, to),
      to + 1,
      next.length,
    );
  }

  private cancel() {
    let home = this.originIndex;
    this.grabbed = undefined;
    this.working = undefined;
    this.focusIndex = home;
    this.say('cancel', home);
  }

  onHandleKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    if (this.args.disabled) {
      return;
    }
    let key = event.key;
    let index = this.focusIndex;

    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      this.navigating = true;
      if (this.grabbed === undefined) {
        this.startMove(index);
      } else {
        this.commit();
      }
      return;
    }
    if (key === 'Escape') {
      if (this.grabbed !== undefined) {
        event.preventDefault();
        this.navigating = true;
        this.cancel();
      }
      return;
    }

    let intent = keyboardNudge(key, {
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
      ctrl: event.ctrlKey,
    });
    if (!intent.handled) {
      return;
    }
    event.preventDefault();
    this.navigating = true;
    let target = reorderTarget(index, intent, this.count);
    if (this.grabbed === undefined) {
      // Not carrying anything: the arrows are plain roving focus.
      this.focusIndex = target;
      return;
    }
    this.applyMove(target);
    this.say('move', target);
  };

  onHandleFocus = (event: Event) => {
    let el = event.currentTarget as HTMLElement | null;
    let raw = el?.getAttribute('data-index');
    if (raw === null || raw === undefined) {
      return;
    }
    let index = Number(raw);
    if (Number.isFinite(index) && this.grabbed === undefined) {
      this.focusIndex = index;
    }
  };

  /** Row centre lines, in the list's own coordinate space. Measured at the
   * start of every gesture rather than cached, because a row's height can
   * change between drags (a wrapped label, a season with taller rows). */
  private centres(): number[] {
    let list = this.listEl;
    if (!list) {
      return [];
    }
    let top = list.getBoundingClientRect().top;
    return Array.from(
      list.querySelectorAll<HTMLElement>('[data-reorder-row]'),
    ).map((row) => {
      let box = row.getBoundingClientRect();
      return box.top - top + box.height / 2;
    });
  }

  onDragFrame = (frame: SurfaceFrame) => {
    if (this.args.disabled) {
      return;
    }
    if (frame.phase === 'start') {
      // duck-typed, not instanceof: the event target may come from another realm
      let handle = frame.origin?.closest?.('[data-reorder-handle]') as HTMLElement | null | undefined;
      if (!handle) {
        return;
      }
      let index = Number(handle.getAttribute('data-index'));
      if (!Number.isFinite(index)) {
        return;
      }
      this.navigating = false;
      this.startMove(index);
      // dragsSurface preventDefaults the press, which suppresses the
      // browser's focus-on-click; restore it so the gesture can be finished
      // from the keyboard.
      handle.focus();
      return;
    }
    if (this.grabbed === undefined) {
      return;
    }
    if (frame.phase === 'move') {
      let target = indexFromCentres(this.centres(), frame.ny * frame.height);
      if (target !== this.grabbed) {
        this.applyMove(target);
        this.say('move', target);
      }
      return;
    }
    this.commit();
  };

  <template>
    <div class='pretui-reorder' data-test-pretui-reorder ...attributes>
      <ol
        class='pretui-reorder-list'
        aria-label={{this.listLabel}}
        aria-describedby={{this.hintId}}
        data-disabled={{if @disabled 'true'}}
        {{this.capturesList}}
        {{dragsSurface this.onDragFrame @disabled handle='[data-reorder-handle]'}}
      >
        {{#each this.rows key='key' as |row|}}
          <li
            class='pretui-reorder-row'
            data-reorder-row
            data-grabbed={{row.grabbedAttr}}
          >
            <button
              type='button'
              class='pretui-reorder-handle'
              data-reorder-handle
              data-index={{row.index}}
              data-test-pretui-reorder-handle
              aria-label={{row.handleLabel}}
              aria-pressed={{row.grabbedAttr}}
              aria-disabled={{if @disabled 'true'}}
              {{rovingTabindex row.isFocus}}
              {{focusWhen row.takesFocus}}
              {{on 'keydown' this.onHandleKeydown}}
              {{on 'focus' this.onHandleFocus}}
            ><span class='pretui-reorder-grip' aria-hidden='true'></span></button>
            <div class='pretui-reorder-content'>{{yield row.item row.index}}</div>
          </li>
        {{/each}}
      </ol>
      <p id={{this.hintId}} class='pretui-reorder-hint'>Press Enter or Space
        on a handle to pick the row up, the arrow keys to move it, Enter to
        drop it and Escape to cancel.</p>
      <p
        class='pretui-reorder-status'
        role='status'
        aria-live='polite'
        data-test-pretui-reorder-status
      >{{this.announcement}}</p>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-reorder-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--space-2, 6px);
        }
        .pretui-reorder-list[data-disabled='true'] {
          opacity: 0.55;
        }
        .pretui-reorder-row {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          padding: var(--space-2, 6px) var(--space-3, 8px);
          border-radius: var(--radius-control, 8px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        /* Law 5: the raised state encodes "this row is the one you are
           carrying" — a fact the reader would otherwise have to infer from
           rows shuffling. It is a resting state, visible in a still frame
           (Law 8), so nothing depends on animation to be legible. */
        .pretui-reorder-row[data-grabbed='true'] {
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border),
            0 2px 10px rgb(0 0 0 / 0.22)
          );
          background: color-mix(
            in oklch,
            var(--primary) 5%,
            var(--card)
          );
        }
        .pretui-reorder-handle {
          flex: none;
          display: grid;
          place-items: center;
          width: var(--pretui-reorder-handle-size, 28px);
          height: var(--pretui-reorder-handle-size, 28px);
          padding: 0;
          border: 0;
          border-radius: var(--radius-control, 8px);
          background: transparent;
          color: var(--muted-foreground);
          cursor: grab;
          /* Scoped to the handle, not the list: a list-wide touch-action:none
             would kill page scrolling over the whole component on touch, and
             the gesture can only ever begin on a handle. */
          touch-action: none;
        }
        .pretui-reorder-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-reorder-handle[aria-pressed='true'] {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
          cursor: grabbing;
        }
        .pretui-reorder-handle[aria-disabled='true'] {
          cursor: default;
        }
        /* The grip is drawn, not lettered: a glyph would be read by assistive
           tech in some engines and would re-hint at a different size in every
           font. Six dots, two columns, one gradient. */
        .pretui-reorder-grip {
          width: 10px;
          height: 16px;
          background-image: radial-gradient(
            currentColor 44%,
            transparent 46%
          );
          background-size: 5px 5px;
          background-position: 0 1px;
          background-repeat: round;
          opacity: 0.85;
        }
        .pretui-reorder-content {
          flex: 1;
          min-width: 0;
        }
        .pretui-reorder-hint,
        .pretui-reorder-status {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          border: 0;
        }
        /* Coarse pointers get a bigger grab target than the visual handle —
           the visual stays 28px so the row keeps its proportions. */
        @media (any-pointer: coarse) {
          .pretui-reorder-handle {
            width: var(--pretui-reorder-handle-touch, 44px);
            height: var(--pretui-reorder-handle-touch, 44px);
          }
        }
      }
    </style>
  </template>
}
