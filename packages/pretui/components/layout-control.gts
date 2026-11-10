// Pretui — LayoutControl: a toolbar row that measures its own width and picks one form
// per slot (richest that fits). It lays out and chooses; it paints nothing.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import type { ComponentLike } from '@glint/template';
import { Menu } from './menu';
import { IconButton } from './icon-button';
import { Popover } from './popover';
import { Drawer } from './drawer';
import { FOCUSABLE } from '../focus';
import { iconFor } from '../icon-registry';
import type { MenuEntry } from '../internal/menu';

/** One form a slot can take. `minWidth` is in rem (the bar converts with the
 * root font size), so the chooser follows the user's text size. The form
 * named 'menu' takes no room in the row: the slot folds into the ⋯ menu. */
export interface LayoutControlForm {
  name: string;
  minWidth: number;
}

export interface LayoutControlSlotSpec {
  id: string;
  priority: number;
  forms: LayoutControlForm[];
}

export const MENU_FORM = 'menu';
// px of spare room needed before a slot steps back up, so a width that sits
// on a boundary doesn't flip the form on every resize tick.
export const HYSTERESIS_PX = 16;
// Measuring: a slot taller than this many control heights has wrapped; a
// resize gets at most MAX_FIT_PASSES measure-and-step frames.
const WRAP_RATIO = 1.25;
const MAX_FIT_PASSES = 8;

/**
 * The chooser, pure so it can be checked without a DOM. Every slot starts at
 * its richest form (index 0). While the row doesn't fit, step down one slot:
 * among slots that can still step, the one that has stepped least; ties go to
 * the least important (highest @priority, then the later slot). Returns a
 * form index per slot id. A slot with no 'menu' form (or with @pinned) never
 * folds; that is how the primary action stays in the row.
 */
export function chooseForms(
  slots: LayoutControlSlotSpec[],
  widthPx: number,
  gapPx: number,
  overflowPx: number,
  remPx: number,
): Map<string, number> {
  let level = slots.map(() => 0);
  let need = () => {
    let visible = 0;
    let total = 0;
    let folded = false;
    slots.forEach((slot, i) => {
      let form = slot.forms[level[i]!]!;
      if (form.name === MENU_FORM) {
        folded = true;
      } else {
        visible++;
        total += form.minWidth * remPx;
      }
    });
    if (folded) {
      visible++;
      total += overflowPx;
    }
    return total + gapPx * Math.max(visible - 1, 0);
  };
  while (need() > widthPx) {
    let can = slots
      .map((_, i) => i)
      .filter((i) => level[i]! < slots[i]!.forms.length - 1);
    if (!can.length) {
      break;
    }
    let least = Math.min(...can.map((i) => level[i]!));
    let pick = can
      .filter((i) => level[i] === least)
      .sort((a, b) => slots[b]!.priority - slots[a]!.priority || b - a)[0]!;
    level[pick]!++;
  }
  return new Map(slots.map((slot, i) => [slot.id, level[i]!]));
}

/**
 * Hysteresis, per slot and pure. A slot that would step back up (`next` richer
 * than `last`) only does so as far as `guarded` allows: the choice made
 * HYSTERESIS_PX narrower. Steps down, and slots with no previous level, are
 * taken as they are. Each level is never richer than `next`'s, so the result
 * still fits.
 */
export function applyHysteresis(
  next: Map<string, number>,
  last: Map<string, number>,
  guarded: Map<string, number>,
): Map<string, number> {
  return new Map(
    [...next].map(([id, n]) => {
      let l = last.get(id);
      return [id, l !== undefined && n < l ? Math.min(guarded.get(id) ?? l, l) : n];
    }),
  );
}

/** A choice a folded slot offers in the ⋯ menu. With `group` it is one of a
 * single-choice set (menuitemradio); without, an independent on/off
 * (menuitemcheckbox). `onSelect` fires on activation either way. */
export interface LayoutControlChoice {
  label: string;
  value: string;
  checked?: boolean;
  group?: string;
  onSelect?: () => void;
}

function isMenuEntry(item: LayoutControlChoice | MenuEntry): item is MenuEntry {
  return typeof item === 'string' || 'kind' in item;
}

// Choices become the kit Menu's own radio / toggle nodes; MenuEntry values
// (the earlier @menuItems shape) pass through unchanged.
function toMenuEntry(item: LayoutControlChoice | MenuEntry): MenuEntry {
  if (isMenuEntry(item)) {
    return item;
  }
  let { label, checked, group, onSelect } = item;
  return group
    ? { kind: 'radio', group, label, checked, onSelect }
    : { kind: 'toggle', label, checked: checked ?? false, onSelect };
}

// The fallback opens as a bottom sheet below this viewport width.
const SHEET_QUERY = '(max-width: 40rem)';

export interface LayoutControlSlotSignature {
  Args: {
    /** stable id, unique within the bar */
    id: string;
    /** importance: 0 is the most important, larger steps down sooner */
    priority?: number;
    /** richest first, e.g. [{ name: 'label', minWidth: 7 }, { name: 'icon', minWidth: 2 }].
     * End with { name: 'menu', minWidth: 0 } only if the slot may fold into ⋯ */
    forms: LayoutControlForm[];
    /** the slot's name: heading of its ⋯ menu section, the '@label…' item
     * text when it has no @menuItems, and the fallback panel's accessible
     * name (default: @id) */
    label?: string;
    /** native ⋯ menu items while folded: LayoutControlChoice[] (radio when
     * `group` is set, checkbox otherwise) or kit MenuEntry[]. Without it,
     * the slot folds to one '@label…' item that opens its full content in a
     * popover (a bottom sheet under 40rem wide) */
    menuItems?: (LayoutControlChoice | MenuEntry)[];
    /** never folds into ⋯; still steps down its own forms. Use it for the
     * primary action */
    pinned?: boolean;
  };
  Blocks: { default: [form: string] };
  Element: HTMLSpanElement;
}

class LayoutControlSlot extends Component<
  LayoutControlSlotSignature & { Args: { bar: LayoutControl } }
> {
  get spec(): LayoutControlSlotSpec {
    let { id, priority, forms, pinned } = this.args;
    return {
      id,
      priority: priority ?? 1,
      forms: pinned ? forms.filter((f) => f.name !== MENU_FORM) : forms,
    };
  }
  get label() {
    return this.args.label ?? this.args.id;
  }
  /** the richest form, which the fallback panel shows */
  get fullForm() {
    return this.args.forms[0]?.name ?? '';
  }
  get fallbackTarget() {
    let bar = this.args.bar;
    return this.folded && bar.fallbackSlot === this
      ? bar.fallbackTarget
      : undefined;
  }
  get form() {
    return this.args.bar.formFor(this.spec);
  }
  get folded() {
    return this.form === MENU_FORM;
  }
  el: HTMLElement | undefined;
  register = modifier((el: HTMLElement) => {
    this.el = el;
    this.args.bar.register(this);
    return () => this.args.bar.unregister(this);
  });
  <template>
    {{! display: contents — the slot is a registration point, not a box }}
    <span
      class='pretui-lc-slot'
      data-slot={{@id}}
      data-form={{this.form}}
      {{this.register}}
      ...attributes
    >
      {{#unless this.folded}}
        {{yield this.form}}
      {{/unless}}
      {{! the same block, moved into the ⋯ fallback panel while it is open }}
      {{#if this.fallbackTarget}}
        {{#in-element this.fallbackTarget insertBefore=null}}
          {{yield this.fullForm}}
        {{/in-element}}
      {{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-lc-slot {
          display: contents;
          /* inherited through display: contents, so labels never break */
          white-space: nowrap;
        }
      }
    </style>
  </template>
}

export interface LayoutControlSignature {
  Args: {
    /** accessible name for the row (default 'Toolbar') */
    label?: string;
    /** one height for every control in the row; sets --pretui-row-h (and
     * --control-height) on the bar. Any CSS length (default: none set, so
     * each control keeps its own height) */
    controlHeight?: string;
    /** accessible name of the ⋯ button (default 'More options') */
    overflowLabel?: string;
  };
  Blocks: {
    default: [
      {
        Slot: ComponentLike<LayoutControlSlotSignature>;
        overflow: { active: boolean; folded: string[] };
      },
    ];
  };
  Element: HTMLDivElement;
}

/**
 * The row is display: flex with a gap. It measures its own inline size with a
 * ResizeObserver and re-runs the chooser; each Slot renders only its chosen
 * form (alternatives are never hidden with CSS, so they never reach the
 * accessibility tree or the tab order). Folded slots appear as sections of
 * one ⋯ Menu at the end of the row.
 */
export class LayoutControl extends Component<LayoutControlSignature> {
  @tracked private slots: LayoutControlSlot[] = [];
  @tracked private levels = new Map<string, number>();
  /** the folded slot whose full content is open from ⋯ */
  @tracked fallbackSlot: LayoutControlSlot | undefined;
  @tracked fallbackTarget: HTMLElement | undefined;
  @tracked private asSheet = false;
  private moreEl: HTMLElement | undefined;
  private widthPx = Infinity;
  private gapPx = 0;
  private overflowPx = 0;
  private remPx = 16;
  private controlPx = 0;
  private barEl: HTMLElement | undefined;
  /** real rem width per `slotId:form`, from renders that fit */
  private measured = new Map<string, number>();
  /** forms that wrapped or overflowed: an over-estimate, valid only below
   * the bar width it failed at (plus hysteresis); wider, the form is tried
   * again, so growing the bar always gets back to the richer forms */
  private failed = new Map<string, { rem: number; atPx: number }>();
  private fitPasses = 0;
  private fitFrame = 0;

  get label() {
    return this.args.label ?? 'Toolbar';
  }
  get overflowLabel() {
    return this.args.overflowLabel ?? 'More options';
  }
  get style() {
    let h = this.args.controlHeight;
    return h ? `--control-height: ${h}; --pretui-row-h: ${h}` : undefined;
  }
  get moreIcon() {
    return iconFor('ellipsis');
  }

  // Registration runs from a modifier (after render); writing tracked state
  // there in the same transaction would backtrack, so it waits a microtask.
  register(slot: LayoutControlSlot) {
    queueMicrotask(() => {
      this.slots = [...this.slots, slot];
      this.choose();
    });
  }
  unregister(slot: LayoutControlSlot) {
    queueMicrotask(() => {
      this.slots = this.slots.filter((s) => s !== slot);
      this.choose();
    });
  }

  // Runs on resize and on (un)registration, not from a getter, because the
  // hysteresis needs the previous choice.
  // shortcut: a Slot whose @forms change later is picked up on the next
  // resize, not at once; make `levels` a getter over a tracked memo if needed.
  private choose() {
    // a measured width, once known, replaces the declared first guess
    let widthOf = (key: string, declared: number) => {
      let fail = this.failed.get(key);
      if (fail && this.widthPx >= fail.atPx + HYSTERESIS_PX) {
        this.failed.delete(key);
        fail = undefined;
      }
      return fail?.rem ?? this.measured.get(key) ?? declared;
    };
    let specs = this.slots.map((s) => {
      let spec = s.spec;
      return {
        ...spec,
        forms: spec.forms.map((f) => ({
          ...f,
          minWidth: widthOf(`${spec.id}:${f.name}`, f.minWidth),
        })),
      };
    });
    let at = (w: number) =>
      chooseForms(specs, w, this.gapPx, this.overflowPx, this.remPx);
    let last = this.levels;
    // Stepping down happens at the exact width; stepping back up only once
    // the richer choice also fits HYSTERESIS_PX narrower.
    let next = applyHysteresis(
      at(this.widthPx),
      last,
      at(this.widthPx - HYSTERESIS_PX),
    );
    let same =
      next.size === last.size &&
      [...next].every(([id, l]) => last.get(id) === l);
    if (!same) {
      this.levels = next;
    }
    // an unfolded slot's panel closes for good, so folding again doesn't reopen it
    if (this.fallbackSlot && !this.fallbackSlot.folded) {
      this.closeFallback();
    }
    this.scheduleFit();
  }

  // After the chosen forms render, measure what the declared widths only
  // guessed. One rAF per pass, at most MAX_FIT_PASSES passes per resize, so a
  // bad guess costs a frame or two and can't become a flicker loop.
  private scheduleFit() {
    if (this.fitFrame || this.fitPasses >= MAX_FIT_PASSES) {
      return;
    }
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      this.fitPasses++;
      this.fit();
    });
  }

  private fit() {
    let bar = this.barEl;
    if (!bar || !this.controlPx) {
      return;
    }
    let wrapLimit = this.controlPx * WRAP_RATIO;
    let changed = false;
    let record = (key: string, rem: number) => {
      if (Math.abs((this.measured.get(key) ?? -1) - rem) > 0.01) {
        this.measured.set(key, rem);
        changed = true;
      }
    };
    let fail = (key: string, rem: number) => {
      this.failed.set(key, { rem, atPx: this.widthPx });
      changed = true;
    };
    let steppable: { key: string; priority: number; width: number }[] = [];
    for (let slot of this.slots) {
      let form = slot.form;
      if (!slot.el || form === MENU_FORM) {
        continue;
      }
      // the slot is display: contents, so its rendered children are the
      // flex items; their boxes are its real width and height
      let width = 0;
      let height = 0;
      for (let child of slot.el.children) {
        let rect = child.getBoundingClientRect();
        width += rect.width;
        height = Math.max(height, rect.height);
      }
      if (!width) {
        continue;
      }
      let key = `${slot.args.id}:${form}`;
      let lines = Math.ceil(height / this.controlPx);
      // A wrapped slot's natural width is at most its box times its lines;
      // that over-estimate is what steps it down and keeps it down.
      if (height > wrapLimit) {
        fail(key, (width * lines) / this.remPx);
      } else {
        record(key, width / this.remPx);
      }
      let spec = slot.spec;
      if (spec.forms[spec.forms.length - 1]?.name !== form) {
        steppable.push({ key, priority: spec.priority, width });
      }
    }
    // Overflow without a wrap: charge the deficit to the least important slot
    // that can still step, so the chooser steps it.
    let deficit = bar.scrollWidth - bar.clientWidth;
    if (deficit > 1 && steppable.length) {
      let pick = steppable.sort((a, b) => b.priority - a.priority)[0]!;
      fail(pick.key, (pick.width + deficit) / this.remPx);
    }
    if (changed) {
      this.choose();
    }
  }

  formFor = (spec: LayoutControlSlotSpec): string => {
    let i = this.levels.get(spec.id) ?? 0;
    return (spec.forms[i] ?? spec.forms[0])?.name ?? '';
  };

  get foldedSlots() {
    return this.slots.filter((s) => s.folded);
  }
  get overflow() {
    return {
      active: this.foldedSlots.length > 0,
      folded: this.foldedSlots.map((s) => s.args.id),
    };
  }
  get overflowItems(): MenuEntry[] {
    return this.foldedSlots.map((s) =>
      s.args.menuItems?.length
        ? {
            kind: 'section' as const,
            label: s.label,
            items: s.args.menuItems.map(toMenuEntry),
          }
        : { label: `${s.label}…`, onSelect: () => this.openFallback(s) },
    );
  }

  // Only while its slot is still folded; a resize that unfolds it closes it.
  get fallbackOpen() {
    return Boolean(this.fallbackSlot?.folded);
  }
  get popoverOpen() {
    return this.fallbackOpen && !this.asSheet;
  }
  get sheetOpen() {
    return this.fallbackOpen && this.asSheet;
  }
  get fallbackLabel() {
    return this.fallbackSlot?.label;
  }

  openFallback = (slot: LayoutControlSlot) => {
    this.asSheet = window.matchMedia(SHEET_QUERY).matches;
    this.fallbackSlot = slot;
  };
  closeFallback = () => {
    this.fallbackSlot = undefined;
    this.fallbackTarget = undefined;
  };
  onPopoverChange = (open: boolean) => {
    if (!open) {
      this.closeFallback();
    }
  };
  // The dialog restores focus to the menu item it opened from, which is gone
  // by then, so focus goes back to ⋯ explicitly.
  // A frame late, after the native dialog has restored its own focus.
  closeSheet = () => {
    this.closeFallback();
    requestAnimationFrame(() =>
      this.moreEl?.querySelector<HTMLElement>('button')?.focus(),
    );
  };
  // The dialog's cancel still runs (it is the keydown's default action);
  // stopping propagation keeps a host Escape handler, such as the card
  // stack's close, from also acting on the same key.
  keepEscape = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      event.stopPropagation();
    }
  };
  captureMore = modifier((el: HTMLElement) => {
    this.moreEl = el;
  });
  // The panel element is the slot's in-element target. Written a microtask
  // late (tracked state from a modifier), then focus moves to the first
  // control the slot rendered into it.
  fallbackPanel = modifier((el: HTMLElement) => {
    queueMicrotask(() => {
      this.fallbackTarget = el;
      // a frame late, so it wins over the dialog's own initial focus
      requestAnimationFrame(() =>
        el.querySelector<HTMLElement>(FOCUSABLE)?.focus(),
      );
    });
  });

  measure = modifier((el: HTMLElement) => {
    let read = (inline: number) => {
      let root = getComputedStyle(document.documentElement);
      let own = getComputedStyle(el);
      this.remPx = parseFloat(root.fontSize) || 16;
      this.gapPx = parseFloat(own.columnGap) || 0;
      // the ⋯ button is square at the control height (min-height, not the
      // box, which a wrapped child would make taller)
      this.controlPx = parseFloat(own.minHeight) || el.clientHeight || 0;
      this.overflowPx = this.controlPx;
      this.barEl = el;
      this.widthPx = inline;
      this.fitPasses = 0;
      this.choose();
    };
    let observer = new ResizeObserver(([entry]) => {
      if (entry) {
        read(entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  <template>
    <div
      class='pretui-lc'
      role='group'
      aria-label={{this.label}}
      style={{this.style}}
      data-overflow={{if this.overflow.active 'true'}}
      {{this.measure}}
      data-test-pretui-layout-control
      ...attributes
    >
      {{yield
        (hash
          Slot=(component LayoutControlSlot bar=this) overflow=this.overflow
        )
      }}
      {{#if this.overflow.active}}
        {{! Popover anchors the fallback panel to ⋯ and returns focus to it }}
        <Popover
          @open={{this.popoverOpen}}
          @onOpenChange={{this.onPopoverChange}}
          @placement='bottom-end'
          @label={{this.fallbackLabel}}
          class='pretui-lc-more'
          {{this.captureMore}}
        >
          <:trigger>
            <Menu
              @items={{this.overflowItems}}
              @align='end'
              @label={{this.overflowLabel}}
              data-test-pretui-layout-control-more
            >
              {{! Menu doesn't open itself: the trigger must call toggle }}
              <:trigger as |_open toggle|>
                <IconButton
                  @label={{this.overflowLabel}}
                  @icon={{this.moreIcon}}
                  @appearance='plain'
                  {{on 'click' toggle}}
                />
              </:trigger>
            </Menu>
          </:trigger>
          <:default>
            <div
              class='pretui-lc-fallback'
              {{this.fallbackPanel}}
              data-test-pretui-layout-control-fallback
            ></div>
          </:default>
        </Popover>
      {{/if}}
      <Drawer
        @open={{this.sheetOpen}}
        @onClose={{this.closeSheet}}
        @placement='bottom'
        @label={{this.fallbackLabel}}
        {{on 'keydown' this.keepEscape}}
      >
        <:title>{{this.fallbackLabel}}</:title>
        <:default>
          {{#if this.sheetOpen}}
            <div
              class='pretui-lc-fallback'
              {{this.fallbackPanel}}
              data-test-pretui-layout-control-sheet
            ></div>
          {{/if}}
        </:default>
      </Drawer>
    </div>
    <style scoped>
      @layer PretComponent, PretComposite;
      /* composite: it passes a class onto Popover's root */
      @layer PretComposite {
        .pretui-lc {
          /* Equal height: @controlHeight sets --pretui-row-h on this root, and
             a control reads it as the first link of its own height chain
             (custom properties inherit, so no :deep()). The theme also defines
             --control-height for every themed scope, so controls read the
             row-scoped name, which only a sized row sets. */
          display: flex;
          align-items: center;
          gap: var(--pretui-lc-gap, var(--boxel-sp-xs));
          min-width: 0;
          flex-wrap: nowrap;
          min-height: var(--control-height);
          overflow: clip;
          /* room for the 2px focus ring plus its 2px offset on the edge controls */
          overflow-clip-margin: 4px;
        }
        .pretui-lc-more {
          flex: none;
          margin-inline-start: auto;
        }
        .pretui-lc-fallback {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--pretui-lc-gap, var(--boxel-sp-xs));
        }
      }
    </style>
  </template>
}
