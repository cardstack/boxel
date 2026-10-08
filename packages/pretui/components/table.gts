// Pretui — Table: the DataGrid shell as a yieldable primitive for custom tables.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { eq } from '@cardstack/boxel-ui/helpers';

// Table — the DataGrid shell as a yieldable primitive (added for the
// freestyle dogfood pass: composite tables that need custom cell content —
// like the Component API table — wear the same cloth as DataGrid without its
// data-driven machinery). Yielded rows/cells are styled via :deep().
export interface TableSignature {
  Args: {
    /** the table's accessible name, rendered as a real `<caption>` */
    caption?: string;
    /** accessible name when no name is on screen; lands as `aria-label` on
     * the `<table>` and is dropped when a caption or `@labelledBy` names it */
    label?: string;
    /** id of an on-screen element (a heading) that names the table; lands as
     * `aria-labelledby` on the `<table>` and is dropped when a caption renders */
    labelledBy?: string;
    /** false drops the table's own radius and hairline, for a table seated
     * inside a panel that already draws them (default true) */
    framed?: boolean;
  };
  Blocks: { caption: []; head: []; body: [] };
  Element: HTMLDivElement;
}

// The <:caption> block wins over @caption, the way a block wins over its arg
// on Notification, AlertDialog and Card. A caption is the table's name, so
// @labelledBy and @label only land when neither renders, and @labelledBy wins
// over @label, as aria-labelledby does over aria-label.
export const Table: TemplateOnlyComponent<TableSignature> = <template>
  <div
    class='pretui-tablewrap'
    data-framed={{if (eq @framed false) 'false'}}
    data-test-pretui-table
    ...attributes
  >
    <table
      class='pretui-table'
      aria-labelledby={{if
        (has-block 'caption')
        null
        (if @caption null @labelledBy)
      }}
      aria-label={{if
        (has-block 'caption')
        null
        (if @caption null (if @labelledBy null @label))
      }}
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
      /* overflow: auto makes the wrapper the scroll container of the sticky
         header, so the header only sticks once the wrapper itself scrolls
         vertically. A caller bounds it with --pretui-table-max-height; unset,
         the wrapper grows with its rows and the header scrolls away with them. */
      .pretui-tablewrap {
        --pretui-table-head-height: 1.875rem;

        overflow: auto;
        /* a focused cell scrolls clear of the sticky header */
        scroll-padding-block-start: var(--pretui-table-head-height);
        min-width: 0;
        max-width: 100%;
        max-height: var(--pretui-table-max-height, none);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--border);
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .pretui-tablewrap[data-framed='false'] {
        border-radius: 0;
        box-shadow: none;
      }
      .pretui-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--boxel-font-size-xs);
      }
      .pretui-table-caption {
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        text-align: start;
        color: var(--muted-foreground);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
        letter-spacing: var(--boxel-caption-letter-spacing);
      }
      /* The header voice is inherited from thead, so it reaches the column
         headers and never a row header th in the body. */
      .pretui-table thead {
        font-family: var(--font-mono);
        font-size: var(--boxel-ui-label-font-size);
        letter-spacing: var(--boxel-ui-label-letter-spacing);
        text-transform: uppercase;
        white-space: nowrap;
      }
      /* cells wrap, so the body line height clears the 1.4 floor */
      .pretui-table tbody {
        vertical-align: top;
        line-height: var(--boxel-line-height-md);
      }
      /* :deep() only for what the browser's th rule overrides and for what
         doesn't inherit. */
      .pretui-table :deep(thead th) {
        position: sticky;
        top: 0;
        z-index: 2;
        height: var(--pretui-table-head-height);
        padding: 0 var(--boxel-sp-xs);
        text-align: start;
        font-weight: var(--boxel-ui-label-font-weight);
        background-color: var(--inset);
        color: var(--foreground);
        box-shadow: inset 0 -1px 0 var(--border-strong);
      }
      .pretui-table :deep(td),
      .pretui-table :deep(tbody th) {
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        box-shadow: inset 0 -1px 0 var(--border);
      }
      /* the frame (Table's own ring, or the panel a frameless table sits in)
         already draws the bottom edge */
      .pretui-table :deep(tbody tr:last-child td),
      .pretui-table :deep(tbody tr:last-child th) {
        box-shadow: none;
      }
      /* Kept off td: at this specificity it would beat a caller's own td
         alignment in the same layer, such as UsageArgument's right-aligned
         Default column. */
      .pretui-table :deep(tbody th) {
        text-align: start;
      }
      /* on the cells, so a caller that repaints a cell replaces the stripe
         or hover instead of stacking a second one over the row's */
      .pretui-table :deep(tbody tr:nth-child(even) td),
      .pretui-table :deep(tbody tr:nth-child(even) th) {
        background-color: var(--stripe);
        color: var(--foreground);
      }
      @media (hover: hover) {
        .pretui-table :deep(tbody tr:hover td),
        .pretui-table :deep(tbody tr:hover th) {
          background-color: var(--hover);
          color: var(--foreground);
        }
      }
    }
  </style>
</template>;
