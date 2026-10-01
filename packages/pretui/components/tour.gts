// Pretui — Tour: an in-product walkthrough — one card per step, anchored to the real control it explains.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { Button } from './button';
import { listenDocumentCapture } from '../focus';
import { anchorTo } from '../internal/overlay';
import type { PopupPlacement } from '../internal/overlay';

export type TourPlacement = 'bottom' | 'top' | 'start' | 'end';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** A CSS selector for the control this step explains. Without it the card is centred. */
  target?: string;
  placement?: TourPlacement;
}

export interface TourSignature {
  Args: {
    steps: TourStep[];
    /** Controlled visibility. Omit for uncontrolled (starts closed unless @defaultOpen). */
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Controlled step index. Omit for uncontrolled. */
    index?: number;
    onIndexChange?: (index: number) => void;
    /** Fired by Done on the last step. */
    onFinish?: () => void;
    /** Fired by Skip, the close button or Escape. */
    onSkip?: () => void;
    /** Dim everything but the target and block pointer input to the rest of the page (default false). */
    modal?: boolean;
    /** Labels (defaults 'Back', 'Next', 'Done', 'Skip tour'). */
    backLabel?: string;
    nextLabel?: string;
    doneLabel?: string;
    skipLabel?: string;
  };
  Element: HTMLDivElement;
}

/**
 * Onboarding is a first-run scene; Tour is attached to the live UI: step N
 * of M, a ring around the real control, Back / Next / Done and Skip.
 *
 * The card is a non-modal `role="dialog"` labelled by the step title and
 * described by its body, so the page stays usable: Escape skips the tour
 * only when focus is in the card, and every other control keeps its own
 * Escape. `@modal` adds a scrim around the target that blocks the pointer
 * elsewhere (and takes Escape page-wide). Each step moves focus to its
 * primary button, and however the tour closes, focus returns to wherever it
 * was when it opened. The card is placed by the kit's `anchorTo`, which
 * flips and shifts to stay clear of the target; the target is scrolled into
 * view (nearest, never the whole page). The ring is decoration, ignores the
 * pointer and never covers the control — the step text carries the meaning
 * (Law 6).
 */
export class Tour extends Component<TourSignature> {
  private guid = guidFor(this);
  @tracked private internalOpen = this.args.defaultOpen ?? false;
  @tracked private internalIndex = 0;

  get open(): boolean {
    return (this.args.open ?? this.internalOpen) && this.count > 0;
  }
  get count(): number {
    return this.args.steps?.length ?? 0;
  }
  get index(): number {
    let raw = this.args.index ?? this.internalIndex;
    return Math.min(Math.max(0, raw), Math.max(0, this.count - 1));
  }
  get step(): TourStep | undefined {
    return this.args.steps?.[this.index];
  }
  get isFirst(): boolean {
    return this.index === 0;
  }
  get isLast(): boolean {
    return this.index >= this.count - 1;
  }
  get progress(): string {
    return `Step ${this.index + 1} of ${this.count}`;
  }
  get titleId(): string {
    return this.guid + '-title';
  }
  get bodyId(): string {
    return this.guid + '-body';
  }

  private setIndex(next: number) {
    if (this.args.index === undefined) {
      this.internalIndex = next;
    }
    this.args.onIndexChange?.(next);
  }
  private setOpen(next: boolean) {
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  }

  next = () => {
    if (this.isLast) {
      this.args.onFinish?.();
      this.setOpen(false);
      return;
    }
    this.setIndex(this.index + 1);
  };
  back = () => {
    if (!this.isFirst) {
      this.setIndex(this.index - 1);
    }
  };
  skip = () => {
    this.args.onSkip?.();
    this.setOpen(false);
  };
  onKey = (event: Event) => {
    let ev = event as KeyboardEvent;
    // non-modal: Escape belongs to whatever has focus unless that is the card
    let card = document.getElementById(this.cardId);
    let target = ev.target as Node | null;
    let inCard = Boolean(card && target && card.contains(target));
    if (ev.key === 'Escape' && this.open && (this.args.modal || inCard)) {
      ev.preventDefault();
      ev.stopPropagation();
      this.skip();
    }
  };

  /** Records where focus was on every open, and gives it back on every
   * close — Skip, Done, Escape or a controlled `@open={{false}}` alike. */
  remember = modifier((el: HTMLElement) => {
    let active = document.activeElement as HTMLElement | null;
    let back = active && active !== document.body ? active : null;
    let root = el.parentElement;
    return () => {
      let now = document.activeElement;
      if (back && (!now || now === document.body || (root && root.contains(now)))) {
        back.focus?.();
      }
    };
  });

  /** The step's target, or null when it has none or its selector is not valid. */
  get targetEl(): HTMLElement | null {
    let selector = this.step?.target;
    if (!selector) {
      return null;
    }
    try {
      return document.querySelector<HTMLElement>(selector);
    } catch {
      return null;
    }
  }
  get modal(): boolean {
    return this.args.modal ?? false;
  }
  /** anchorTo takes undefined, not null, for no anchor. */
  get anchorEl(): HTMLElement | undefined {
    return this.targetEl ?? undefined;
  }
  get anchored(): boolean {
    return this.targetEl !== null;
  }
  get cardId(): string {
    return this.guid + '-card';
  }
  /** anchorTo's physical placement for the step's logical one. */
  get popupPlacement(): PopupPlacement {
    let rtl = document.documentElement.dir === 'rtl';
    let p = this.placement;
    if (p === 'start') {
      return rtl ? 'right' : 'left';
    }
    if (p === 'end') {
      return rtl ? 'left' : 'right';
    }
    return p;
  }

  /** Draws the ring, and under @modal the scrim around the target, and follows the target. */
  outline = modifier((layer: HTMLElement, [target, modal]: [HTMLElement | null, boolean]) => {
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // a centred step must not keep the last anchored step's inline position
    let card = layer.querySelector<HTMLElement>('.pretui-tour-card');
    if (!target && card) {
      card.style.top = '';
      card.style.left = '';
    }
    let ring = layer.querySelector<HTMLElement>('.pretui-tour-ring');
    let scrims = Array.from(layer.querySelectorAll<HTMLElement>('.pretui-tour-scrim'));
    let update = () => {
      let rect = target?.getBoundingClientRect() ?? null;
      if (ring) {
        ring.style.display = rect ? '' : 'none';
        if (rect) {
          Object.assign(ring.style, {
            top: `${rect.top - 4}px`,
            left: `${rect.left - 4}px`,
            width: `${rect.width + 8}px`,
            height: `${rect.height + 8}px`,
          });
        }
      }
      if (!modal) {
        return;
      }
      // four real rects around the target: they catch the pointer, and the
      // target in the middle stays pressable
      let vw = document.documentElement.clientWidth;
      let vh = document.documentElement.clientHeight;
      let hole = rect ?? new DOMRect(vw / 2, vh / 2, 0, 0);
      let boxes = [
        { top: 0, left: 0, width: vw, height: Math.max(0, hole.top - 4) },
        { top: hole.bottom + 4, left: 0, width: vw, height: Math.max(0, vh - hole.bottom - 4) },
        { top: hole.top - 4, left: 0, width: Math.max(0, hole.left - 4), height: hole.height + 8 },
        { top: hole.top - 4, left: hole.right + 4, width: Math.max(0, vw - hole.right - 4), height: hole.height + 8 },
      ];
      scrims.forEach((scrim, i) => {
        let b = boxes[i] as { top: number; left: number; width: number; height: number };
        Object.assign(scrim.style, { top: `${b.top}px`, left: `${b.left}px`, width: `${b.width}px`, height: `${b.height}px` });
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  });

  /** Moves focus back to the primary button whenever the step changes. */
  refocus = modifier((button: HTMLElement, [index]: [number]) => {
    void index;
    button.focus();
  });

  get placement(): TourPlacement {
    let p = this.step?.placement;
    return p === 'top' || p === 'start' || p === 'end' ? p : 'bottom';
  }

  <template>
    {{#if this.open}}
      <div class='pretui-tour' data-modal={{if @modal 'true' 'false'}} data-test-pretui-tour {{this.outline this.targetEl this.modal}} ...attributes>
        {{#if @modal}}
          <div class='pretui-tour-scrim' aria-hidden='true' data-test-pretui-tour-scrim></div>
          <div class='pretui-tour-scrim' aria-hidden='true'></div>
          <div class='pretui-tour-scrim' aria-hidden='true'></div>
          <div class='pretui-tour-scrim' aria-hidden='true'></div>
        {{/if}}
        <div class='pretui-tour-ring' aria-hidden='true' data-test-pretui-tour-ring></div>
        <span class='pretui-tour-watch' {{listenDocumentCapture 'keydown' this.onKey}} {{this.remember}}></span>
        <div
          id={{this.cardId}}
          class='pretui-tour-card'
          role='dialog'
          aria-labelledby={{this.titleId}}
          aria-describedby={{this.bodyId}}
          data-anchored={{if this.anchored 'true' 'false'}}
          data-test-pretui-tour-card
          {{anchorTo this.anchorEl this.popupPlacement 10 false}}
        >
          <div class='pretui-tour-head'>
            <span class='pretui-tour-progress' data-test-pretui-tour-progress>{{this.progress}}</span>
            <button
              type='button'
              class='pretui-tour-close'
              aria-label={{if @skipLabel @skipLabel 'Skip tour'}}
              data-test-pretui-tour-close
              {{on 'click' this.skip}}
            >
              <svg width='10' height='10' viewBox='0 0 12 12' aria-hidden='true'><path
                  d='M2 2l8 8M10 2l-8 8'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.6'
                  stroke-linecap='round'
                /></svg>
            </button>
          </div>
          <h2 id={{this.titleId}} class='pretui-tour-title' data-test-pretui-tour-title>{{this.step.title}}</h2>
          <p id={{this.bodyId}} class='pretui-tour-body' data-test-pretui-tour-body>{{this.step.body}}</p>
          <div class='pretui-tour-actions'>
            <button type='button' class='pretui-tour-skip' data-test-pretui-tour-skip {{on 'click' this.skip}}>{{if @skipLabel @skipLabel 'Skip tour'}}</button>
            <span class='pretui-tour-nav'>
              {{#unless this.isFirst}}
                <Button @appearance='outlined' @size='s' data-test-pretui-tour-back {{on 'click' this.back}}>{{if @backLabel @backLabel 'Back'}}</Button>
              {{/unless}}
              <Button
                @appearance='accent'
                @size='s'
                data-test-pretui-tour-next
                {{this.refocus this.index}}
                {{on 'click' this.next}}
              >{{#if this.isLast}}{{if @doneLabel @doneLabel 'Done'}}{{else}}{{if @nextLabel @nextLabel 'Next'}}{{/if}}</Button>
            </span>
          </div>
        </div>
      </div>
    {{/if}}
    <style scoped>
      .pretui-tour-ring {
        position: fixed;
        z-index: var(--pretui-z-overlay, 70);
        border-radius: var(--radius-control, 6px);
        box-shadow: 0 0 0 2px var(--pretui-tour-ring, var(--primary));
        pointer-events: none;
        transition: top var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out),
          left var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out),
          width var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out),
          height var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out);
      }
      .pretui-tour-scrim {
        position: fixed;
        z-index: var(--pretui-z-overlay, 70);
        background: var(--pretui-overlay-scrim, rgb(0 0 0 / 0.45));
      }
      .pretui-tour-card[data-anchored='false'] {
        inset-block-start: 50%;
        inset-inline-start: 50%;
        translate: -50% -50%;
      }
      .pretui-tour-card {
        position: fixed;
        z-index: var(--pretui-z-overlay, 70);
        box-sizing: border-box;
        inline-size: min(20rem, calc(100vw - 16px));
        padding: var(--space-4, 0.6875rem);
        border-radius: var(--radius-surface, 10px);
        background: var(--popover);
        color: var(--popover-foreground);
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 12px 32px rgb(16 24 40 / 0.18));
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 0.78rem);
      }
      .pretui-tour-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .pretui-tour-progress {
        color: var(--muted-foreground);
        font-size: var(--text-ui-xs, 0.66rem);
        font-variant-numeric: tabular-nums;
        letter-spacing: var(--track-eyebrow, 0.04em);
        text-transform: uppercase;
      }
      .pretui-tour-close {
        display: grid;
        place-items: center;
        inline-size: 1.5rem;
        block-size: 1.5rem;
        border: 0;
        border-radius: var(--radius-control, 6px);
        background: transparent;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-tour-close:hover {
        color: var(--foreground);
        background: var(--hover, color-mix(in oklch, currentColor 10%, transparent));
      }
      .pretui-tour-title {
        margin: var(--space-2, 0.375rem) 0 0;
        font-family: var(--font-serif);
        font-size: var(--text-heading, 1.1875rem);
        font-weight: var(--weight-heading, 500);
      }
      .pretui-tour-body {
        margin: var(--space-2, 0.375rem) 0 0;
        color: var(--muted-foreground);
        line-height: var(--leading-body, 1.5);
      }
      .pretui-tour-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2, 0.375rem);
        margin-block-start: var(--space-4, 0.6875rem);
      }
      .pretui-tour-nav {
        display: flex;
        gap: var(--space-2, 0.375rem);
      }
      .pretui-tour-skip {
        padding: 0.25rem;
        border: 0;
        background: transparent;
        color: var(--muted-foreground);
        font: inherit;
        text-decoration: underline;
        text-underline-offset: 0.18em;
        cursor: pointer;
      }
      .pretui-tour-close:focus-visible,
      .pretui-tour-skip:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-tour-watch {
        display: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-tour-ring {
          transition: none;
        }
      }
    </style>
  </template>
}
