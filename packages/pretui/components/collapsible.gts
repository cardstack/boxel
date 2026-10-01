// Pretui — Collapsible: a single disclosure panel with an animated reveal.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import type { PretuiSize } from '../pretui-primitives';
import { pretuiSize } from '../internal/structure-layout';
import type { SizeAlias } from '../internal/structure-layout';

// ── Collapsible ──────────────────────────────────────────────────────────
//
// Sources read: radix-primitives/packages/react/collapsible, shadcn
// collapsible.tsx, chakra collapsible.
//
// The single disclosure. `Accordion` (structure-extras.gts) is the multi-panel
// set and `Fold` (agentic.gts) is the receipt-shaped one; this is the plain
// "one trigger, one region" primitive, which is what an agent typing
// `<Collapsible>` means.
//
// What is fixed relative to Radix:
//
//   1. **No measurement.** Radix publishes
//      `--radix-collapsible-content-height` by *mutating the element's own*
//      `style.transitionDuration` and `style.animationName` to `0s`/`none`,
//      reading `getBoundingClientRect()`, and restoring the originals from a
//      ref that is captured once and never refreshed
//      (`originalStylesRef.current = originalStylesRef.current || {…}`). The
//      published value is a pixel count, so it is stale the moment the
//      content reflows. This uses the kit's expand grammar
//      (`grid-template-rows: 0fr → 1fr`, Appendix O.1 rule 1, reference
//      implementation at `controls-choice.gts:751-763`): the browser animates
//      the real height with no JS at all, and content that grows
//      mid-transition just works. Never `max-height`, never `scrollHeight`.
//   2. **Neither of Radix's two content modes is right.** The default path
//      renders `{isOpen && children}`, so every open REMOUNTS the content —
//      uncontrolled inputs reset, scroll position is lost, a playing video
//      restarts. The `forceMount` path, which is the one you need for any
//      animation at all, then leaves focusable content reachable behind a
//      clipped box. Here the content stays mounted and `visibility: hidden`
//      takes it out of both the tab order and the accessibility tree,
//      transitioned with a `0s linear <duration>` step so it only flips at
//      the end of the collapse. State survives; focus does not leak.
//   3. **`disabled` is the native attribute upstream.** A disabled trigger
//      that leaves the tab order is a control that vanishes; `aria-disabled`
//      keeps it focusable and announced, and the handler is the gate.
//   4. **There is no indicator slot.** The near-universal rotating chevron
//      has to be hand-built off `data-state` in every Radix and shadcn
//      consumer. It is built in here and `@hideCaret` turns it off.
//   5. **State attributes disagree with themselves upstream** —
//      `data-state="open"|"closed"` is a string but `data-disabled=""` is a
//      bare presence attribute, so consumers write two selector idioms for
//      one component. Everything here reflects `'true'`/`'false'`.
//   6. **Reduced motion lands on the END state**, not a frozen midpoint.
//      Not one of Radix, shadcn or the shadcn registry ships a
//      `prefers-reduced-motion` guard for this component.

export interface CollapsibleSignature {
  Args: {
    /** Controlled open state. Leave undefined for the uncontrolled half. */
    open?: boolean;
    /** Uncontrolled initial state. Default `false`. */
    defaultOpen?: boolean;
    /** Fires on every toggle, controlled or not. */
    onOpenChange?: (open: boolean) => void;
    /** Trigger label. Sugar for `<:trigger>`; the block wins. */
    label?: string;
    /** Announced and styled as disabled; stays focusable (`aria-disabled`). */
    disabled?: boolean;
    /** Appendix E size. */
    size?: SizeAlias;
    /** Hide the rotating caret — for a trigger that is its own affordance. */
    hideCaret?: boolean;
  };
  Blocks: {
    /** The trigger's contents. Yielded the current open state. */
    trigger: [boolean];
    /** The disclosed region. */
    default: [];
  };
  Element: HTMLDivElement;
}

/**
 * One trigger, one disclosed region.
 *
 * ```hbs
 * <Collapsible @label='Advanced' @defaultOpen={{false}}>
 *   <FormRow …/>
 * </Collapsible>
 * ```
 */
export class Collapsible extends Component<CollapsibleSignature> {
  @tracked private internal = this.args.defaultOpen ?? false;
  private contentId = `${guidFor(this)}-content`;
  private triggerId = `${guidFor(this)}-trigger`;

  get open(): boolean {
    return this.args.open ?? this.internal;
  }
  get size(): PretuiSize {
    return pretuiSize(this.args.size);
  }
  get state(): string {
    return this.open ? 'open' : 'closed';
  }
  toggle = () => {
    if (this.args.disabled) {
      return;
    }
    let next = !this.open;
    // Internal state moves only while UNcontrolled; the callback always fires.
    if (this.args.open === undefined) {
      this.internal = next;
    }
    this.args.onOpenChange?.(next);
  };

  <template>
    <div
      class='pretui-collapsible'
      data-state={{this.state}}
      data-size={{this.size}}
      data-disabled={{if @disabled 'true' 'false'}}
      data-test-pretui-collapsible
      ...attributes
    >
      <button
        type='button'
        id={{this.triggerId}}
        class='pretui-collapsible-trigger'
        aria-expanded={{if this.open 'true' 'false'}}
        {{! Radix only emits aria-controls while OPEN, because its content
            carries the `hidden` attribute when closed and pointing
            aria-controls at a hidden id is an axe violation. This content is
            never `hidden` — it is a visibility-collapsed region that always
            exists — so the reference is always valid and always present,
            which is what lets a reader jump to the region before opening it. }}
        aria-controls={{this.contentId}}
        aria-disabled={{if @disabled 'true'}}
        data-state={{this.state}}
        data-test-pretui-collapsible-trigger
        {{on 'click' this.toggle}}
      >
        {{#unless @hideCaret}}
          <span class='pretui-collapsible-caret' aria-hidden='true'></span>
        {{/unless}}
        <span class='pretui-collapsible-label'>
          {{#if (has-block 'trigger')}}
            {{yield this.open to='trigger'}}
          {{else}}
            {{@label}}
          {{/if}}
        </span>
      </button>

      {{! The kit's expand grammar: 0fr → 1fr animates the real height with no
          measurement and no max-height guess. `visibility` rides along on a
          delayed 0s step so a closed region is out of the tab order and out of
          the accessibility tree, not merely clipped. }}
      <div
        id={{this.contentId}}
        class='pretui-collapsible-fold'
        role='region'
        aria-labelledby={{this.triggerId}}
        data-state={{this.state}}
        data-test-pretui-collapsible-content
      >
        <div class='pretui-collapsible-inner'>{{yield}}</div>
      </div>
    </div>

    <style scoped>
      .pretui-collapsible {
        display: grid;
        min-inline-size: 0;
        font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
      }
      .pretui-collapsible[data-size='xs'] {
        font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
      }
      .pretui-collapsible[data-size='s'] {
        font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
      }
      .pretui-collapsible[data-size='l'] {
        font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
      }
      .pretui-collapsible[data-size='xl'] {
        font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
      }
      .pretui-collapsible-trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.5em;
        justify-self: start;
        min-block-size: var(--pretui-collapsible-h, 2.24em);
        padding: 0 var(--pretui-collapsible-px, 0.5em);
        margin-inline-start: calc(var(--pretui-collapsible-px, 0.5em) * -1);
        border: 0;
        border-radius: var(--radius-chip, 6px);
        background: none;
        color: inherit;
        font: inherit;
        letter-spacing: inherit;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
        min-inline-size: 0;
      }
      .pretui-collapsible-trigger:hover {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-collapsible-trigger:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-collapsible-trigger:active {
        transform: scale(0.985);
      }
      .pretui-collapsible[data-disabled='true'] .pretui-collapsible-trigger {
        opacity: 0.45;
        cursor: default;
      }
      .pretui-collapsible[data-disabled='true'] .pretui-collapsible-trigger:hover {
        background: none;
      }
      .pretui-collapsible-label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-collapsible-caret {
        flex: none;
        inline-size: 0.45em;
        block-size: 0.45em;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        transform: rotate(-45deg) translate(-0.1em, -0.1em);
        color: var(--muted-foreground);
        transition: transform var(--pretui-dur-snap, 180ms)
          var(--pretui-ease-snap, ease);
      }
      .pretui-collapsible-trigger[data-state='open'] .pretui-collapsible-caret {
        transform: rotate(45deg) translate(-0.05em, -0.15em);
      }
      .pretui-collapsible-fold {
        display: grid;
        grid-template-rows: 0fr;
        visibility: hidden;
        transition: grid-template-rows var(--pretui-dur-morph, 300ms)
            var(--pretui-ease-morph, cubic-bezier(0.3, 0.7, 0.2, 1.02)),
          visibility 0s linear var(--pretui-dur-morph, 300ms);
      }
      .pretui-collapsible-fold[data-state='open'] {
        grid-template-rows: 1fr;
        visibility: visible;
        transition: grid-template-rows var(--pretui-dur-morph, 300ms)
            var(--pretui-ease-morph, cubic-bezier(0.3, 0.7, 0.2, 1.02)),
          visibility 0s;
      }
      .pretui-collapsible-inner {
        min-block-size: 0;
        min-inline-size: 0;
        overflow: hidden;
      }
      /* Reduced motion lands on the END state — open is open, closed is
         closed, never a frozen midpoint of the row track. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-collapsible-fold,
        .pretui-collapsible-fold[data-state='open'],
        .pretui-collapsible-caret {
          transition: none;
        }
        .pretui-collapsible-trigger:active {
          transform: none;
        }
      }
    </style>
  </template>
}
