// Pretui — Table: the DataGrid shell as a yieldable primitive for custom tables.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// Table — the DataGrid shell as a yieldable primitive (added for the
// freestyle dogfood pass: composite tables that need custom cell content —
// like the Component API table — wear the same cloth as DataGrid without its
// data-driven machinery). Yielded rows/cells are styled via :deep().
export interface TableSignature {
  Blocks: { head: []; body: [] };
  Element: HTMLDivElement;
}

export const Table: TemplateOnlyComponent<TableSignature> = <template>
  <div class='pretui-tablewrap' data-test-pretui-table ...attributes>
    <table class='pretui-table'>
      <thead>{{yield to='head'}}</thead>
      <tbody>{{yield to='body'}}</tbody>
    </table>
  </div>
  <style scoped>
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
    .pretui-table :deep(th) {
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
    .pretui-table :deep(td) {
      padding: 8px 10px;
      vertical-align: top;
      box-shadow: inset 0 -1px 0 var(--border);
    }
    .pretui-table :deep(tbody tr:nth-child(even) td) {
      background: var(--stripe, var(--boxel-100));
    }
    .pretui-table :deep(tbody tr:hover td) {
      background: var(--hover, var(--boxel-100));
    }
  </style>
</template>;
