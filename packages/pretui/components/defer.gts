// Pretui — Defer: renders its content only when it becomes visible, idle or intended.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { inViewport } from './in-view';
import { Skeleton } from './skeleton';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

// ═════════════════════════════════════════════════════════════════════════
// Defer
// ═════════════════════════════════════════════════════════════════════════
//
// From `catalog-app/components/card-with-hydration.gts`.
//
// Better than the inspiration:
//
//  1. **The guard actually guards.** The upstream wrote
//     `new Boolean(this.hydratedCardId)` — a Boolean *object*, which is
//     truthy even wrapping `undefined`, so the condition it looks like was
//     never once false. Here the gate is one tracked boolean and one arg.
//  2. **Four triggers, and every one of them is reachable.** The upstream
//     had `mouseenter` and nothing else: no focus path, no touch path, no
//     click, no intersection — so keyboard and touch readers never hydrated
//     anything, ever. `intent` mode renders a real, named `<button>` over
//     the placeholder (hover, focus, tap and Enter all reveal); `visible`
//     uses an IntersectionObserver; `idle` uses a one-shot, modifier-owned
//     idle callback; `manual` obeys `@when` alone.
//  3. **The placeholder reserves the final layout's space.** The upstream
//     reserved nothing, so every hydration shoved the page. `@minHeight` /
//     `@aspect` size the gate itself, and `min-block-size` is kept after the
//     swap so the box can never shrink back.
//  4. **`aria-busy` while pending, and a placeholder that is `aria-hidden`.**
//     The upstream announced nothing at all; a shimmer with no `aria-busy`
//     is a decoration that lies.
//  5. **No error branch.** The upstream painted failures as an
//     `rgba(255,0,0,0.1)` tint with no icon, no text and no `role='alert'` —
//     colour-only error. The right fix is not a better tint: loading and
//     failing belong to the *deferred content*, not to the gate that decided
//     when to render it. Defer renders; whatever it renders owns its own
//     states (that is what `DataComponent` is for).
//  6. **`cursor: pointer` only where something is clickable.** The upstream
//     put it on an element with no click handler, and an `outline` on
//     `:hover` but never on focus.
//  7. **Named transition + reduced motion.** `transition: ease 0.2s` names
//     no property; here the reveal is a `@starting-style` fade on opacity
//     alone, and `prefers-reduced-motion` lands on the end state.
//
// Distinct from `InView`, deliberately: InView always renders its content
// and animates the entrance; Defer decides whether to render at all. They
// share the mechanism, InView's `inViewport` modifier, not the job.

export type DeferTrigger = 'visible' | 'idle' | 'intent' | 'manual';

interface IdleScheduler {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Reveal when the main thread goes quiet.
 *
 * The realm's timer law in full: the handle is owned by this modifier, it is
 * cleared in the destructor, and it is **one-shot** — nothing here re-arms,
 * which is the property that keeps `await settled()` from hanging the whole
 * suite. `requestIdleCallback` where it exists (with its own timeout as the
 * upper bound), a single `setTimeout` where it does not.
 */
export const revealsWhenIdle = modifier(
  (_el: HTMLElement, [armed, timeout, reveal]: [boolean, number, () => void]) => {
    if (!armed) {
      return;
    }
    let scope = globalThis as typeof globalThis & IdleScheduler;
    let idleHandle: number | undefined;
    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    if (typeof scope.requestIdleCallback === 'function') {
      idleHandle = scope.requestIdleCallback(() => {
        idleHandle = undefined;
        reveal();
      }, { timeout });
    } else {
      timerHandle = setTimeout(() => {
        timerHandle = undefined;
        reveal();
      }, timeout);
    }
    return () => {
      if (idleHandle !== undefined && typeof scope.cancelIdleCallback === 'function') {
        scope.cancelIdleCallback(idleHandle);
      }
      if (timerHandle !== undefined) {
        clearTimeout(timerHandle);
      }
    };
  },
);

export interface DeferSignature {
  Args: {
    /**
     * What decides. `visible` (default) — an IntersectionObserver.
     * `intent` — a named button covering the placeholder: hover, focus, tap
     * or Enter. `idle` — the first idle slice. `manual` — `@when` only.
     */
    trigger?: DeferTrigger;
    /**
     * Explicit gate. When `true` the content renders immediately regardless
     * of `@trigger`; when `false` the trigger still applies. This is the
     * caller's override, not a lock.
     */
    when?: boolean;
    /** Stay revealed once revealed (default true). `false` re-hides on exit — for content too heavy to keep alive off-screen. */
    once?: boolean;
    /** IntersectionObserver threshold, 0–1. Default 0. */
    threshold?: number;
    /** IntersectionObserver rootMargin — '200px' to start early. Default '200px'. */
    rootMargin?: string;
    /** Upper bound in SECONDS on the idle wait. Default 2. */
    idleTimeout?: number;
    /** Reserved height while pending — kept afterwards as a floor. Any CSS length. */
    minHeight?: string;
    /** Reserved aspect ratio while pending, e.g. '16 / 9'. Dropped once revealed. */
    aspect?: string;
    /** Accessible name of the intent button. Default 'Load content'. */
    intentLabel?: string;
    /** Visible caption on the intent affordance. Omit for a bare surface. */
    intentText?: string;
    /** Announced politely once, after the swap. Silent by default — content arriving on scroll is not news. */
    announceText?: string;
    /** Fires the first time the content is revealed. */
    onReveal?: () => void;
  };
  Blocks: {
    /** The deferred subtree. Rendered only once the gate opens. */
    default: [];
    /** Replaces the Skeleton. Must occupy the reserved box. Requires an explicit `<:default>` alongside it. */
    placeholder: [];
  };
  Element: HTMLDivElement;
}

export class Defer extends Component<DeferSignature> {
  @tracked private tripped = false;
  /** Set once the content has been shown at least once. */
  @tracked private everRevealed = false;

  get trigger(): DeferTrigger {
    return this.args.trigger ?? 'visible';
  }
  get once(): boolean {
    return this.args.once ?? true;
  }
  get threshold(): number {
    let value = this.args.threshold;
    return typeof value === 'number' && value >= 0 && value <= 1 ? value : 0;
  }
  get rootMargin(): string {
    return this.args.rootMargin ?? '200px';
  }
  /** Seconds in, milliseconds out — the kit speaks seconds everywhere. */
  get idleTimeout(): number {
    let seconds = this.args.idleTimeout;
    return Math.round(
      (typeof seconds === 'number' && seconds > 0 ? seconds : 2) * 1000,
    );
  }
  get revealed(): boolean {
    if (this.args.when === true) {
      return true;
    }
    if (this.once && this.everRevealed) {
      return true;
    }
    return this.tripped;
  }
  get pending(): boolean {
    return !this.revealed;
  }
  get busyAttr(): string {
    return this.pending ? 'true' : 'false';
  }
  get stateAttr(): string {
    return this.revealed ? 'revealed' : 'pending';
  }
  /** Arm the observer only while it could still do something: until the
   * first reveal, or for good when the content re-hides on exit. */
  get watching(): boolean {
    return this.trigger === 'visible' && (!this.once || !this.revealed);
  }
  get idling(): boolean {
    return this.trigger === 'idle' && !this.revealed;
  }
  get showIntent(): boolean {
    return this.trigger === 'intent' && this.pending;
  }
  get intentLabel(): string {
    return this.args.intentLabel ?? 'Load content';
  }
  get liveText(): string {
    return this.revealed && this.args.announceText ? this.args.announceText : '';
  }

  /**
   * The reservation. `min-block-size` is written on the host and kept for
   * good — a floor cannot cause a shift. `aspect-ratio` is only written
   * while pending, because keeping it would distort real content.
   */
  get hostStyle() {
    return cssStyleFrom([
      cssDeclaration('min-block-size', this.args.minHeight),
      this.pending ? cssDeclaration('aspect-ratio', this.args.aspect) : undefined,
    ]);
  }

  reveal = (): void => {
    if (this.revealed) {
      return;
    }
    this.tripped = true;
    if (!this.everRevealed) {
      this.everRevealed = true;
      this.args.onReveal?.();
    }
  };

  onViewport = (inView: boolean): void => {
    if (inView) {
      this.reveal();
    } else if (!this.once) {
      this.tripped = false;
    }
  };

  <template>
    <div
      class='pretui-defer'
      data-state={{this.stateAttr}}
      data-trigger={{this.trigger}}
      aria-busy={{this.busyAttr}}
      style={{this.hostStyle}}
      data-test-pretui-defer
      {{inViewport
        this.threshold
        this.rootMargin
        this.once
        enabled=this.watching
        onChange=this.onViewport
      }}
      {{revealsWhenIdle this.idling this.idleTimeout this.reveal}}
      ...attributes
    >
      {{#if this.revealed}}
        <div class='pretui-defer-content' data-test-pretui-defer-content>
          {{yield}}
        </div>
      {{else}}
        <div class='pretui-defer-slot' data-test-pretui-defer-placeholder>
          {{#if (has-block 'placeholder')}}
            {{yield to='placeholder'}}
          {{else}}
            <Skeleton @height='100%' />
          {{/if}}
          {{#if this.showIntent}}
            {{!--
              A real button, not a div with a hover handler. It carries the
              only accessible name in the subtree (the Skeleton is
              aria-hidden), so hover, focus, tap and Enter are one control
              rather than four code paths.
            --}}
            <button
              type='button'
              class='pretui-defer-intent'
              aria-label={{this.intentLabel}}
              data-test-pretui-defer-intent
              {{on 'click' this.reveal}}
              {{on 'pointerenter' this.reveal}}
              {{on 'focus' this.reveal}}
            >{{#if @intentText}}<span
                  class='pretui-defer-intent-text'
                >{{@intentText}}</span>{{/if}}</button>
          {{/if}}
        </div>
      {{/if}}
      <span class='pretui-sr' role='status' data-test-pretui-defer-live>{{this.liveText}}</span>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-defer {
          display: grid;
          align-content: stretch;
          min-width: 0;
          position: relative;
        }
        .pretui-defer-content,
        .pretui-defer-slot {
          min-width: 0;
        }
        .pretui-defer-slot {
          display: grid;
          align-content: stretch;
          position: relative;
          border-radius: var(--radius-surface, 10px);
          overflow: hidden;
        }
        /* The swap is a fade on opacity only, from a @starting-style — no
           transform, because content that slides in has moved the layout the
           placeholder just spent its life reserving. */
        .pretui-defer-content {
          opacity: 1;
          transition: opacity var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        @starting-style {
          .pretui-defer-content {
            opacity: 0;
          }
        }
        /* The intent affordance covers the placeholder rather than sitting
           beside it: the whole reserved box is the target, which is how it
           clears 44px on touch without a size arg. */
        .pretui-defer-intent {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: inherit;
          background: transparent;
          color: var(--muted-foreground);
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          letter-spacing: var(--track-ui, 0.01em);
          cursor: pointer;
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        .pretui-defer-intent:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-defer-intent:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-defer-intent-text {
          padding: var(--space-2, 6px) var(--space-4, 12px);
          border-radius: var(--radius);
          background: var(--card);
          box-shadow: 0 0 0 1px var(--border);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-defer-content,
          .pretui-defer-intent {
            transition: none;
          }
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
      }
    </style>
  </template>
}
