// Pretui — Panel: the titled surface that frames a region, with optional eyebrow, meta and action.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

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
