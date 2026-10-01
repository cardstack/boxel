// Pretui — ActionBar: the bar that appears when a selection exists, carrying the actions that apply to it.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { Button } from './button';
import { IconButton } from './icon-button';
import type { PretuiTone } from '../pretui-primitives';
import { Menu } from './menu';
import type { MenuEntry } from '../internal/menu';
import { destructiveLast } from '../internal/menu';
import { listen } from '../focus';
import { iconFor } from '../icon-registry';

// ── ActionBar: composed, not rebuilt (react-spectrum ActionBar) ─────────
//
// Every control in the bar is an existing kit component — `Button`,
// `IconButton`, `Menu`. What the bar adds is the three things upstream
// leaves to the caller: the selection count as a sentence, an overflow
// threshold so a bar with nine actions does not become a scrollbar, and the
// APG toolbar keyboard contract (one tab stop, arrows within, Home/End).
//
// It deliberately does NOT compose `structure.gts`'s `Toolbar`: that is a
// page-header band whose title slot renders an `<h2>`, and "3 records
// selected" is not a heading. Sharing the element would mean lying in the
// document outline to save a flexbox rule.
//
// Realm-law notes: no timers, no `Date.now`, no `Math.random`. All listeners
// live in `ember-modifier`s that remove them on teardown. The bar's entrance
// is CSS (`@starting-style`), and under `prefers-reduced-motion` it lands on
// the END state — the bar is simply there.

// ═══════════════════════════════════════════════════════════════════════
// ActionBar
// ═══════════════════════════════════════════════════════════════════════

/** One action offered against the current selection. */
export interface ActionBarAction {
  /** stable id, handed back to `onAction` */
  id: string;
  label: string;
  /** icon-registry name; drawn only in the overflow menu, where there is
   * room for a leading column */
  icon?: string;
  /** treatment axis for the inline button */
  tone?: PretuiTone;
  /** dimmed but still focusable and announced — an action that disappears
   * when unavailable changes the bar's shape between selections, so the bar
   * can never be learned */
  disabled?: boolean;
  /** tinted destructive, and sorted to the end of the overflow menu */
  destructive?: boolean;
  onAction?: (id: string) => void;
}

/**
 * The bar's sentence. Pure, so the pluralisation is checkable without a
 * browser — and so a caller who wants the same words somewhere else has
 * them.
 */
export function selectionSummary(
  count: number,
  noun = 'item',
  total?: number,
): string {
  let safe = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  let word = safe === 1 ? noun : noun + 's';
  let head = safe + ' ' + word + ' selected';
  if (total !== undefined && Number.isFinite(total) && total > 0) {
    return head + ' of ' + Math.trunc(total);
  }
  return head;
}

/**
 * The APG toolbar keyboard contract, applied to whatever is inside.
 *
 * One tab stop for the whole bar, arrows between the controls, Home/End to
 * the ends. Written as a modifier over `[data-actionbar-item]` rather than
 * as per-button tracked state because the bar's contents are data-driven and
 * partly rendered by `Menu`: the DOM is the only place that knows the final
 * order of the controls.
 *
 * The tab stop is re-seated whenever the bar's controls change — a new
 * action, a removed one, a yielded control — by a MutationObserver, so the
 * bar never ends up with two tab stops or none.
 */
const rovingToolbar = modifier((el: HTMLElement) => {
  let members = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-actionbar-item]'));

  let seat = (active: number) => {
    let list = members();
    for (let index = 0; index < list.length; index++) {
      (list[index] as HTMLElement).tabIndex = index === active ? 0 : -1;
    }
  };
  seat(0);

  let onKeydown = (event: Event) => {
    let key = (event as KeyboardEvent).key;
    let list = members();
    if (list.length === 0) {
      return;
    }
    let current = list.indexOf(document.activeElement as HTMLElement);
    if (current === -1) {
      return;
    }
    let next = current;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      next = (current + 1) % list.length;
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      next = (current - 1 + list.length) % list.length;
    } else if (key === 'Home') {
      next = 0;
    } else if (key === 'End') {
      next = list.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    seat(next);
    (list[next] as HTMLElement).focus();
  };

  // Clicking a control makes it the tab stop, so Tab-out-and-back returns to
  // the control the reader last used rather than to the first one.
  let onFocusin = (event: Event) => {
    let list = members();
    let index = list.indexOf(event.target as HTMLElement);
    if (index !== -1) {
      seat(index);
    }
  };

  // keep the reader's stop if it survived the change, otherwise the first
  let reseat = () => {
    let list = members();
    let kept = list.findIndex((member) => member.tabIndex === 0);
    seat(kept === -1 ? 0 : kept);
  };
  let observer = new MutationObserver(reseat);
  observer.observe(el, { childList: true, subtree: true });

  el.addEventListener('keydown', onKeydown);
  el.addEventListener('focusin', onFocusin);
  return () => {
    observer.disconnect();
    el.removeEventListener('keydown', onKeydown);
    el.removeEventListener('focusin', onFocusin);
  };
});

export interface ActionBarSignature {
  Args: {
    /** how many things are selected. Zero hides the bar entirely. */
    count: number;
    /** the collection's size, for "3 of 40 selected" */
    total?: number;
    /** singular noun; pluralised by adding an s (default 'item') */
    noun?: string;
    /** the actions offered against the selection */
    actions?: readonly ActionBarAction[];
    /** how many actions get their own button before the rest collapse into
     * an overflow Menu (default 3) */
    maxVisible?: number;
    /** the overflow trigger's accessible name (default 'More actions') */
    overflowLabel?: string;
    /** the bar's accessible name (default 'Selection actions') */
    label?: string;
    /** the clear button's accessible name (default 'Clear selection') */
    clearLabel?: string;
    /** called by the clear button and by Escape inside the bar. Omit it and
     * no clear button is drawn. */
    onClear?: () => void;
    /** pin the bar to the bottom of its containing block (default) or let
     * it sit in normal flow */
    position?: 'floating' | 'inline';
    onAction?: (id: string) => void;
  };
  Blocks: {
    /** extra controls, appended after the actions and before clear. Add
     * `data-actionbar-item` to anything focusable so it joins the arrow-key
     * rotation. */
    default: [];
  };
  Element: HTMLDivElement;
}

export class ActionBar extends Component<ActionBarSignature> {
  get visible(): boolean {
    let count = this.args.count;
    return Number.isFinite(count) && count > 0;
  }
  get summary(): string {
    return selectionSummary(
      this.args.count,
      this.args.noun ?? 'item',
      this.args.total,
    );
  }
  get barLabel(): string {
    return this.args.label ?? 'Selection actions';
  }
  get clearLabel(): string {
    return this.args.clearLabel ?? 'Clear selection';
  }
  get overflowLabel(): string {
    return this.args.overflowLabel ?? 'More actions';
  }
  get allActions(): readonly ActionBarAction[] {
    return this.args.actions ?? [];
  }
  get limit(): number {
    let asked = this.args.maxVisible;
    if (asked === undefined || !Number.isFinite(asked) || asked < 0) {
      return 3;
    }
    return Math.trunc(asked);
  }
  /** With exactly one action over the limit, promoting it costs nothing and
   * saves the reader a menu — an overflow menu holding a single item is a
   * worse outcome than one more button. */
  private get split(): number {
    let all = this.allActions.length;
    return all === this.limit + 1 ? all : this.limit;
  }
  get inlineActions(): ActionBarAction[] {
    return this.allActions.slice(0, this.split);
  }
  get overflowActions(): ActionBarAction[] {
    return this.allActions.slice(this.split);
  }
  get hasOverflow(): boolean {
    return this.overflowActions.length > 0;
  }
  get overflowItems(): MenuEntry[] {
    return destructiveLast(
      this.overflowActions.map((action) => ({
        label: action.label,
        icon: action.icon,
        disabled: action.disabled,
        destructive: action.destructive,
        onSelect: () => this.run(action),
      })),
    );
  }

  private run(action: ActionBarAction) {
    if (action.disabled) {
      return;
    }
    action.onAction?.(action.id);
    this.args.onAction?.(action.id);
  }

  onActionClick = (event: Event) => {
    let el = event.currentTarget as HTMLElement | null;
    let id = el?.getAttribute('data-action-id');
    let action = this.allActions.find((candidate) => candidate.id === id);
    if (action) {
      this.run(action);
    }
  };

  clear = () => {
    this.args.onClear?.();
  };

  /** Escape clears, but only while focus is inside the bar. A document-level
   * Escape would fight every other surface on the page for the key — and the
   * collection the bar describes is outside this component, so it cannot
   * honestly claim the key on the collection's behalf. */
  onKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape' && this.args.onClear) {
      event.preventDefault();
      this.clear();
    }
  };

  <template>
    {{#if this.visible}}
      <div
        class='pretui-actionbar'
        role='toolbar'
        aria-label={{this.barLabel}}
        data-position={{if @position @position 'floating'}}
        data-test-pretui-action-bar
        {{rovingToolbar}}
        {{listen 'keydown' this.onKeydown}}
        ...attributes
      >
        <span class='pretui-actionbar-count' data-test-pretui-action-bar-count>
          {{this.summary}}
        </span>
        <span class='pretui-actionbar-actions'>
          {{#each this.inlineActions key='id' as |deed|}}
            <Button
              @tone={{if deed.destructive 'danger' deed.tone}}
              @appearance='outlined'
              @size='s'
              data-actionbar-item
              data-action-id={{deed.id}}
              data-test-pretui-action-bar-action
              aria-disabled={{if deed.disabled 'true'}}
              {{on 'click' this.onActionClick}}
            >{{deed.label}}</Button>
          {{/each}}
          {{yield}}
          {{#if this.hasOverflow}}
            <Menu @items={{this.overflowItems}} @label={{this.overflowLabel}} @align='end'>
              <:trigger as |isOpen toggle|>
                <IconButton
                  @label={{this.overflowLabel}}
                  data-actionbar-item
                  data-open={{if isOpen 'true'}}
                  {{on 'click' toggle}}
                >
                  {{#let (iconFor 'ellipsis') as |More|}}
                    {{#if More}}<More />{{/if}}
                  {{/let}}
                </IconButton>
              </:trigger>
            </Menu>
          {{/if}}
        </span>
        {{#if @onClear}}
          <IconButton
            @label={{this.clearLabel}}
            data-actionbar-item
            data-test-pretui-action-bar-clear
            {{on 'click' this.clear}}
          >
            {{#let (iconFor 'circle-minus') as |ClearIcon|}}
              {{#if ClearIcon}}<ClearIcon />{{/if}}
            {{/let}}
          </IconButton>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      .pretui-actionbar {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-surface, 12px);
        background: var(--popover);
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 8px 28px rgb(0 0 0 / 0.34)
        );
        /* Law 5: the bar arriving IS the state transition — the selection
           just became actionable. The slide is short and it travels from the
           edge it is pinned to, so it also says WHERE the bar lives. */
        transition:
          opacity var(--pretui-actionbar-enter, 140ms) ease,
          translate var(--pretui-actionbar-enter, 140ms) ease;
      }
      @starting-style {
        .pretui-actionbar {
          opacity: 0;
          translate: 0 8px;
        }
      }
      .pretui-actionbar[data-position='floating'] {
        position: sticky;
        bottom: var(--space-4, 11px);
        z-index: var(--pretui-z-sticky, 10);
      }
      .pretui-actionbar-count {
        flex: none;
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: var(--weight-medium, 500);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .pretui-actionbar-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        flex: 1;
        min-width: 0;
        flex-wrap: wrap;
      }
      /* Reduced motion lands on the END state — the bar is simply there,
         at full opacity and in place. Never a frozen midpoint. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-actionbar {
          transition: none;
        }
      }
      /* A card does not know the viewport; it knows its pane. Below the
         count and the actions stop competing for one line. */
      @container (max-width: 380px) {
        .pretui-actionbar {
          flex-wrap: wrap;
          gap: var(--space-2, 6px);
        }
      }
    </style>
  </template>
}
