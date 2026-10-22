// Pretui — Backdrop: a scrim, frost or clear layer that separates content from what is behind it.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { clampNum, styleFrom } from '../internal/texture';

// ── Backdrop ─────────────────────────────────────────────────────────────

/** Scrim treatment. `clear` is an invisible click-catcher. */
export type BackdropTone = 'scrim' | 'frost' | 'clear';

export interface BackdropSignature {
  Args: {
    /** Render the scrim. Defaults to true so `<Backdrop />` just works; bind it to keep the entry transition. */
    open?: boolean;
    /** `scrim` (tinted), `frost` (tinted + backdrop blur), `clear` (invisible click-catcher). */
    tone?: BackdropTone;
    /** Backdrop blur radius in px (0–40). Any tone may set it; `frost` defaults to 8 and keeps its saturation lift when you override the radius. Only a value above 0 turns the filter on — the heaviest thing in this file, a full-surface filter pass on every paint. */
    blur?: number;
    /** `fixed` covers the viewport (modal surfaces); `absolute` covers the nearest positioned ancestor (a panel-local scrim). */
    position?: 'fixed' | 'absolute';
    /** Dismiss handler. When present the scrim renders as a real `<button>` (click, Enter/Space, Escape); when absent it is an inert `aria-hidden` div. */
    onDismiss?: () => void;
    /** Accessible name for the dismiss button. Defaults to "Close". */
    label?: string;
    /** Put the dismiss button in the tab order. Off by default — the owning surface owns Escape, and a full-viewport tab stop is noise. */
    focusable?: boolean;
    /** Stacking level. Also settable as `--pretui-backdrop-z`. */
    z?: number;
  };
  Blocks: {};
  Element: HTMLElement;
}

/**
 * The scrim/underlay behind a layered surface — dialogs, drawers, sheets,
 * popovers, media lightboxes.
 *
 * Nearest inspirations: motion-primitives' GlowEffect/ProgressiveBlur and
 * cult-ui's distorted-glass, plus the ad-hoc `<div className="fixed inset-0
 * bg-black/50" onClick={close} />` that every React overlay tutorial ships.
 * Better here: the dismiss target is a REAL `<button>` (that pattern's
 * clickable div has no keyboard path and no accessible name — Enter/Space
 * and Escape both work here, and `@label` is required in spirit and defaulted
 * in practice); the tint is one token (`--pretui-overlay-scrim`, the same one
 * `Dialog`/`Drawer` already paint on `::backdrop`) rather than an opacity
 * literal; the entry fade is `@starting-style`, so there is no JS mount
 * transition and reduced motion simply gets the end state.
 *
 * Deliberately yields NOTHING: a backdrop that renders children would either
 * nest interactive content inside a `<button>` (an a11y violation) or force a
 * second wrapper. The layered surface is a SIBLING of the backdrop, above it
 * in the stacking order. Documented rather than hidden (Law 7).
 */
export class Backdrop extends Component<BackdropSignature> {
  get open(): boolean {
    return this.args.open ?? true;
  }
  get tone(): BackdropTone {
    return this.args.tone ?? 'scrim';
  }
  get label(): string {
    return this.args.label ?? 'Close';
  }
  // Only a POSITIVE blur opts into the filter. `@blur={{0}}` must not paint a
  // `backdrop-filter: blur(0px)` — a no-op filter still promotes the scrim to
  // its own compositing layer and makes it a containing block for fixed
  // descendants, which is exactly the surprise a full-viewport element should
  // not spring on the surface above it.
  get hasBlur(): boolean {
    let blur = clampNum(this.args.blur, 0, 40);
    return blur !== undefined && blur > 0;
  }
  get style() {
    let parts: string[] = [];
    let blur = clampNum(this.args.blur, 0, 40);
    if (blur !== undefined) parts.push(`--pretui-backdrop-blur: ${blur}px`);
    let z = clampNum(this.args.z, 0, 2147483000);
    if (z !== undefined) parts.push(`--pretui-backdrop-z: ${z}`);
    return styleFrom(parts);
  }
  dismiss = () => {
    this.args.onDismiss?.();
  };
  onKeyDown = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      e.stopPropagation();
      this.args.onDismiss?.();
    }
  };
  <template>
    {{#if this.open}}
      {{#if @onDismiss}}
        <button
          type='button'
          class='pretui-backdrop'
          data-tone={{this.tone}}
          data-position={{if @position @position 'fixed'}}
          data-blur={{if this.hasBlur 'true' 'false'}}
          style={{this.style}}
          aria-label={{this.label}}
          tabindex={{if @focusable '0' '-1'}}
          data-test-pretui-backdrop
          {{on 'click' this.dismiss}}
          {{on 'keydown' this.onKeyDown}}
          ...attributes
        ></button>
      {{else}}
        <div
          class='pretui-backdrop'
          data-tone={{this.tone}}
          data-position={{if @position @position 'fixed'}}
          data-blur={{if this.hasBlur 'true' 'false'}}
          style={{this.style}}
          aria-hidden='true'
          data-test-pretui-backdrop
          ...attributes
        ></div>
      {{/if}}
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-backdrop {
          /* a scrim must escape scroll clipping when it is covering the
             viewport (lint warns on fixed; accepted, same as overlay.gts) */
          position: fixed;
          inset: 0;
          z-index: var(--pretui-backdrop-z, 50);
          display: block;
          margin: 0;
          padding: 0;
          border: 0;
          cursor: var(--pretui-backdrop-cursor, default);
          background: var(
            --pretui-backdrop-tint,
            var(--pretui-overlay-scrim, rgb(16 24 40 / 0.4))
          );
          opacity: 1;
          transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .pretui-backdrop[data-position='absolute'] {
          position: absolute;
        }
        .pretui-backdrop[data-tone='frost'] {
          background: var(
            --pretui-backdrop-tint,
            color-mix(in oklch, var(--background) 55%, transparent)
          );
          backdrop-filter: blur(var(--pretui-backdrop-blur, 8px))
            saturate(var(--pretui-backdrop-saturate, 1.3));
        }
        .pretui-backdrop[data-tone='clear'] {
          background: transparent;
        }
        /* An explicit @blur opts a NON-frost tone into the filter (frost already
           reads the same custom property, and excluding it here is what keeps
           `@tone='frost' @blur={{16}}` from quietly losing frost's saturation
           lift — same specificity, and this rule comes later). */
        .pretui-backdrop[data-blur='true']:not([data-tone='frost']) {
          backdrop-filter: blur(var(--pretui-backdrop-blur, 0px))
            saturate(var(--pretui-backdrop-saturate, 1));
        }
        .pretui-backdrop:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -3px;
        }
        @starting-style {
          .pretui-backdrop {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-backdrop {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
