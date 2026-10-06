// Pretui — FloatButton: a corner-anchored action, optionally a speed dial of actions.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { Button } from './button';
import { listenDocument, listenDocumentCapture } from '../focus';
import type { PretuiToneArg } from '../pretui-primitives';

export type FloatButtonPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

const PLACEMENTS: readonly FloatButtonPlacement[] = ['bottom-end', 'bottom-start', 'top-end', 'top-start'];

// The React spellings are physical; the house enum is logical, so RTL flips
// the corner for free.
const PLACEMENT_ALIASES: Record<string, FloatButtonPlacement> = {
  'bottom-right': 'bottom-end',
  'bottom-left': 'bottom-start',
  'top-right': 'top-end',
  'top-left': 'top-start',
};

export interface FloatButtonAction {
  id: string;
  label: string;
  onSelect?: () => void;
}

export interface FloatButtonSignature {
  Args: {
    /** The accessible name, and the visible text when `@extended`. */
    label: string;
    /** Show the label beside the icon (MUI's `variant="extended"`). */
    extended?: boolean;
    /** Default 'primary'. Accepts the kit's tone spellings. */
    tone?: PretuiToneArg;
    /** Which corner of the positioned container (default 'bottom-end'). The React physical spellings map. */
    placement?: FloatButtonPlacement | string;
    /** `absolute` (default) anchors to the nearest positioned ancestor; `fixed` to the viewport. */
    position?: 'absolute' | 'fixed';
    size?: 's' | 'm' | 'l';
    /** Fired by the button when there are no `@actions`. */
    onAction?: () => void;
    /** Turns the button into a speed dial: it opens this list instead of acting. */
    actions?: FloatButtonAction[];
    /** Controlled dial state; omit for uncontrolled. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };
  Blocks: {
    /** The button's icon. Defaults to a plus. */
    default: [];
    /** The icon for one dial action. Without it each action shows its label only. */
    actionIcon: [FloatButtonAction];
  };
  Element: HTMLDivElement;
}

/**
 * The primary action of a long pane — Compose, Back to top, Help — pinned to
 * a corner of the pane rather than the viewport, so it scrolls with nothing
 * and overlaps nothing outside the pane it belongs to.
 *
 * With `@actions` it is a speed dial built on the disclosure pattern: the
 * button is `aria-expanded` and controls a group of labelled buttons. It
 * opens on click, never on hover alone, and never takes focus on its own.
 * Escape, an outside click or choosing an action closes it and returns focus
 * to the button.
 */
export class FloatButton extends Component<FloatButtonSignature> {
  private guid = guidFor(this);
  @tracked private internalOpen = false;

  get dialId(): string {
    return this.guid + '-dial';
  }
  get hasDial(): boolean {
    return (this.args.actions?.length ?? 0) > 0;
  }
  get isOpen(): boolean {
    return this.hasDial && (this.args.open ?? this.internalOpen);
  }
  get placement(): FloatButtonPlacement {
    let raw = this.args.placement ?? 'bottom-end';
    let canonical = PLACEMENT_ALIASES[raw] ?? raw;
    return (PLACEMENTS as readonly string[]).includes(canonical) ? (canonical as FloatButtonPlacement) : 'bottom-end';
  }
  get opensUp(): boolean {
    return this.placement.startsWith('bottom');
  }
  get tone(): PretuiToneArg {
    return this.args.tone ?? 'primary';
  }
  get size(): 's' | 'm' | 'l' {
    return this.args.size ?? 'm';
  }

  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  /** The main button, looked up from the root: the dial may have been
   * opened through a controlled @open without it ever being clicked. */
  private closeAndReturn() {
    this.setOpen(false);
    this.rootEl?.querySelector<HTMLElement>('.pretui-float-main')?.focus();
  }

  onMain = () => {
    if (this.hasDial) {
      this.setOpen(!this.isOpen);
    } else {
      this.args.onAction?.();
    }
  };

  select = (action: FloatButtonAction) => {
    action.onSelect?.();
    this.closeAndReturn();
  };

  onKey = (event: Event) => {
    let ev = event as KeyboardEvent;
    // only an Escape from inside the dial; another widget's Escape is its own
    let target = ev.target as Node | null;
    if (ev.key !== 'Escape' || !this.isOpen || !target || !this.rootEl?.contains(target)) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.closeAndReturn();
  };

  onOutside = (event: Event) => {
    if (!this.isOpen) {
      return;
    }
    let target = event.target as Node | null;
    let root = this.rootEl;
    if (root && target && root.contains(target)) {
      return;
    }
    this.setOpen(false);
  };

  /** The root element, held by reference: a caller's `id` may replace ours. */
  private rootEl: HTMLElement | null = null;
  captureRoot = modifier((el: HTMLElement) => {
    this.rootEl = el;
    return () => {
      this.rootEl = null;
    };
  });

  <template>
    <div
      class='pretui-float'
      data-placement={{this.placement}}
      data-position={{if @position @position 'absolute'}}
      data-open={{if this.isOpen 'true' 'false'}}
      data-opens={{if this.opensUp 'up' 'down'}}
      data-test-pretui-float-button
      {{this.captureRoot}}
      ...attributes
    >
      {{#if this.isOpen}}
        <span class='pretui-float-watch' {{listenDocumentCapture 'keydown' this.onKey}} {{listenDocument 'pointerdown' this.onOutside true}}></span>
      {{/if}}
      {{#if this.hasDial}}
        <ul class='pretui-float-dial' id={{this.dialId}} hidden={{if this.isOpen false true}} data-test-pretui-float-dial>
          {{#each @actions key='id' as |entry|}}
            <li class='pretui-float-dial-item'>
              <button
                type='button'
                class='pretui-float-dial-btn'
                data-test-pretui-float-action={{entry.id}}
                {{on 'click' (fn this.select entry)}}
              >
                {{#if (has-block 'actionIcon')}}
                  <span class='pretui-float-dial-icon' aria-hidden='true'>{{yield entry to='actionIcon'}}</span>
                {{/if}}
                <span class='pretui-float-dial-label'>{{entry.label}}</span>
              </button>
            </li>
          {{/each}}
        </ul>
      {{/if}}
      <Button
        @tone={{this.tone}}
        @appearance='accent'
        @size={{this.size}}
        class='pretui-float-main'
        data-extended={{if @extended 'true' 'false'}}
        aria-label={{unless @extended @label}}
        aria-expanded={{if this.hasDial (if this.isOpen 'true' 'false')}}
        aria-controls={{if this.hasDial this.dialId}}
        data-test-pretui-float-main
        {{on 'click' this.onMain}}
      >
        <span class='pretui-float-icon' aria-hidden='true'>
          {{#if (has-block)}}
            {{yield}}
          {{else}}
            <svg width='14' height='14' viewBox='0 0 14 14'><path
                d='M7 2v10M2 7h10'
                fill='none'
                stroke='currentColor'
                stroke-width='1.8'
                stroke-linecap='round'
              /></svg>
          {{/if}}
        </span>
        {{#if @extended}}<span class='pretui-float-text'>{{@label}}</span>{{/if}}
      </Button>
    </div>
    <style scoped>
      /* above Button's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-float {
          position: absolute;
          z-index: var(--pretui-float-z, 20);
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--space-3, 0.5rem);
          margin: var(--pretui-float-offset, var(--space-6, 1.25rem));
        }
        .pretui-float[data-position='fixed'] {
          position: fixed;
        }
        .pretui-float[data-placement^='bottom'] {
          inset-block-end: 0;
        }
        .pretui-float[data-placement^='top'] {
          inset-block-start: 0;
          flex-direction: column-reverse;
        }
        .pretui-float[data-placement='bottom-end'],
        .pretui-float[data-placement='top-end'] {
          inset-inline-end: 0;
        }
        .pretui-float[data-placement='bottom-start'],
        .pretui-float[data-placement='top-start'] {
          inset-inline-start: 0;
          align-items: flex-start;
        }
        .pretui-float-main {
          border-radius: 999px;
          box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.16));
          min-inline-size: var(--pretui-float-size, 3rem);
          min-block-size: var(--pretui-float-size, 3rem);
          padding: 0;
          gap: var(--space-2, 0.375rem);
        }
        .pretui-float-main[data-extended='true'] {
          padding-inline: var(--space-5, 1rem);
        }
        .pretui-float-icon {
          display: grid;
          place-items: center;
          transition: rotate var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out);
        }
        .pretui-float[data-open='true'] .pretui-float-icon {
          rotate: 45deg;
        }
        .pretui-float-text {
          font-weight: 600;
        }
        .pretui-float-dial {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          align-items: inherit;
          gap: var(--space-2, 0.375rem);
        }
        .pretui-float-dial[hidden] {
          display: none;
        }
        .pretui-float-dial-item {
          animation: pretui-float-in var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out) both;
        }
        .pretui-float-dial-btn {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2, 0.375rem);
          min-block-size: 2.25rem;
          padding-inline: var(--space-3, 0.5rem) var(--space-4, 0.6875rem);
          border: 0;
          border-radius: 999px;
          background: var(--popover);
          color: var(--popover-foreground);
          box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 4px 14px rgb(16 24 40 / 0.12));
          font: inherit;
          font-size: var(--text-ui-md, 0.78rem);
          cursor: pointer;
        }
        .pretui-float-dial-btn:hover {
          background: color-mix(in oklch, var(--popover) 88%, var(--foreground));
        }
        .pretui-float-dial-btn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-float-dial-icon {
          display: grid;
          place-items: center;
          color: var(--muted-foreground);
        }
        .pretui-float-watch {
          display: none;
        }
        @keyframes pretui-float-in {
          from {
            opacity: 0;
            translate: 0 0.375rem;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-float-dial-item {
            animation: none;
          }
          .pretui-float-icon {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
