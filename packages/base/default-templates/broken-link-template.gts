import GlimmerComponent from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
import LinkOffIcon from '@cardstack/boxel-icons/link-off';
import InfoCircleIcon from '@cardstack/boxel-icons/info-circle';
import { cardTypeName } from '@cardstack/runtime-common';
import type { SerializedError } from '@cardstack/runtime-common';

export type BrokenLinkState = 'error' | 'not-found';
export type BrokenLinkFormat = 'isolated' | 'fitted' | 'embedded' | 'atom';

export interface BrokenLinkTemplateArgs {
  brokenUrl: string;
  errorDoc: SerializedError;
  state: BrokenLinkState;
  format: BrokenLinkFormat;
}

interface NormalizedAdditionalError {
  message: string;
  status?: number;
  title?: string;
  stack?: string;
}

// Only http(s) URLs are safe to drop into an <a href> — `javascript:` and
// `data:` URLs in an anchor execute on click. The brokenUrl flows from
// trusted card-serialization data, but a corrupted realm could still ship
// a non-http reference; we fall back to plain text in that case.
function isSafeHttpUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  try {
    let parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default class BrokenLinkTemplate extends GlimmerComponent<{
  Element: HTMLDivElement;
  Args: BrokenLinkTemplateArgs;
}> {
  // The placeholder box is identical for every failure — what went wrong only
  // surfaces inside the reveal overlay. `typeName` is the human-readable label
  // shown next to the link-off icon, derived from the reference URL.
  private get typeName(): string {
    return cardTypeName(this.args.brokenUrl);
  }

  private get isNotFound() {
    return this.args.state === 'not-found';
  }

  private get headline() {
    return this.isNotFound
      ? 'Linked card not found'
      : 'Linked card failed to load';
  }

  private get statusLabel(): string {
    let { errorDoc } = this.args;
    if (!errorDoc) {
      return '';
    }
    let pieces: string[] = [];
    if (typeof errorDoc.status === 'number') {
      pieces.push(String(errorDoc.status));
    }
    if (errorDoc.title) {
      pieces.push(errorDoc.title);
    }
    return pieces.join(' · ');
  }

  private get errorMessage(): string {
    return this.args.errorDoc?.message ?? '';
  }

  private get errorStack(): string {
    return this.args.errorDoc?.stack ?? '';
  }

  // not-found's message is always "Could not find <url>", which the overlay
  // already renders as the URL line — only show the prose message when it
  // carries a distinct error reason.
  private get showMessage(): boolean {
    return !this.isNotFound && this.errorMessage.length > 0;
  }

  private get urlIsSafe(): boolean {
    return isSafeHttpUrl(this.args.brokenUrl);
  }

  // The toggle checkbox and the trigger/close labels are wired by id, and the
  // beak anchors to the trigger by dashed-ident — all must be unique per
  // instance so multiple broken links on a page don't cross-trigger.
  private toggleId = `broken-link-reveal-${guidFor(this)}`;
  private anchorName = `--${this.toggleId}`;
  private get triggerStyle() {
    return htmlSafe(`anchor-name: ${this.anchorName}`);
  }
  private get overlayStyle() {
    // `position-anchor` glues the overlay to the trigger.
    return htmlSafe(`position-anchor: ${this.anchorName}`);
  }

  private get additionalErrors(): NormalizedAdditionalError[] {
    let raw = this.args.errorDoc?.additionalErrors;
    if (!Array.isArray(raw)) {
      return [];
    }
    let normalized: NormalizedAdditionalError[] = [];
    for (let entry of raw) {
      if (entry == null || typeof entry !== 'object') {
        continue;
      }
      let message =
        typeof entry.message === 'string' && entry.message.length > 0
          ? entry.message
          : typeof entry.title === 'string' && entry.title.length > 0
            ? entry.title
            : '';
      if (!message) {
        continue;
      }
      normalized.push({
        message,
        status: typeof entry.status === 'number' ? entry.status : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        stack: typeof entry.stack === 'string' ? entry.stack : undefined,
      });
    }
    return normalized;
  }

  <template>
    <div
      class='broken-link-template {{@format}}'
      data-test-broken-link-template={{@format}}
      data-test-broken-link-state={{@state}}
      ...attributes
    >
      {{! Pure-CSS disclosure: the checkbox holds open/closed state; the trigger
          and close affordances are <label>s pointing at it. No JS, and — unlike
          a popover — the overlay stays a normal in-flow descendant, so the
          card's own overflow keeps it inside the card boundary. }}
      <input
        id={{this.toggleId}}
        type='checkbox'
        class='reveal-toggle'
        data-test-broken-link-toggle
      />

      {{! The box is intentionally identical across states — a faint diagonal
          cross with a centered link-off + type-name chip. The reason the link
          is broken lives only in the reveal overlay. }}
      <div class='box'>
        <span class='label'>
          <LinkOffIcon width='14' height='14' />
          <span
            class='type-name'
            data-test-broken-link-type
          >{{this.typeName}}</span>
        </span>
        <label
          for={{this.toggleId}}
          class='reveal-trigger'
          style={{this.triggerStyle}}
          aria-label='Show broken link details'
          data-test-broken-link-reveal
        >
          <InfoCircleIcon width='16' height='16' />
        </label>
      </div>

      {{! Detail stays DOM-resident (display:none, still in the DOM) so a reader
          or AI consumer can always recover the failure; it becomes visible only
          when the toggle is checked. }}
      <div class='overlay' style={{this.overlayStyle}} data-test-broken-link-overlay>
        {{! Header stays out of the scroller so the close affordance is always
            reachable while the detail below scrolls. }}
        <div class='overlay-header'>
          <span class='overlay-title' data-test-broken-link-headline>
            {{this.headline}}
          </span>
          <label
            for={{this.toggleId}}
            class='overlay-close'
            aria-label='Close'
            data-test-broken-link-overlay-close
          >×</label>
        </div>
        <div class='overlay-panel'>
          {{#if this.statusLabel}}
            <div class='overlay-status' data-test-broken-link-status>
              {{this.statusLabel}}
            </div>
          {{/if}}

          {{#if this.urlIsSafe}}
            <a
              class='overlay-url'
              href={{@brokenUrl}}
              target='_blank'
              rel='noopener noreferrer'
              data-test-broken-link-url
            >{{@brokenUrl}}</a>
          {{else}}
            {{! Unsafe protocol — render as text so a click cannot execute. }}
            <span
              class='overlay-url'
              data-test-broken-link-url
            >{{@brokenUrl}}</span>
          {{/if}}

          {{#if this.showMessage}}
            <div class='overlay-message' data-test-broken-link-message>
              {{this.errorMessage}}
            </div>
          {{/if}}

          {{#if this.errorStack}}
            <pre
              class='overlay-stack'
              data-test-broken-link-stack
            >{{this.errorStack}}</pre>
          {{/if}}

          {{#let this.additionalErrors as |additionalErrors|}}
            {{#if additionalErrors.length}}
              <ul class='overlay-additional'>
                {{#each additionalErrors as |err i|}}
                  <li data-test-broken-link-additional-error={{i}}>
                    {{#if err.status}}
                      <span class='additional-status'>{{err.status}}</span>
                    {{/if}}
                    <span class='additional-message'>{{err.message}}</span>
                    {{#if err.stack}}
                      <pre class='additional-stack'>{{err.stack}}</pre>
                    {{/if}}
                  </li>
                {{/each}}
              </ul>
            {{/if}}
          {{/let}}
        </div>
      </div>
    </div>

    <style scoped>
      /* The placeholder fills its host slot but does NOT clip — the cross is
         clipped by the inner `.box`, leaving the root free so the overlay can
         extend out of the small placeholder footprint and be bounded only by
         the surrounding card (whose own overflow keeps it inside the card). */
      .broken-link-template {
        box-sizing: border-box;
        position: static;
      }
      .broken-link-template.fitted {
        width: 100%;
        height: 100%;
        min-height: 40px;
        max-height: 600px;
      }
      .broken-link-template.embedded {
        width: 100%;
        min-height: 9.375rem;
      }
      .broken-link-template.isolated {
        width: 100%;
        height: 100%;
        min-height: 18.75rem;
      }
      .broken-link-template.atom {
        display: inline-flex;
        vertical-align: middle;
      }

      /* ── The box ──────────────────────────────────────────────────────────
         Mirrors the markdown broken-card treatment (markdown.gts
         .markdown-bfm-broken*): two crossed linear-gradient strokes forming a
         faint diagonal X, with a centered link-off + type-name chip whose fill
         matches the box so the cross does not slice through the label. */
      .box {
        position: relative;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        min-height: inherit;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light-100);
        background-image: linear-gradient(
            to top right,
            transparent calc(50% - 0.5px),
            var(--boxel-border-color) calc(50% - 0.5px),
            var(--boxel-border-color) calc(50% + 0.5px),
            transparent calc(50% + 0.5px)
          ),
          linear-gradient(
            to bottom right,
            transparent calc(50% - 0.5px),
            var(--boxel-border-color) calc(50% - 0.5px),
            var(--boxel-border-color) calc(50% + 0.5px),
            transparent calc(50% + 0.5px)
          );
        overflow: hidden;
      }
      .broken-link-template.atom .box {
        min-height: 1.6em;
        padding: 0 var(--boxel-sp-5xs);
        gap: var(--boxel-sp-5xs);
        border-radius: var(--boxel-border-radius-sm);
      }

      .label {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
        background-color: var(--boxel-light-100);
        color: var(--boxel-500);
        font: 500 var(--boxel-font-xs);
        line-height: 1.5;
        white-space: nowrap;
      }
      .label svg {
        flex: none;
      }
      .type-name {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .broken-link-template.atom .type-name {
        max-width: 12ch;
      }

      /* ── Reveal trigger ───────────────────────────────────────────────────
         An "i" affordance pinned to the top-right of the box (right-of-label
         for the inline atom). Sits on its own fill chip so the cross does not
         cut through it. */
      .reveal-toggle {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        overflow: hidden;
        white-space: nowrap;
      }
      .reveal-trigger {
        position: absolute;
        top: var(--boxel-sp-5xs);
        right: var(--boxel-sp-5xs);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px;
        border-radius: 50%;
        background-color: var(--boxel-light-100);
        color: var(--boxel-400);
        cursor: pointer;
      }
      .reveal-trigger:hover,
      .reveal-toggle:focus-visible + .box .reveal-trigger {
        color: var(--boxel-highlight);
      }
      .reveal-toggle:checked + .box .reveal-trigger {
        color: var(--boxel-highlight);
      }
      .broken-link-template.atom .reveal-trigger {
        position: static;
        padding: 0;
      }

      /* ── Reveal overlay ───────────────────────────────────────────────────
         A normal absolutely-positioned element (NOT a top-layer popover) so the
         surrounding card's overflow keeps it inside the card. Anchored to the
         trigger and flipped only on the block axis — it stays below the trigger
         and slides horizontally to fit, or flips above when there's no room
         below. The rounded frame + clip live here (the outer box) while the
         inner panel scrolls, so the scrollbar can't square off the corners. */
      .overlay {
        display: none;
        /* Absolutely positioned (NOT a top-layer popover) so the overlay is a
           normal descendant: the card slot is its containing block and the
           card's own overflow clips it, keeping it inside the card boundary
           rather than spilling out over the page. */
        position: absolute;
        width: max-content;
        /* Cap relative to the containing block (the card slot), never the
           viewport — the placeholder isn't inside a query container, so
           container units would fall back to the viewport and could outgrow a
           small card. The card's own overflow is the hard bound; the panel
           scrolls past the height cap. */
        max-width: min(20rem, 100%);
        max-height: 18rem;
        position-area: bottom;
        justify-self: anchor-center;
        position-try-fallbacks: bottom span-left, bottom span-right, top,
          top span-left, top span-right;
        /* Block margin = the gap to the trigger; inline margin = the gap kept
           from the card's left/right edge (position-try holds the margin box
           inside the card, so the overlay never sits flush against the edge). */
        margin: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        /* Clip the scrolling panel to the rounded frame. */
        overflow: hidden;
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        /* Column layout: a fixed header + a scrolling detail panel. */
        flex-direction: column;
        /* Sit above every placeholder box in the card — the boxes are
           positioned (for the trigger), so without this an overlay would paint
           behind any later placeholder it overlaps. */
        z-index: 5;
      }
      .reveal-toggle:checked ~ .overlay {
        display: flex;
      }
      .overlay-header {
        flex: none;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) 0;
      }
      .overlay-panel {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs) var(--boxel-sp-xs);
      }
      .overlay-title {
        font-weight: 600;
      }
      .overlay-close {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        margin: -2px -2px 0 0;
        border-radius: 50%;
        color: var(--boxel-400);
        font-size: 1.1rem;
        line-height: 1;
        cursor: pointer;
      }
      .overlay-close:hover {
        background-color: var(--boxel-100);
        color: var(--boxel-dark);
      }
      .overlay-status {
        margin-top: var(--boxel-sp-5xs);
        color: var(--boxel-450, #6f6f6f);
        font-size: 0.8em;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .overlay-url {
        display: block;
        margin-top: var(--boxel-sp-5xs);
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.85em;
        word-break: break-all;
        color: var(--boxel-dark);
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: var(--boxel-450, #6f6f6f);
      }
      .overlay-message {
        margin-top: var(--boxel-sp-xs);
        font-weight: 400;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.9em;
      }
      .overlay-stack {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.75em;
        white-space: pre-wrap;
        word-break: break-word;
        margin: var(--boxel-sp-xs) 0 0;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .overlay-additional {
        list-style: none;
        padding: 0;
        margin: var(--boxel-sp-xs) 0 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        font-size: 0.85em;
      }
      .additional-status {
        display: inline-block;
        padding: 0 var(--boxel-sp-5xs);
        margin-right: var(--boxel-sp-5xs);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-form-control-border-radius);
        font-weight: 600;
      }
      .additional-message {
        word-break: break-word;
      }
      .additional-stack {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.85em;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 2px 0 0;
      }
    </style>
  </template>
}
