import LinkOffIcon from '@cardstack/boxel-icons/link-off';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import WarningTriangleFilled from '../../icons/warning-triangle-filled.gts';
import Button from '../button/index.gts';
import ContextButton from '../context-button/index.gts';
import CopyButton from '../copy-button/index.gts';

type TipCorner = 'tl' | 'tr' | 'bl' | 'br';

export type BrokenLinkState = 'error' | 'not-found';
export type BrokenLinkFormat = 'isolated' | 'fitted' | 'embedded' | 'atom';
// The kind of thing the broken reference points at. Card sites always pass
// 'card'; the BFM chooser passes 'file' for `:file[...]` refs.
export type BrokenLinkItemType = 'card' | 'file';

// The failure payload the overlay reads. Kept local so boxel-ui carries no
// dependency on runtime-common (which would invert the existing
// runtime-common → boxel-ui edge into a cycle). It lists only the fields the
// template renders; runtime-common's `SerializedError` is a structural
// superset, so base callers can pass one unchanged.
export interface BrokenLinkErrorDoc {
  additionalErrors?: Array<{
    message?: string;
    stack?: string;
    status?: number;
    title?: string;
  }> | null;
  message?: string;
  stack?: string;
  status?: number;
  title?: string;
}

// Navigates to the broken reference for "Open anyway". Local so boxel-ui needn't
// import base's `ViewCardFn`; base's wider `crud.viewCard` (its first param
// accepts `URL`) stays assignable to this.
export type BrokenLinkViewFn = (url: URL) => void;

export interface BrokenLinkTemplateArgs {
  brokenUrl: string;
  // Human-readable label shown next to the link-off icon. Card sites pass the
  // card type name; the BFM file chooser passes the filename. Falls back to
  // the capitalized `itemType` ('Card' / 'File') when omitted.
  displayName?: string;
  errorDoc: BrokenLinkErrorDoc;
  format: BrokenLinkFormat;
  // The kind of reference, used for the reveal-overlay headline ("Linked card
  // not found" vs "Linked file not found") and as the fallback label when no
  // `displayName` is given. `linksTo` field sites are always cards; the BFM
  // chooser passes 'file' for `:file[...]` refs. Falls back to 'card' when
  // omitted.
  itemType?: BrokenLinkItemType;
  state: BrokenLinkState;
  // Threaded from the field component's CardCrudFunctions. When present, the
  // overlay offers an "Open anyway" affordance that navigates to the broken
  // reference (a stack visit in interact mode, a code-editor jump in code
  // mode — whatever the host's viewCard does for the current submode).
  viewCard?: BrokenLinkViewFn;
}

interface NormalizedAdditionalError {
  message: string;
  stack?: string;
  status?: number;
  title?: string;
}

// Only http(s) references are navigable. The brokenUrl is a card reference
// from trusted serialization, but a corrupted realm could ship a non-http
// value; "Open anyway" forwards it into viewCard, so reject other protocols
// (`javascript:`, `data:`, …) — the same reasoning that keeps the URL display
// plain text rather than a link.
function parseHttpUrl(url: string): URL | null {
  try {
    let parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export default class BrokenLinkTemplate extends GlimmerComponent<{
  Args: BrokenLinkTemplateArgs;
  Element: HTMLDivElement;
}> {
  private get itemType(): BrokenLinkItemType {
    return this.args.itemType ?? 'card';
  }

  // The placeholder box is identical for every failure — what went wrong only
  // surfaces inside the reveal overlay. `displayName` is the human-readable
  // label shown next to the link-off icon; when the caller supplies none it
  // falls back to the capitalized itemType ('Card' / 'File').
  private get displayName(): string {
    let { displayName } = this.args;
    if (displayName) {
      return displayName;
    }
    return this.itemType.charAt(0).toUpperCase() + this.itemType.slice(1);
  }

  private get isNotFound() {
    return this.args.state === 'not-found';
  }

  private get headline() {
    return this.isNotFound
      ? `Linked ${this.itemType} not found`
      : `Linked ${this.itemType} failed to load`;
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
    return pieces.join(' - ');
  }

  private get errorMessage(): string {
    return this.args.errorDoc?.message ?? '';
  }

  private get errorStack(): string {
    return this.args.errorDoc?.stack ?? '';
  }

  // The prose message is only a visual duplicate when the stack's text already
  // carries it (a JS stack's first line is typically `ErrorName: message`).
  // When they differ — or there is no stack — the message is distinct
  // information and stays visible.
  private get isMessageRedundant(): boolean {
    let stack = this.errorStack;
    let message = this.errorMessage;
    return stack.length > 0 && message.length > 0 && stack.includes(message);
  }

  // not-found's message is always "Could not find <url>", which the overlay
  // already renders as the URL line — only show the prose message when it
  // carries a distinct error reason.
  private get showMessage(): boolean {
    return !this.isNotFound && this.errorMessage.length > 0;
  }

  // "Open anyway" navigates to the broken reference even though it failed to
  // load — the host's viewCard decides the destination per submode (a stack
  // visit in interact, a code-editor jump in code). Hidden when no viewCard is
  // wired (e.g. a context that can't navigate) or the reference isn't a
  // navigable http(s) URL.
  private get canOpen(): boolean {
    return !!this.args.viewCard && parseHttpUrl(this.args.brokenUrl) !== null;
  }

  private openAnyway = () => {
    let { viewCard, brokenUrl } = this.args;
    let url = parseHttpUrl(brokenUrl);
    if (!viewCard || !url) {
      return;
    }
    viewCard(url);
  };

  private get additionalErrorsLabel(): string {
    let n = this.additionalErrors.length;
    return `${n} additional error${n === 1 ? '' : 's'}`;
  }

  // The toggle checkbox and the trigger <label> are wired by id (the close
  // button unchecks the toggle in JS instead); the overlay and tip anchor by
  // dashed-ident. All must be unique per instance so multiple broken links on a
  // page don't cross-trigger.
  private toggleId = `broken-link-reveal-${guidFor(this)}`;
  private anchorName = `--${this.toggleId}`;
  private overlayAnchorName = `--${this.toggleId}-ov`;
  private get triggerStyle() {
    return htmlSafe(`anchor-name: ${this.anchorName}`);
  }
  private get overlayStyle() {
    // The overlay anchors to the trigger, and is itself an anchor so the tip
    // can sit on the overlay corner that faces the card.
    return htmlSafe(
      `position-anchor: ${this.anchorName}; anchor-name: ${this.overlayAnchorName}`,
    );
  }
  private get tipStyle() {
    return htmlSafe(`position-anchor: ${this.overlayAnchorName}`);
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

  // The reveal itself is pure CSS (a checkbox). But which corner the tip
  // attaches to depends on where CSS anchor positioning actually placed the
  // overlay (above/below × left/right of the trigger, to stay inside the card).
  // CSS can't report the resolved position, so on open we measure it and pick
  // the corner nearest the trigger; the matching CSS variant orients the tip
  // and squares that corner.
  @tracked private tipCorner: TipCorner = 'br';

  // The close control is a real button (ContextButton), not a <label>, so it
  // can't toggle the reveal checkbox by `for=`. Uncheck it directly; the
  // pure-CSS `:checked ~ .overlay` rule then hides the overlay. Unchecking
  // programmatically fires no 'change' event, which is fine — onToggle only
  // acts on the checked transition.
  private close = () => {
    let input = document.getElementById(
      this.toggleId,
    ) as HTMLInputElement | null;
    if (input) {
      input.checked = false;
    }
  };

  private onToggle = (event: Event) => {
    let input = event.target as HTMLInputElement;
    if (!input.checked) {
      return;
    }
    let root = input.closest('.broken-link-template') as HTMLElement | null;
    if (root) {
      // The overlay is revealed by pure CSS (`:checked ~ .overlay`), not an
      // Ember render, so `afterRender` can't observe it. We genuinely need a
      // post-paint callback to measure the laid-out overlay before picking the
      // tip corner — the sanctioned use for rAF per the rule's own escape hatch.
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      requestAnimationFrame(() => this.updateTipCorner(root));
    }
  };

  private updateTipCorner = (root: HTMLElement) => {
    let overlay = root.querySelector('.overlay') as HTMLElement | null;
    let trigger = root.querySelector('.reveal-trigger') as HTMLElement | null;
    if (!overlay || !trigger) {
      return;
    }
    // The card boundary is the overlay's containing block.
    let cardEl =
      (overlay.offsetParent as HTMLElement) ?? document.documentElement;
    let card = cardEl.getBoundingClientRect();
    let o = overlay.getBoundingClientRect();
    let t = trigger.getBoundingClientRect();
    let w = o.width;
    let h = o.height;
    let triggerX = t.left + t.width / 2;
    // The overlay edge sits at the trigger centre, and the gap (tip height +
    // clearance) separates it from the trigger.
    let gap = 24;
    let edge = 10;
    // Prefer opening above the card (tip points down into the shadow); fall
    // back to below, then to whichever side has more room.
    let roomAbove = t.top - card.top;
    let roomBelow = card.bottom - t.bottom;
    let above =
      roomAbove >= h + gap + edge
        ? true
        : roomBelow >= h + gap + edge
          ? false
          : roomAbove >= roomBelow;
    // Prefer extending left (overlay edge at the trigger centre, tip on the
    // right); flip to extending right (tip on the left) when the overlay would
    // crowd the card's left edge.
    let roomLeft = triggerX - card.left;
    let roomRight = card.right - triggerX;
    let extendLeft =
      roomLeft >= w + edge
        ? true
        : roomRight >= w + edge
          ? false
          : roomLeft >= roomRight;
    this.tipCorner =
      `${above ? 'b' : 't'}${extendLeft ? 'r' : 'l'}` as TipCorner;

    // Clamp the panel to the room available on the side it opens so a tall error
    // scrolls inside the card instead of spilling past its boundary. 600px is
    // the design ceiling; a small floor keeps the panel usable and never
    // collapses it to nothing when the card is too short to fit it — it may then
    // overflow, the accepted fallback for very small cards.
    let roomChosen = above ? roomAbove : roomBelow;
    let maxH = Math.min(600, Math.max(roomChosen - gap - edge, 96));
    overlay.style.setProperty('--bl-max-h', `${maxH}px`);
    overlay.style.setProperty('--bl-min-h', `${Math.min(155, maxH)}px`);
  };

  // Re-measure the corner if the layout shifts while the overlay is open.
  private watchReposition = modifier((root: HTMLElement) => {
    let onResize = () => {
      let input = root.querySelector(
        '.reveal-toggle',
      ) as HTMLInputElement | null;
      if (input?.checked) {
        this.updateTipCorner(root);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  <template>
    <div
      class='broken-link-template {{@format}} tip-{{this.tipCorner}}'
      data-test-broken-link-template={{@format}}
      data-test-broken-link-state={{@state}}
      {{this.watchReposition}}
      ...attributes
    >
      {{! Pure-CSS disclosure: the checkbox holds open/closed state; the trigger
          and close affordances are <label>s pointing at it. The only JS is a
          measurement on open that picks which corner the tip attaches to. The
          overlay stays a normal in-flow descendant, so the card's own overflow
          keeps it inside the card boundary. }}
      <input
        id={{this.toggleId}}
        type='checkbox'
        class='reveal-toggle'
        {{on 'change' this.onToggle}}
        data-test-broken-link-toggle
      />

      {{! The box is identical across states — a faint diagonal cross with a
          centered link-off + type-name chip. A warning triangle is the reveal
          trigger; the reason the link is broken lives only in the overlay. }}
      <div class='box'>
        <span class='label'>
          <LinkOffIcon width='14' height='14' />
          <span
            class='type-name'
            data-test-broken-link-type
          >{{this.displayName}}</span>
        </span>
        <label
          for={{this.toggleId}}
          class='reveal-trigger'
          style={{this.triggerStyle}}
          aria-label='Show broken link details'
          data-test-broken-link-reveal
        >
          <WarningTriangleFilled
            class='warn-icon'
            width='17'
            height='17'
            aria-hidden='true'
          />
        </label>
      </div>

      {{! Detail stays DOM-resident (display:none, still in the DOM) so a reader
          or AI consumer can always recover the failure; it becomes visible only
          when the toggle is checked. }}
      <div
        class='overlay'
        style={{this.overlayStyle}}
        data-test-broken-link-overlay
      >
        {{! Title + URL stay out of the scroller so they (and the close
            affordance) remain visible while the error detail scrolls. }}
        <div class='overlay-header'>
          <div class='overlay-title-row'>
            <span class='overlay-title'>
              <WarningTriangleFilled
                class='warn-icon'
                width='16'
                height='16'
                aria-hidden='true'
              />
              <span data-test-broken-link-headline>{{this.headline}}</span>
            </span>
            <ContextButton
              class='overlay-close'
              @icon='close'
              @label='Close'
              @variant='ghost'
              @size='extra-small'
              {{on 'click' this.close}}
              data-test-broken-link-overlay-close
            />
          </div>
          {{! The reference is informational only, never a clickable link. A
              copy affordance to its left puts the URL on the clipboard (same
              control the AI assistant uses for code blocks). }}
          <div class='overlay-url-row'>
            <CopyButton
              class='overlay-url-copy'
              @textToCopy={{@brokenUrl}}
              @variant='text-only'
              @width='14'
              @height='14'
              @tooltipText='Copy link'
              data-test-broken-link-copy
            />
            <span
              class='overlay-url'
              data-test-broken-link-url
            >{{@brokenUrl}}</span>
          </div>
        </div>

        <div class='overlay-panel'>
          {{#if this.isNotFound}}
            {{#if this.statusLabel}}
              <div class='status-badge' data-test-broken-link-status>
                {{this.statusLabel}}
              </div>
            {{/if}}
          {{else}}
            {{! One bordered container groups the failure(s); each is a
                disclosure whose header sits on a tinted strip and whose body
                sits flush on white, divided by hairlines. }}
            <div class='diagnostics'>
              <details class='diag-section' open>
                <summary class='diag-summary' data-test-broken-link-status>
                  <span class='diag-caret' aria-hidden='true'></span>
                  <span class='diag-summary-text'>{{this.statusLabel}}</span>
                </summary>
                <div class='diag-body'>
                  {{#if this.showMessage}}
                    {{! When the stack's first line already carries the message,
                        keep the prose in the DOM for AI consumers but hide the
                        visual duplicate; show it whenever the two differ. }}
                    <div
                      class='error-message
                        {{if this.isMessageRedundant "is-redundant"}}'
                      data-test-broken-link-message
                    >{{this.errorMessage}}</div>
                  {{/if}}
                  {{#if this.errorStack}}
                    <pre
                      class='error-stack'
                      data-test-broken-link-stack
                    >{{this.errorStack}}</pre>
                  {{/if}}
                </div>
              </details>

              {{#let this.additionalErrors as |additionalErrors|}}
                {{#if additionalErrors.length}}
                  <details class='diag-section additional-section'>
                    <summary class='diag-summary'>
                      <span class='diag-caret' aria-hidden='true'></span>
                      <span
                        class='diag-summary-text'
                      >{{this.additionalErrorsLabel}}</span>
                    </summary>
                    <div class='diag-body'>
                      <ul class='additional-list'>
                        {{#each additionalErrors as |err i|}}
                          <li
                            class='additional-item'
                            data-test-broken-link-additional-error={{i}}
                          >
                            <span class='additional-badge'>{{#if
                                err.status
                              }}{{err.status}} {{/if}}{{err.message}}</span>
                            {{#if err.stack}}
                              <pre class='additional-stack'>{{err.stack}}</pre>
                            {{/if}}
                          </li>
                        {{/each}}
                      </ul>
                    </div>
                  </details>
                {{/if}}
              {{/let}}
            </div>
          {{/if}}
        </div>

        {{! Pinned below the scroller so it stays reachable however long the
            diagnostics get. Navigates to the broken reference via the threaded
            viewCard; the host resolves the destination for the current
            submode. }}
        {{#if this.canOpen}}
          <div class='overlay-footer'>
            <Button
              class='open-anyway'
              @kind='secondary'
              @size='small'
              {{on 'click' this.openAnyway}}
              data-test-broken-link-open-anyway
            >Open anyway</Button>
          </div>
        {{/if}}
      </div>

      {{! The tip: a solid-white right-triangle sitting ON TOP of the overlay's
          shadow (so it's uniformly white with no seam) at the overlay corner
          that faces the card. Its vertical edge is flush with the overlay's
          side edge and its apex points back at the placeholder. Sibling of the
          overlay so it can anchor to it; laid out after it. }}
      <span class='tip' style={{this.tipStyle}} aria-hidden='true'></span>
    </div>

    <style scoped>
      /* The placeholder fills its host slot but does NOT clip — the cross is
         clipped by the inner `.box`, leaving the root free so the overlay can
         extend out of the small placeholder footprint and be bounded only by
         the surrounding card (whose own overflow keeps it inside the card). */
      .broken-link-template {
        box-sizing: border-box;
        position: static;
        /* Shared by the overlay (gap to the trigger) and the tip (height), so
           both must live on the common ancestor — the tip is a sibling of the
           overlay, not a child. The gap is the tip height + 5px so the apex
           stops ~5px short of the trigger. */
        --bl-tip-h: 0.9rem;
        --bl-gap: calc(var(--bl-tip-h) + 5px);
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
        background-color: var(--boxel-light-400);
        background-image:
          linear-gradient(
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
        min-height: 28px;
        padding: 0 var(--boxel-sp-2xs);
        /* 10px between the type text and the caution triangle (per design); the
           label's own padding is zeroed below so this gap is measured from the
           text edge, not the chip's padding box. */
        gap: 10px;
        border-radius: var(--boxel-border-radius-2xs);
      }
      .broken-link-template.atom .label {
        padding: 0;
      }

      .label {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-4xs);
        background-color: var(--boxel-light-400);
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-xs);
        line-height: 1.5;
        white-space: nowrap;
      }
      .label svg {
        flex: none;
      }
      .warn-icon {
        display: block;
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
         The warning triangle, pinned top-right of the box (right-of-label for
         the inline atom). */
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
        cursor: pointer;
      }
      .reveal-trigger:hover,
      .reveal-toggle:focus-visible + .box .reveal-trigger {
        filter: brightness(0.92);
      }
      .broken-link-template.atom .reveal-trigger {
        position: static;
      }

      /* ── Reveal overlay ───────────────────────────────────────────────────
         A normal absolutely-positioned element (NOT a top-layer popover) so the
         card's own overflow keeps it inside the card. It is right-aligned to
         the trigger and opens above it by default (the tip then sits in the
         overlay's bottom-right corner, pointing down at the placeholder);
         flips below near the top edge. The rounded frame + clip live here while
         the inner panel scrolls, so the scrollbar can't square off the
         corners. */
      .overlay {
        display: none;
        position: absolute;
        /* Fixed platter footprint per design (350 × 155–600). The tip anchors
           to the overlay's own corner, so it tracks these dimensions without
           any change to its geometry. */
        width: 350px;
        /* Floor/ceiling defaults; the geometry pass narrows --bl-max-h to the
           room available inside the card so a tall panel scrolls rather than
           clipping, and drops --bl-min-h in lockstep so the floor never forces
           an overflow. */
        min-height: var(--bl-min-h, 155px);
        max-height: var(--bl-max-h, 600px);
        /* Placement is chosen on open (the `tip-{corner}` class on the root,
           set by a geometry measurement): the overlay extends into the open
           space and the tip sits on the corner facing the trigger. Anchored to
           the trigger; the gap (defined on the root, shared with the tip)
           leaves the apex ~5px short of the trigger. */
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        overflow: hidden;
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        flex-direction: column;
        z-index: 5;
      }
      .reveal-toggle:checked ~ .overlay {
        display: flex;
      }
      .overlay-header {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-5xs);
      }
      .overlay-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .overlay-title {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .overlay-close {
        flex: none;
        margin: -2px -2px 0 0;
      }
      .overlay-url-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
      }
      .overlay-url-copy {
        flex: none;
        --boxel-icon-button-width: 1.125rem;
        --boxel-icon-button-height: 1.125rem;
        color: var(--boxel-400);
      }
      .overlay-url-copy:hover {
        color: var(--boxel-dark);
      }
      .overlay-url {
        flex: 1 1 auto;
        min-width: 0;
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.8em;
        line-height: 1.125rem;
        word-break: break-all;
        color: var(--boxel-500);
      }
      .overlay-panel {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: 0 var(--boxel-sp-xxs);
      }

      /* Pinned action row — sits outside the scroller so the primary CTA stays
         visible however tall the diagnostics get. Even vertical padding gives
         the button a balanced top/bottom margin. */
      .overlay-footer {
        flex: none;
        display: flex;
        justify-content: flex-end;
        padding: var(--boxel-sp-xs);
      }

      /* ── Overlay panel: status badge (not-found) ──────────────────────
         A single bordered box carrying the status code. */
      .status-badge {
        display: block;
        margin-top: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--boxel-light-100);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-2xs);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--boxel-dark);
      }

      /* ── Overlay panel: diagnostics accordion (error) ─────────────────
         One bordered container groups the failure(s); each is a disclosure
         whose header sits on a tinted strip and whose body sits flush on
         white, separated by hairline dividers. */
      .diagnostics {
        margin-top: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-2xs);
        overflow: hidden;
        background-color: var(--boxel-light);
      }
      .diag-section + .diag-section {
        border-top: 1px solid var(--boxel-border-color);
      }
      .diag-summary {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--boxel-light-100);
        color: var(--boxel-dark);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: pointer;
        list-style: none;
        user-select: none;
      }
      .diag-summary::-webkit-details-marker {
        display: none;
      }
      .diag-summary::marker {
        content: '';
      }
      /* The status code reads as an all-caps constant; the additional-error
         count is descriptive prose, so it keeps sentence case. */
      .additional-section > .diag-summary {
        text-transform: none;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .diag-caret {
        flex: none;
        width: 0;
        height: 0;
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        border-left: 5px solid currentColor;
        transition: transform 0.12s ease;
      }
      .diag-section[open] > .diag-summary .diag-caret {
        transform: rotate(90deg);
      }
      .diag-body {
        padding: var(--boxel-sp-sm);
        border-top: 1px solid var(--boxel-border-color);
        background-color: var(--boxel-light);
      }
      .error-message {
        font-weight: 400;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.8em;
        color: var(--boxel-dark);
      }
      /* Applied only when the stack already carries the message — keep the
         prose in the DOM for AI consumers but hide the visual duplicate. */
      .error-message.is-redundant {
        display: none;
      }
      .error-message + .error-stack {
        margin-top: var(--boxel-sp-5xs);
      }
      .error-stack {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.75em;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        color: var(--boxel-dark);
      }
      .additional-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .additional-badge {
        display: block;
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--boxel-dark);
      }
      .additional-stack {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.75em;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        margin: var(--boxel-sp-5xs) 0 0;
        color: var(--boxel-500);
      }

      /* ── The tip ──────────────────────────────────────────────────────────
         A solid-white right-triangle clipped from a small box, sitting at the
         overlay corner that faces the trigger, ON TOP of the shadow (z-index
         above the overlay) so it's uniformly white with no seam where it meets
         the overlay. Its straight edge is flush with the overlay's side edge;
         the apex points back at the placeholder. The corner is chosen on open
         (`tip-{corner}` on the root) and the matching overlay corner is
         squared so the tip merges into it cleanly. */
      .tip {
        display: none;
        position: absolute;
        z-index: 6;
        box-sizing: border-box;
        width: 0.85rem;
        height: var(--bl-tip-h);
        background-color: var(--boxel-light);
      }
      .reveal-toggle:checked ~ .tip {
        display: block;
      }
      /* overlay above, right edge at trigger → tip at overlay bottom-right */
      .tip-br .tip {
        right: anchor(right);
        top: anchor(bottom);
        translate: 0 -1px;
        clip-path: polygon(0 0, 100% 0, 100% 100%);
        border-right: 1px solid var(--boxel-border-color);
      }
      .tip-br .overlay {
        right: anchor(center);
        bottom: anchor(top);
        margin-bottom: var(--bl-gap);
        border-bottom-right-radius: 0;
      }
      /* overlay below, right edge at trigger → tip at overlay top-right */
      .tip-tr .tip {
        right: anchor(right);
        bottom: anchor(top);
        translate: 0 1px;
        clip-path: polygon(0 100%, 100% 0, 100% 100%);
        border-right: 1px solid var(--boxel-border-color);
      }
      .tip-tr .overlay {
        right: anchor(center);
        top: anchor(bottom);
        margin-top: var(--bl-gap);
        border-top-right-radius: 0;
      }
      /* overlay above, left edge at trigger → tip at overlay bottom-left */
      .tip-bl .tip {
        left: anchor(left);
        top: anchor(bottom);
        translate: 0 -1px;
        clip-path: polygon(0 0, 100% 0, 0 100%);
        border-left: 1px solid var(--boxel-border-color);
      }
      .tip-bl .overlay {
        left: anchor(center);
        bottom: anchor(top);
        margin-bottom: var(--bl-gap);
        border-bottom-left-radius: 0;
      }
      /* overlay below, left edge at trigger → tip at overlay top-left */
      .tip-tl .tip {
        left: anchor(left);
        bottom: anchor(top);
        translate: 0 1px;
        clip-path: polygon(0 0, 0 100%, 100% 100%);
        border-left: 1px solid var(--boxel-border-color);
      }
      .tip-tl .overlay {
        left: anchor(center);
        top: anchor(bottom);
        margin-top: var(--bl-gap);
        border-top-left-radius: 0;
      }
    </style>
  </template>
}
