// Pretui — PanelSection: a collapsible group of property rows.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';

// ═══════════════════════════════════════════════════════════════════════
// PanelSection — the collapsible group (fig-group)
// ═══════════════════════════════════════════════════════════════════════

export interface PanelSectionSignature {
  Args: {
    /** section heading */
    title?: string;
    /** heading level for the title, 2–6. Defaults to 3 — a panel section
     * sits under the panel's own h2. */
    level?: 2 | 3 | 4 | 5 | 6;
    /** false makes the section a plain titled group with no disclosure */
    collapsible?: boolean;
    /** CONTROLLED open state. Omit to let the section own it. */
    open?: boolean;
    /** initial open state when uncontrolled (default true) */
    defaultOpen?: boolean;
    /** small count/summary shown after the title (e.g. "3 effects") */
    summary?: string;
    /** 0 (default) is a top-level group. 1–3 mark a group nested INSIDE
     * another group — a Person inside a Subject — which drops the peer
     * hairline, de-shouts the heading out of small-caps, and hangs the body
     * off a vertical rule so the nesting is legible in a still frame rather
     * than only while collapsing. Indentation itself compounds from the
     * parent's own body padding; this arg supplies the treatment, not the
     * offset. */
    depth?: number;
    onToggle?: (open: boolean) => void;
  };
  Blocks: {
    default: [];
    /** controls that ride in the header — an add button, an eye toggle.
     * Rendered OUTSIDE the disclosure button so they stay independently
     * clickable, which figui3's whole-header click target breaks. */
    actions: [];
  };
  Element: HTMLElement;
}

/**
 * A titled, collapsible group of property rows — the workhorse of an
 * inspector.
 *
 * Fixes carried over figui3's `fig-group`:
 *
 *  - Upstream puts `role='button'` + `tabindex=0` on the whole `fig-header`,
 *    so any action button inside it is swallowed by the toggle. Here the
 *    disclosure is a real `<button>` and `<:actions>` sits beside it.
 *  - Upstream's chevron lives inside the `<h3>`, making the heading text
 *    read as "▸ Layout" to a screen reader. Here the chevron is
 *    `aria-hidden` and the heading wraps the button (the APG disclosure
 *    shape), so the accessible name is just the title.
 *  - The collapse is a `grid-template-rows: 0fr → 1fr` transition rather
 *    than `display: none`, so it animates without measuring a height, and
 *    lands on the END state under `prefers-reduced-motion`.
 */
export class PanelSection extends Component<PanelSectionSignature> {
  @tracked internalOpen = this.args.defaultOpen ?? true;
  private guid = guidFor(this);

  get regionId(): string {
    return this.guid + '-region';
  }
  get open(): boolean {
    return this.args.open ?? this.internalOpen;
  }
  get collapsible(): boolean {
    return this.args.collapsible ?? true;
  }
  get expanded(): boolean {
    return this.collapsible ? this.open : true;
  }
  get level(): number {
    let raw = this.args.level ?? 3;
    return raw >= 2 && raw <= 6 ? raw : 3;
  }
  get depth(): number {
    let raw = Math.trunc(Number(this.args.depth ?? 0));
    if (!Number.isFinite(raw) || raw <= 0) {
      return 0;
    }
    return Math.min(3, raw);
  }
  toggle = () => {
    let next = !this.open;
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onToggle?.(next);
  };
  <template>
    <section
      class='pretui-section'
      data-open={{if this.expanded 'true' 'false'}}
      data-depth={{this.depth}}
      data-test-pretui-panel-section
      ...attributes
    >
      {{#if @title}}
        <div class='pretui-section-head'>
          <div class='pretui-section-heading' role='heading' aria-level={{this.level}}>
            {{#if this.collapsible}}
              <button
                type='button'
                class='pretui-section-toggle'
                aria-expanded={{if this.expanded 'true' 'false'}}
                aria-controls={{this.regionId}}
                {{on 'click' this.toggle}}
                data-test-pretui-section-toggle
              >
                <span class='pretui-section-chevron' aria-hidden='true'></span>
                <span class='pretui-section-title'>{{@title}}</span>
              </button>
            {{else}}
              <span class='pretui-section-static'>
                <span class='pretui-section-title'>{{@title}}</span>
              </span>
            {{/if}}
          </div>
          {{#if @summary}}
            <span class='pretui-section-summary'>{{@summary}}</span>
          {{/if}}
          {{#if (has-block 'actions')}}
            <span class='pretui-section-actions'>{{yield to='actions'}}</span>
          {{/if}}
        </div>
      {{/if}}
      <div
        class='pretui-section-region'
        id={{this.regionId}}
        role='group'
        aria-hidden={{unless this.expanded 'true'}}
      >
        <div class='pretui-section-body'>{{yield}}</div>
      </div>
    </section>
    <style scoped>
      .pretui-section {
        display: block;
        container-type: inline-size;
        border-top: 1px solid var(--border);
      }
      .pretui-section:first-of-type {
        border-top: 0;
      }
      .pretui-section-head {
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
        min-height: 32px;
        padding-inline: var(--space-4, 11px);
      }
      .pretui-section-heading {
        flex: 1 1 auto;
        min-width: 0;
      }
      .pretui-section-toggle,
      .pretui-section-static {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        min-height: 32px;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        text-align: start;
        cursor: pointer;
        font: inherit;
      }
      .pretui-section-static {
        cursor: default;
      }
      .pretui-section-toggle:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -1px;
        border-radius: var(--radius-sm, 5px);
      }
      .pretui-section-title {
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-section-toggle:hover .pretui-section-title {
        color: var(--foreground);
      }
      /* The chevron is a CSS triangle, not an icon component: it must sit
         inside a role-bearing button, where remote lint's
         require-presentational-children rejects any svg or component. */
      .pretui-section-chevron {
        flex: none;
        width: 0;
        height: 0;
        margin-inline: 2px 1px;
        border-inline-start: 4px solid currentColor;
        border-block: 3.5px solid transparent;
        color: var(--muted-foreground);
        transform-origin: 25% 50%;
        transition: transform var(--pretui-dur-snap, 160ms)
          var(--pretui-ease-snap, ease);
      }
      .pretui-section[data-open='true'] .pretui-section-chevron {
        transform: rotate(90deg);
      }
      .pretui-section-summary {
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      .pretui-section-actions {
        flex: none;
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .pretui-section-region {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows var(--pretui-dur-snap, 160ms)
          var(--pretui-ease-snap, ease);
      }
      .pretui-section[data-open='false'] .pretui-section-region {
        grid-template-rows: 0fr;
      }
      .pretui-section-region > .pretui-section-body {
        overflow: hidden;
        min-height: 0;
      }
      .pretui-section[data-open='true'] > .pretui-section-region
        > .pretui-section-body {
        /* Once open, stop clipping so a dropdown inside a row can escape. */
        overflow: visible;
        padding: 2px var(--space-4, 11px) var(--space-3, 8px);
      }
      .pretui-section[data-open='false'] .pretui-section-body {
        padding-inline: var(--space-4, 11px);
      }
      /* ── Nested groups ────────────────────────────────────────────────
         A group inside a group must not read as its peer. Upstream has no
         representation for depth at all, and the source panel this was
         checked against expressed it purely as left padding — which reads
         as "slightly misaligned" rather than "contained". The hairline
         goes (it is the peer separator), the heading stops shouting in
         small-caps, and the body hangs off a vertical rule that makes the
         containment visible in a still frame. */
      .pretui-section:not([data-depth='0']) {
        border-top: 0;
        margin-block-start: 2px;
      }
      .pretui-section:not([data-depth='0']) .pretui-section-head {
        min-height: 26px;
        padding-inline: 0;
      }
      .pretui-section:not([data-depth='0']) .pretui-section-title {
        font-size: var(--text-ui, 12px);
        font-weight: 600;
        letter-spacing: var(--track-ui, 0.01em);
        text-transform: none;
        color: var(--foreground);
      }
      .pretui-section:not([data-depth='0'])[data-open='true']
        > .pretui-section-region
        > .pretui-section-body {
        padding: 1px 0 var(--space-2, 6px) var(--space-3, 8px);
        margin-inline-start: 5px;
        border-inline-start: 1px solid var(--border);
      }
      .pretui-section:not([data-depth='0'])[data-open='false']
        .pretui-section-body {
        padding-inline: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-section-region,
        .pretui-section-chevron {
          transition: none;
        }
      }
    </style>
  </template>
}
