// Pretui — structure territory: surfaces, the panel signature, navigation.
// Translated from pretui-design-system (components/structure + css/structure.css).
// Realm adaptations: Tooltip is CSS-only (hover/focus-within — prerender-safe);
// Menu closes via backdrop, not a document listener.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { modifier } from 'ember-modifier';
import { listen, listenDocumentCapture } from './focus';
import { cssDeclaration, cssStyleFrom } from './pretui-css';

// The element a Tooltip describes. The trigger arrives as a caller block, so
// the component finds it rather than receiving it — the first thing in the
// wrapper the keyboard can reach, falling back to the wrapper's first element
// child for a non-focusable trigger (a static badge, a truncated cell).
const TRIGGER_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex], [role]';

export interface PanelSignature {
  Args: {
    title?: string;
    eyebrow?: string;
    /**
     * 'card' (default) is the reading surface: padded body, header floating
     * on the same ground. 'inspector' is the design-tool shell ported from
     * figui3's `fig-header` / `fig-content` / `fig-footer` trio — flush
     * body so `PanelSection` hairlines run edge to edge, a header and
     * footer separated by hairlines, and a container context so the
     * `PropertyRow` fold resolves against the panel rather than the page.
     */
    variant?: 'card' | 'inspector';
    /**
     * Scroll the body instead of growing. The caller supplies the height
     * (`style='height: 100%'`, a grid row, a fixed rail); this only makes
     * the body the part that scrolls, with header and footer pinned.
     */
    scroll?: boolean;
  };
  Blocks: {
    default: [];
    /** replaces the generated title header entirely — for a header that
     * carries controls (a target picker, a close button) */
    header: [];
    status: [];
    actions: [];
  };
  Element: HTMLElement;
}

// The system signature: body + hairline + action bar (status left, actions right).
export const Panel: TemplateOnlyComponent<PanelSignature> = <template>
  <section
    class='pretui-panel'
    data-variant={{if @variant @variant 'card'}}
    data-scroll={{if @scroll 'true'}}
    data-test-pretui-panel
    ...attributes
  >
    {{#if (has-block 'header')}}
      <header class='pretui-panel-header'>{{yield to='header'}}</header>
    {{else if @title}}
      <header class='pretui-panel-header'>
        {{#if @eyebrow}}<span class='pretui-eyebrow'>{{@eyebrow}}</span>{{/if}}
        <h2>{{@title}}</h2>
      </header>
    {{/if}}
    <div class='pretui-panel-body'>{{yield}}</div>
    {{! Defect fixed 2026-08-13: the footer was gated on the `status` block
        alone, so a Panel supplying only <:actions> rendered no footer and
        silently dropped its buttons. }}
    {{#if (has-block 'status')}}
      <footer class='pretui-panel-footer'>
        <span class='pretui-panel-status'>{{yield to='status'}}</span>
        <span class='pretui-panel-actions'>{{yield to='actions'}}</span>
      </footer>
    {{else if (has-block 'actions')}}
      <footer class='pretui-panel-footer'>
        <span class='pretui-panel-status'></span>
        <span class='pretui-panel-actions'>{{yield to='actions'}}</span>
      </footer>
    {{/if}}
  </section>
  <style scoped>
    .pretui-panel {
      background: var(--card);
      border-radius: var(--radius-surface, 10px);
      box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pretui-panel-header {
      padding: var(--space-4, 11px) var(--space-5, 14px) 0;
      display: grid;
      gap: 2px;
    }
    .pretui-panel-header h2 {
      margin: 0;
      font-size: var(--text-body, 15px);
      font-weight: 600;
      letter-spacing: var(--track-heading, -0.02em);
    }
    .pretui-eyebrow {
      font-family: var(--font-mono);
      font-size: var(--text-ui-xs, 11px);
      font-weight: 500;
      letter-spacing: var(--track-eyebrow, 0.08em);
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
    .pretui-panel-body {
      padding: var(--space-5, 14px);
    }
    .pretui-panel-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3, 8px);
      padding: var(--space-3, 8px) var(--space-5, 14px);
      box-shadow: 0 -1px 0 var(--border);
    }
    .pretui-panel-status {
      font-size: var(--text-ui, 12px);
      color: var(--muted-foreground);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pretui-panel-actions {
      display: flex;
      align-items: center;
      gap: var(--space-3, 8px);
    }
    /* ── inspector variant (design-tools shell) ───────────────────────── */
    .pretui-panel[data-variant='inspector'] {
      /* An inspector's rows fold against the PANEL width, never the
         viewport. Unnamed container only — a named one silently deletes
         every rule after it in the transpiled sheet. */
      container-type: inline-size;
    }
    .pretui-panel[data-variant='inspector'] .pretui-panel-header {
      padding: var(--space-3, 8px) var(--space-4, 11px);
      box-shadow: 0 1px 0 var(--border);
    }
    .pretui-panel[data-variant='inspector'] .pretui-panel-header h2 {
      font-size: var(--text-ui-md, 12.5px);
    }
    /* Flush, so PanelSection hairlines run edge to edge. */
    .pretui-panel[data-variant='inspector'] .pretui-panel-body {
      padding: 0;
    }
    .pretui-panel[data-variant='inspector'] .pretui-panel-footer {
      padding: var(--space-2, 6px) var(--space-4, 11px);
    }
    /* ── scrolling body ───────────────────────────────────────────────── */
    .pretui-panel[data-scroll='true'] {
      min-height: 0;
    }
    .pretui-panel[data-scroll='true'] .pretui-panel-header,
    .pretui-panel[data-scroll='true'] .pretui-panel-footer {
      flex: none;
    }
    .pretui-panel[data-scroll='true'] .pretui-panel-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
  </style>
</template>;

export interface ToolbarSignature {
  Args: { title?: string; eyebrow?: string; meta?: string };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const Toolbar: TemplateOnlyComponent<ToolbarSignature> = <template>
  <div class='pretui-toolbar' data-test-pretui-toolbar ...attributes>
    <div class='pretui-toolbar-id'>
      {{#if @eyebrow}}<span class='pretui-eyebrow'>{{@eyebrow}}</span>{{/if}}
      {{#if @title}}<h2>{{@title}}</h2>{{/if}}
      {{#if @meta}}<span class='pretui-toolbar-meta'>{{@meta}}</span>{{/if}}
    </div>
    <div class='pretui-toolbar-actions'>{{yield}}</div>
  </div>
  <style scoped>
    .pretui-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4, 11px);
      min-height: 44px;
    }
    .pretui-toolbar-id {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .pretui-toolbar-id h2 {
      margin: 0;
      font-size: var(--text-heading, 19px);
      font-weight: var(--weight-heading, 700);
      letter-spacing: var(--track-heading, -0.02em);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pretui-eyebrow {
      font-family: var(--font-mono);
      font-size: var(--text-ui-xs, 11px);
      font-weight: 500;
      letter-spacing: var(--track-eyebrow, 0.08em);
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
    .pretui-toolbar-meta {
      font-size: var(--text-ui-sm, 11.5px);
      color: var(--muted-foreground);
    }
    .pretui-toolbar-actions {
      display: flex;
      align-items: center;
      gap: var(--space-3, 8px);
      flex: none;
    }
  </style>
</template>;

export interface TooltipSignature {
  Args: {
    content: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    /**
     * Name the trigger instead of describing it. `aria-describedby` is the
     * APG recommendation and the default here; Web Awesome deliberately ships
     * `aria-labelledby` because several screen readers announce a description
     * inconsistently (or not at all) on a control that already has a name.
     * Set this when the tooltip text IS the control's name — an icon-only
     * button whose only label is its tip.
     */
    labels?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * Always-dark (both modes — "the lining").
 *
 * **Rebuilt 2026-08-13.** The previous version carried `role='tooltip'` and
 * nothing else: no id, no `aria-describedby`, and the bubble sat in the DOM
 * permanently with only `opacity` animated — so its text was read as ambient
 * page content next to every trigger, forever, and no assistive technology
 * could tell it apart from the trigger's own content. It also failed two of
 * WCAG 1.4.13's three conditions: not dismissible (no Escape) and not
 * hoverable (`pointer-events: none`, so a magnified reader could never move
 * onto the bubble).
 *
 * What it does now:
 *
 * - **Association.** The bubble gets a generated id and a modifier wires
 *   `aria-describedby` (or `aria-labelledby` with `@labels`) onto the first
 *   focusable descendant — the trigger is a caller block, so the component
 *   cannot put the attribute there itself. The modifier restores whatever was
 *   there before on teardown, so it composes with a caller's own value.
 * - **Presence.** Hidden state is `visibility: hidden`, not opacity alone, so
 *   the bubble leaves the accessibility tree between reveals. A directly
 *   referenced `aria-describedby` target is still announced while hidden —
 *   that is the accname rule this pattern is built on.
 * - **Dismissible.** Escape hides it, in the capture phase, while it is open.
 * - **Hoverable.** `pointer-events` are live and a transparent bridge spans
 *   the 6px gap, so the pointer can travel from trigger to bubble.
 *
 * The reveal is state-driven rather than pure CSS because Escape needs a
 * dismissed flag; the state is only ever written from event handlers, never
 * during render.
 */
export class Tooltip extends Component<TooltipSignature> {
  @tracked private hovered = false;
  @tracked private focused = false;
  @tracked private dismissed = false;
  tipId = `${guidFor(this)}-tip`;
  get side() {
    return this.args.side ?? 'top';
  }
  get shown() {
    return (this.hovered || this.focused) && !this.dismissed;
  }
  /** Wires the tip onto the yielded trigger and puts it back on teardown. */
  describeTrigger = modifier(
    (el: HTMLElement, [id, labels]: [string, boolean | undefined]) => {
      let attr = labels ? 'aria-labelledby' : 'aria-describedby';
      let trigger =
        Array.from(el.querySelectorAll<HTMLElement>(TRIGGER_SELECTOR)).find(
          (candidate) => candidate.id !== id,
        ) ?? (el.firstElementChild as HTMLElement | null);
      if (!trigger || trigger.id === id) return;
      let previous = trigger.getAttribute(attr);
      trigger.setAttribute(attr, previous ? `${previous} ${id}` : id);
      return () => {
        if (previous === null) {
          trigger.removeAttribute(attr);
        } else {
          trigger.setAttribute(attr, previous);
        }
      };
    },
  );
  onEnter = () => {
    this.hovered = true;
  };
  onLeave = () => {
    this.hovered = false;
    this.dismissed = false;
  };
  onFocusIn = () => {
    this.focused = true;
  };
  onFocusOut = () => {
    this.focused = false;
    this.dismissed = false;
  };
  // WCAG 1.4.13 "Dismissible". Capture phase + stopPropagation so one Escape
  // means exactly one thing — hide THIS tip — and never also closes the
  // dialog the trigger happens to live in.
  onKey = (e: Event) => {
    if (!this.shown) return;
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.stopPropagation();
    this.dismissed = true;
  };
  <template>
    <span
      class='pretui-tipwrap'
      data-test-pretui-tooltip
      {{this.describeTrigger this.tipId @labels}}
      {{listen 'mouseenter' this.onEnter}}
      {{listen 'mouseleave' this.onLeave}}
      {{listen 'focusin' this.onFocusIn}}
      {{listen 'focusout' this.onFocusOut}}
      ...attributes
    >
      {{yield}}
      <span
        role='tooltip'
        id={{this.tipId}}
        class='pretui-tooltip'
        data-side={{this.side}}
        data-open={{if this.shown 'true'}}
      >{{@content}}</span>
      {{#if this.shown}}
        <span
          class='pretui-tip-key'
          {{listenDocumentCapture 'keydown' this.onKey}}
        ></span>
      {{/if}}
    </span>
    <style scoped>
      .pretui-tipwrap {
        position: relative;
        display: inline-flex;
      }
      .pretui-tip-key {
        display: none;
      }
      .pretui-tooltip {
        position: absolute;
        /* kit stacking scale (pretui-css.gts): a tooltip describes whatever
           is under the pointer, which may be an item inside a dropdown or a
           popover, so it is the highest non-modal tier. */
        z-index: var(--pretui-z-tooltip, 80);
        background: var(--tooltip, var(--boxel-dark));
        color: var(--tooltip-foreground, var(--boxel-light));
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 6px;
        box-shadow: 0 4px 14px var(--shadow-ink-strong, rgb(0 0 0 / 0.16));
        white-space: nowrap;
        width: max-content;
        opacity: 0;
        /* `visibility`, not opacity alone: an opacity-0 bubble is still in
           the accessibility tree and still hit-testable. Hidden here means
           hidden to everyone — while a DIRECT aria-describedby reference
           still resolves its text, which is the whole point. */
        visibility: hidden;
        transition: opacity 120ms ease, visibility 0s linear 120ms;
      }
      .pretui-tooltip[data-open='true'] {
        opacity: 1;
        visibility: visible;
        transition: opacity 120ms ease, visibility 0s;
      }
      /* WCAG 1.4.13 "Hoverable": the pointer must be able to travel onto the
         bubble without it vanishing. The gap between trigger and bubble is
         bridged by a transparent extension of the bubble's own box. */
      .pretui-tooltip::before {
        content: '';
        position: absolute;
        inset: -6px;
      }
      .pretui-tooltip[data-side='top'] {
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
      }
      .pretui-tooltip[data-side='bottom'] {
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
      }
      .pretui-tooltip[data-side='left'] {
        right: calc(100% + 6px);
        top: 50%;
        transform: translateY(-50%);
      }
      .pretui-tooltip[data-side='right'] {
        left: calc(100% + 6px);
        top: 50%;
        transform: translateY(-50%);
      }
    </style>
  </template>
}

// Menu moved to menu.gts in the 2026-08-13 rebuild — it grew submenus,
// toggle/radio items with mixed state, section groups, the full APG keyboard
// contract, the Amazon safe triangle and an aria-disabled fix, and it now
// shares its `MenuNode` tree with `CommandPalette`. Re-exported here so every
// existing `import { Menu } from './structure'` keeps working.
export { Menu, Kbd } from './menu';
export type {
  MenuEntry,
  MenuItemSpec,
  MenuNode,
  MenuSignature,
  CommandNode,
  ToggleNode,
  RadioNode,
  SubmenuNode,
  SectionNode,
} from './menu';

export { EmptyState } from './components/empty-state';
export type { EmptyStateSignature } from './components/empty-state';

export interface SkeletonSignature {
  Args: { width?: string; height?: string };
  Element: HTMLSpanElement;
}

export class Skeleton extends Component<SkeletonSignature> {
  get style() {
    return cssStyleFrom([
      cssDeclaration('--_w', this.args.width ?? '100%'),
      cssDeclaration('--_h', this.args.height ?? '12px'),
    ]);
  }
  <template>
    <span class='pretui-skeleton' style={{this.style}} aria-hidden='true' data-test-pretui-skeleton ...attributes></span>
    <style scoped>
      @keyframes pretui-shimmer {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
      .pretui-skeleton {
        display: block;
        width: var(--_w, 100%);
        height: var(--_h, 12px);
        border-radius: 6px;
        background: linear-gradient(90deg, var(--inset, var(--boxel-100)) 40%, var(--hover, var(--boxel-100)) 50%, var(--inset, var(--boxel-100)) 60%);
        background-size: 200% 100%;
        animation: pretui-shimmer 1.6s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-skeleton {
          animation: none;
        }
      }
    </style>
  </template>
}

export interface PaginationSignature {
  Args: { page?: number; defaultPage?: number; pages: number; onPageChange?: (n: number) => void };
  Element: HTMLElement;
}

export class Pagination extends Component<PaginationSignature> {
  @tracked internal = this.args.defaultPage ?? 1;
  get page() {
    return this.args.page ?? this.internal;
  }
  get list(): (number | '…')[] {
    let out: (number | '…')[] = [];
    for (let i = 1; i <= this.args.pages; i++) {
      if (i === 1 || i === this.args.pages || Math.abs(i - this.page) <= 1) {
        out.push(i);
      } else if (out[out.length - 1] !== '…') {
        out.push('…');
      }
    }
    return out;
  }
  go = (v: number) => {
    let n = Math.max(1, Math.min(this.args.pages, v));
    if (this.args.page === undefined) {
      this.internal = n;
    }
    this.args.onPageChange?.(n);
  };
  isGap = (n: number | '…'): n is '…' => n === '…';
  prev = () => this.go(this.page - 1);
  next = () => this.go(this.page + 1);
  get atStart() {
    return this.page === 1;
  }
  get atEnd() {
    return this.page === this.args.pages;
  }
  isActive = (n: number | '…') => n === this.page;
  <template>
    <nav class='pretui-pagination' aria-label='Pagination' data-test-pretui-pagination ...attributes>
      <button type='button' class='pretui-page' disabled={{this.atStart}} aria-label='Previous' {{on 'click' this.prev}}>‹</button>
      {{#each this.list as |n|}}
        {{#if (this.isGap n)}}
          <span class='pretui-gap'>…</span>
        {{else}}
          <button
            type='button'
            class='pretui-page'
            data-state={{if (this.isActive n) 'active'}}
            aria-current={{if (this.isActive n) 'page'}}
            {{on 'click' (fn this.go n)}}
          >{{n}}</button>
        {{/if}}
      {{/each}}
      <button type='button' class='pretui-page' disabled={{this.atEnd}} aria-label='Next' {{on 'click' this.next}}>›</button>
    </nav>
    <style scoped>
      .pretui-pagination {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-page {
        min-width: 26px;
        height: 26px;
        padding: 0 6px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        font-variant-numeric: tabular-nums;
      }
      .pretui-page:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-page[data-state='active'] {
        background: var(--pretui-selected, var(--boxel-100));
        color: var(--pretui-primary-ink, var(--primary));
        font-weight: 600;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-page:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .pretui-gap {
        color: var(--ink-3, var(--boxel-400));
        padding: 0 4px;
      }
    </style>
  </template>
}

export interface CrumbSpec {
  label: string;
  href?: string;
}

export interface BreadcrumbSignature {
  Args: { items: CrumbSpec[] };
  Element: HTMLElement;
}

export class Breadcrumb extends Component<BreadcrumbSignature> {
  isLast = (index: number) => index === this.args.items.length - 1;
  <template>
    <nav class='pretui-breadcrumb' aria-label='Breadcrumb' data-test-pretui-breadcrumb ...attributes>
      {{#each @items as |item index|}}
        {{#if index}}<span class='sep'>/</span>{{/if}}
        {{#if (this.isLast index)}}
          <b>{{item.label}}</b>
        {{else if item.href}}
          <a href={{item.href}}>{{item.label}}</a>
        {{else}}
          <span>{{item.label}}</span>
        {{/if}}
      {{/each}}
    </nav>
    <style scoped>
      .pretui-breadcrumb {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
      }
      .pretui-breadcrumb b {
        color: var(--foreground);
        font-weight: 500;
      }
      .pretui-breadcrumb a {
        color: inherit;
        text-decoration: none;
      }
      .pretui-breadcrumb a:hover {
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .sep {
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}

// The shadcn / Ant name for EmptyState.
export { EmptyState as Empty } from './components/empty-state';
