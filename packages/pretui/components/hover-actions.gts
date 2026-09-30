// Pretui — HoverActions: row actions revealed on hover or focus, with an overflow menu.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { iconFor } from '../icon-registry';
import { Button } from './button';
import type { PretuiSize } from '../pretui-primitives';
import { Menu } from './menu';
import type { MenuEntry } from '../internal/menu';
import { clampIndex } from '../internal/toggle-controls';

// ─────────────────────────────────────────────────────────────────────────
// HoverActions
// ─────────────────────────────────────────────────────────────────────────

export interface HoverAction {
  id: string;
  /** required: an icon-only control with no name is not a control */
  label: string;
  /** icon-registry name */
  icon?: string;
  disabled?: boolean;
  /** tinted destructive, and routed to the end of the overflow menu */
  destructive?: boolean;
  onSelect?: () => void;
}

/**
 * Splits a cluster into the buttons that stay visible and the ones that fold
 * into the overflow menu.
 *
 * The arithmetic that is usually wrong: when there IS an overflow, the menu
 * trigger occupies one of the visible slots, so only `maxVisible - 1` actions
 * can stay out. A naive `slice(0, maxVisible)` plus a trigger renders
 * `maxVisible + 1` controls and the budget means nothing.
 */
export function splitActions(
  actions: readonly HoverAction[],
  maxVisible?: number,
): { inline: HoverAction[]; overflow: HoverAction[] } {
  let all = [...actions];
  if (maxVisible === undefined || maxVisible <= 0 || all.length <= maxVisible) {
    return { inline: all, overflow: [] };
  }
  let keep = Math.max(0, maxVisible - 1);
  return { inline: all.slice(0, keep), overflow: all.slice(keep) };
}

export interface HoverActionsSignature {
  Args: {
    /** the cluster's actions. Omit to supply the `:actions` block instead. */
    actions?: readonly HoverAction[];
    /**
     * The toolbar's accessible name, and it must say WHICH thing the actions
     * act on — "Actions for Q3 roadmap", not "Actions". Fifty rows of
     * identically-named toolbars is a list a reader cannot navigate.
     */
    label: string;
    /** total control budget; anything past it folds into an overflow Menu */
    maxVisible?: number;
    /**
     * `overlay` (default) floats the cluster inside the host's own bounds;
     * `reserve` gives it a real grid column so it can never cover content.
     *
     * The ruling: **both modes are layout-stable** — that is Appendix O.7's
     * actual requirement, and an overlay satisfies it for free because it is
     * out of flow. Overlay is the default because a permanently empty gutter
     * fails Law 8's still-frame test: at rest it is dead space that earns
     * nothing. Choose `reserve` for dense text rows, where an overlay would
     * sit on top of the words; keep `overlay` for tiles, media and any host
     * with its own padding.
     */
    space?: 'overlay' | 'reserve';
    /** corner the cluster occupies in `overlay` mode (default `top-end`) */
    placement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
    /** `hover` (default) reveals on hover **or** focus-within; `always` keeps
     * the cluster on, which is what dense lists and touch-first surfaces
     * want. Coarse pointers get `always` for free — hover is not an input on
     * a touchscreen, and a hover-only affordance is simply missing there. */
    reveal?: 'hover' | 'always';
    /** size scale for the cluster's buttons (default `s`) */
    size?: PretuiSize;
    /** fires for every action, inline or overflow, after its own onSelect */
    onSelect?: (action: HoverAction) => void;
  };
  Blocks: {
    /** the host: the row, card or cell the actions belong to */
    default: [];
    /**
     * Custom cluster contents, replacing `@actions`. Roving tabindex applies
     * only to the `@actions` path — this component cannot know what is inside
     * a block, so a block-supplied cluster keeps its members as ordinary tab
     * stops. Note the Glimmer rule: once you open this block the host content
     * must move into an explicit `<:default>`.
     */
    actions: [];
  };
  Element: HTMLDivElement;
}

// **From:** `catalog-app/components/listing-hover-card.gts` (the good one)
// and `catalog-app/components/catalog-image-overlay.gts` (the cautionary one).
//
// The good source deserves its reputation: no portal, no collision
// detection, nothing to dismiss — `position: absolute; inset: 0` inside the
// host's own bounds, revealed by `:hover` **or `:focus-within`** in pure CSS,
// `pointer-events: none` while hidden, `stopPropagation` per button so the
// tile's own navigation stays quiet, and a `prefers-reduced-motion` guard.
// All of that is kept. The cautionary one shows the trap in its pure form —
// `:hover` only, so tabbing to its buttons leaves them at `opacity: 0`.
//
// **Better than the inspiration:**
//
//  * **Touch is an input, not an edge case.** The sources are hover-only, so
//    on a touchscreen the first tap does nothing and there is no way in.
//    `@media (any-pointer: coarse)` pins the cluster on, and `@reveal='always'`
//    does the same by hand. No JS, no user-agent sniffing.
//  * **One tab stop, not four per row.** `role='toolbar'` with roving
//    tabindex is the difference between 4 and 200 tab stops on a fifty-row
//    list. The sources put every button in the tab order — which is not a
//    keyboard path, it is a keyboard tax.
//  * **Escape returns focus to the host**, so a reader who opened the cluster
//    can leave it without tabbing forward through it.
//  * **Real icons and real names.** `↺` / `▷` / `→` as button text announce
//    as "anticlockwise open circle arrow"; every action here carries a
//    required `label`, drawn as `title` and as `sr-only` text, with the glyph
//    from the icon registry and `aria-hidden`.
//  * **Overflow folds into the kit's `Menu`** rather than being dropped by a
//    container query. The source's progressive drop removes actions entirely
//    at narrow widths — a control that vanishes is not responsive.
//  * Four hardcoded `rgba()` values became tokens, and the dead `@container`
//    block styling a child component's class names is gone.
export class HoverActions extends Component<HoverActionsSignature> {
  @tracked private focusIndex = 0;
  @tracked private navigating = false;

  get actions(): readonly HoverAction[] {
    return this.args.actions ?? [];
  }
  get hasActions(): boolean {
    return this.actions.length > 0;
  }
  get split(): { inline: HoverAction[]; overflow: HoverAction[] } {
    return splitActions(this.actions, this.args.maxVisible);
  }
  get inline(): HoverAction[] {
    return this.split.inline;
  }
  get overflow(): HoverAction[] {
    return this.split.overflow;
  }
  get hasOverflow(): boolean {
    return this.overflow.length > 0;
  }
  get size(): PretuiSize {
    return this.args.size ?? 's';
  }
  get space(): 'overlay' | 'reserve' {
    return this.args.space ?? 'overlay';
  }
  get placement(): string {
    return this.args.placement ?? 'top-end';
  }
  get reveal(): 'hover' | 'always' {
    return this.args.reveal ?? 'hover';
  }
  get moreLabel(): string {
    return 'More actions';
  }
  /** the overflow trigger sits one past the last inline button */
  get moreIndex(): number {
    return this.inline.length;
  }
  /** stops, in the toolbar's tab-stop space */
  private get stopCount(): number {
    return this.inline.length + (this.hasOverflow ? 1 : 0);
  }
  get menuItems(): MenuEntry[] {
    return this.overflow.map((item) => ({
      label: item.label,
      icon: item.icon,
      disabled: item.disabled,
      destructive: item.destructive,
      onSelect: () => this.fire(item),
    }));
  }

  iconOf = (item: HoverAction) => iconFor(item.icon);
  isRoving = (index: number): boolean => index === this.rovingIndex;
  isFocusTarget = (index: number): boolean =>
    this.navigating && index === this.rovingIndex;
  get rovingIndex(): number {
    let count = this.stopCount;
    if (count <= 0) {
      return 0;
    }
    return clampIndex(this.focusIndex, 0, count - 1);
  }
  get moreRoving(): boolean {
    return this.hasOverflow && this.rovingIndex === this.moreIndex;
  }
  get moreFocusTarget(): boolean {
    return this.navigating && this.moreRoving;
  }

  private fire(item: HoverAction) {
    if (item.disabled) {
      return;
    }
    item.onSelect?.();
    this.args.onSelect?.(item);
  }

  run = (item: HoverAction, index: number) => {
    this.navigating = false;
    this.focusIndex = index;
    this.fire(item);
  };

  // The host tile usually navigates on click; an action inside it must not
  // also trigger that. One listener on the cluster covers every member,
  // including whatever a caller puts in the :actions block.
  stopHostClick = (event: Event) => {
    event.stopPropagation();
  };

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.altKey || ev.metaKey || ev.ctrlKey) {
      return;
    }
    if (ev.key === 'Escape') {
      // hand focus back to the host rather than dropping it on the document
      let cluster = ev.currentTarget as HTMLElement;
      let root = cluster.closest('[data-pretui-ha-root]') as HTMLElement | null;
      if (root) {
        ev.preventDefault();
        ev.stopPropagation();
        this.navigating = false;
        root.focus();
      }
      return;
    }
    let count = this.stopCount;
    if (count <= 0) {
      return;
    }
    let at = this.rovingIndex;
    let step: number | undefined;
    if (ev.key === 'ArrowRight') {
      step = at + 1;
    } else if (ev.key === 'ArrowLeft') {
      step = at - 1;
    } else if (ev.key === 'Home') {
      step = 0;
    } else if (ev.key === 'End') {
      step = count - 1;
    }
    if (step === undefined) {
      return;
    }
    ev.preventDefault();
    this.navigating = true;
    this.focusIndex = (step + count) % count;
  };

  onFocusIn = (event: Event) => {
    let target = event.target as HTMLElement | null;
    let member = target?.closest('[data-ha-index]') as HTMLElement | null;
    if (!member) {
      return;
    }
    let index = Number(member.dataset.haIndex);
    if (Number.isNaN(index) || index === this.rovingIndex) {
      return;
    }
    this.navigating = false;
    this.focusIndex = index;
  };

  <template>
    <div
      class='pretui-ha'
      tabindex='-1'
      data-pretui-ha-root
      data-space={{this.space}}
      data-placement={{this.placement}}
      data-reveal={{this.reveal}}
      data-test-pretui-hover-actions
      ...attributes
    >
      <div class='pretui-ha-host'>{{yield}}</div>
      <div
        class='pretui-ha-cluster'
        role='toolbar'
        aria-label={{@label}}
        aria-orientation='horizontal'
        data-test-pretui-hover-actions-cluster
        {{listen 'click' this.stopHostClick}}
        {{listen 'keydown' this.onKeydown}}
        {{listen 'focusin' this.onFocusIn}}
      >
        {{#if this.hasActions}}
          {{#each this.inline key='id' as |item index|}}
            <Button
              class='pretui-ha-btn'
              @tone={{if item.destructive 'danger' 'neutral'}}
              @appearance='filled-outlined'
              @size={{this.size}}
              aria-disabled={{if item.disabled 'true'}}
              title={{item.label}}
              data-ha-index={{index}}
              data-test-pretui-hover-action={{item.id}}
              {{rovingTabindex (this.isRoving index)}}
              {{focusWhen (this.isFocusTarget index)}}
              {{on 'click' (fn this.run item index)}}
            >
              {{#let (this.iconOf item) as |Glyph|}}
                {{#if Glyph}}
                  <Glyph class='pretui-ha-icon' role='presentation' />
                {{/if}}
              {{/let}}
              <span class='pretui-ha-sr'>{{item.label}}</span>
            </Button>
          {{/each}}
          {{#if this.hasOverflow}}
            <Menu @items={{this.menuItems}} @label={{this.moreLabel}} @align='end'>
              <:trigger as |_isOpen toggleMenu|>
                <Button
                  class='pretui-ha-btn'
                  @tone='neutral'
                  @appearance='filled-outlined'
                  @size={{this.size}}
                  title={{this.moreLabel}}
                  data-ha-index={{this.moreIndex}}
                  data-test-pretui-hover-actions-more
                  {{rovingTabindex this.moreRoving}}
                  {{focusWhen this.moreFocusTarget}}
                  {{on 'click' toggleMenu}}
                >
                  <span class='pretui-ha-dots' aria-hidden='true'></span>
                  <span class='pretui-ha-sr'>{{this.moreLabel}}</span>
                </Button>
              </:trigger>
            </Menu>
          {{/if}}
        {{else}}
          {{yield to='actions'}}
        {{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-ha {
        position: relative;
        container-type: inline-size;
        min-width: 0;
      }
      .pretui-ha:focus {
        outline: none;
      }
      .pretui-ha:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
        border-radius: var(--radius);
      }
      .pretui-ha-host {
        min-width: 0;
      }
      /* reserve: the cluster owns a real grid column, so it can never sit on
         top of the host's words and the host never re-flows when it appears */
      .pretui-ha[data-space='reserve'] {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        column-gap: var(--pretui-hoveractions-gap, 8px);
      }
      /* overlay: out of flow inside the host's own bounds — no portal, no
         collision detection, nothing to dismiss */
      .pretui-ha[data-space='overlay'] .pretui-ha-cluster {
        position: absolute;
        z-index: var(--pretui-z-raised, 1);
      }
      .pretui-ha[data-space='overlay'][data-placement='top-end'] .pretui-ha-cluster {
        inset-block-start: var(--pretui-hoveractions-inset, 6px);
        inset-inline-end: var(--pretui-hoveractions-inset, 6px);
      }
      .pretui-ha[data-space='overlay'][data-placement='top-start'] .pretui-ha-cluster {
        inset-block-start: var(--pretui-hoveractions-inset, 6px);
        inset-inline-start: var(--pretui-hoveractions-inset, 6px);
      }
      .pretui-ha[data-space='overlay'][data-placement='bottom-end'] .pretui-ha-cluster {
        inset-block-end: var(--pretui-hoveractions-inset, 6px);
        inset-inline-end: var(--pretui-hoveractions-inset, 6px);
      }
      .pretui-ha[data-space='overlay'][data-placement='bottom-start'] .pretui-ha-cluster {
        inset-block-end: var(--pretui-hoveractions-inset, 6px);
        inset-inline-start: var(--pretui-hoveractions-inset, 6px);
      }
      .pretui-ha-cluster {
        display: inline-flex;
        align-items: center;
        gap: var(--pretui-hoveractions-gap, 4px);
        opacity: 0;
        /* while hidden the cluster is transparent to the pointer, so a click
           aimed at the host can never land on a phantom button */
        pointer-events: none;
        transition: opacity var(--pretui-dur-snap, 160ms)
          var(--pretui-ease-snap, cubic-bezier(.3,.85,.3,1));
      }
      .pretui-ha:hover .pretui-ha-cluster,
      .pretui-ha:focus-within .pretui-ha-cluster,
      .pretui-ha[data-reveal='always'] .pretui-ha-cluster {
        opacity: 1;
        pointer-events: auto;
      }
      .pretui-ha-icon {
        width: 1.14em;
        height: 1.14em;
        flex: none;
      }
      /* three dots drawn rather than typed: '⋯' announces as a character and
         reads differently in every font */
      .pretui-ha-dots {
        width: 1.14em;
        height: 0.2em;
        background: radial-gradient(
          circle at 0.1em 50%,
          currentColor 0.1em,
          transparent 0.1em
        ),
        radial-gradient(circle at 0.57em 50%, currentColor 0.1em, transparent 0.1em),
        radial-gradient(circle at 1.04em 50%, currentColor 0.1em, transparent 0.1em);
      }
      .pretui-ha-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      /* Hover is not an input on a touchscreen: an affordance that only
         exists on hover simply does not exist there. */
      @media (any-pointer: coarse) {
        .pretui-ha-cluster {
          opacity: 1;
          pointer-events: auto;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-ha-cluster {
          transition: none;
        }
      }
    </style>
  </template>
}
