// Pretui — Table: the DataGrid shell as a yieldable primitive for custom tables.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// Table — the DataGrid shell as a yieldable primitive (added for the
// freestyle dogfood pass: composite tables that need custom cell content —
// like the Component API table — wear the same cloth as DataGrid without its
// data-driven machinery). Yielded rows/cells are styled via :deep().
export interface TableSignature {
  Args: {
    /** the table's accessible name, rendered as a real `<caption>` */
    caption?: string;
    /** accessible name when there should be no visible caption; lands as
     * `aria-label` on the `<table>` and is dropped when a caption renders */
    label?: string;
  };
  Blocks: { caption: []; head: []; body: [] };
  Element: HTMLDivElement;
}

// The <:caption> block wins over @caption, the way a block wins over its arg
// on Notification, AlertDialog and Card. A caption is the table's name, so
// @label only lands when neither renders.
export const Table: TemplateOnlyComponent<TableSignature> = <template>
  <div class='pretui-tablewrap' data-test-pretui-table ...attributes>
    <table
      class='pretui-table'
      aria-label={{if (has-block 'caption') null (if @caption null @label)}}
    >
      {{#if (has-block 'caption')}}
        <caption class='pretui-table-caption'>{{yield to='caption'}}</caption>
      {{else if @caption}}
        <caption class='pretui-table-caption'>{{@caption}}</caption>
      {{/if}}
      <thead>{{yield to='head'}}</thead>
      <tbody>{{yield to='body'}}</tbody>
    </table>
  </div>
  <style scoped>
    @layer PretComponent {
      .pretui-tablewrap {
        overflow-x: auto;
        min-width: 0;
        max-width: 100%;
        border-radius: var(--radius);
        box-shadow: 0 0 0 1px var(--border);
        background: var(--card);
      }
      .pretui-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--text-ui-md, 12.5px);
        background: var(--card);
      }
      .pretui-table-caption {
        caption-side: top;
        text-align: start;
        padding: 0.62em var(--space-4, 11px);
        color: var(--muted-foreground);
        font-size: 0.94em;
      }
      /* The header band is for column headers only. A row header th in
         the body wears the body-cell rules below. */
      .pretui-table :deep(thead th) {
        position: sticky;
        top: 0;
        z-index: 2;
        height: 30px;
        padding: 0 10px;
        text-align: left;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
        background: var(--inset, var(--boxel-100));
        box-shadow: inset 0 -1px 0 var(--line-strong, var(--boxel-400));
        white-space: nowrap;
      }
      .pretui-table :deep(td),
      .pretui-table :deep(tbody th) {
        padding: 8px 10px;
        vertical-align: top;
        box-shadow: inset 0 -1px 0 var(--border);
      }
      .pretui-table :deep(tbody th) {
        text-align: start;
      }
      .pretui-table :deep(tbody tr:nth-child(even) td),
      .pretui-table :deep(tbody tr:nth-child(even) th) {
        background: var(--stripe, var(--boxel-100));
      }
      .pretui-table :deep(tbody tr:hover td),
      .pretui-table :deep(tbody tr:hover th) {
        background: var(--hover, var(--boxel-100));
      }
    }
  </style>
</template>;
