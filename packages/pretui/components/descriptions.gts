// Pretui — Descriptions: read-only labeled fields in a responsive grid.
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import type { PretuiSize } from '../pretui-primitives';
import { printValue } from '../internal/reading-listing';
import type { ListingSizeArg } from '../internal/reading-listing';
import { resolveSize } from '../pretui-primitives';

// ═════════════════════════════════════════════════════════════════════════
// Descriptions — the read-only record display
// ═════════════════════════════════════════════════════════════════════════
//
// ALIAS VERDICT, stated here because the question is worth closing:
//   • NOT an alias for `RecordDetail` (forms-record.gts). That is an EDITING
//     machine — a draft batch, one open editor, dirty counts, save/cancel.
//     Different job, different territory.
//   • NOT an alias for `KeyValue` either, though it is the
//     nearest thing. `KeyValue` is a fixed two-column `<dl>`: one pair per
//     row, no borders, no header, no spans, no density, no fold. It stays
//     exactly that and this does not deprecate it — six facts beside a card
//     still want `KeyValue`.
//   • `Descriptions` is the multi-column, optionally bordered record GRID
//     agents type after `Descriptions` in Ant: N pairs per row, per-item
//     `@span`, a title/extra header, and a fold to stacked.
//
// Better than Ant's:
//   • Ant emits a `<table>` for label/value pairs — tabular markup for
//     non-tabular data, with `<th>` label cells only in bordered mode, so the
//     semantics change when you flip a visual flag. This is a `<dl>` with
//     `<div>` grouping (valid HTML since 5.2) in every mode: `<dt>` is the
//     term and `<dd>` the description whether it is bordered or not.
//   • Ant's responsive `column` is a `matchMedia` map against the WINDOW.
//     A card does not know the window. This folds on unnamed container
//     queries against its own inline size — no JS, no client-render gate,
//     and correct inside a 320px pane on a 5K display.
//   • Ant's `Descriptions` has no `aria-*` and no `role` anywhere.

export interface DescriptionsItem {
  /** the term */
  label: string;
  /** the description, when it is plain text. The `<:value>` block wins when
   * one is supplied, so markup never has to be smuggled through a string. */
  value?: string;
  /** how many of the grid's columns this pair takes (default 1). `'fill'`
   * takes the rest of the row. Clamped down when the container folds. */
  span?: number | 'fill';
  /** stable `{{#each}}` key; falls back to the label */
  key?: string;
  /** machine value — mono + tabular numerals (mono is for machine
   * values only) */
  mono?: boolean;
}

interface DescriptionsEntry {
  key: string;
  item: DescriptionsItem;
  index: number;
  span: string;
  mono: string | undefined;
}

export interface DescriptionsSignature {
  Args: {
    /** the label/value pairs, in reading order */
    items: DescriptionsItem[];
    /** pairs per row at full width, 1–4 (default 3 — Ant's default). The
     * container query only ever REDUCES this. */
    columns?: number;
    /** Ant's spelling of `@columns` */
    column?: number;
    /** rule the grid and tint the label cells */
    bordered?: boolean;
    /** `'horizontal'` (default) puts the label beside its value;
     * `'vertical'` puts it above */
    layout?: 'horizontal' | 'vertical';
    /** density — `xs|s|m|l|xl`, `sm`/`md`/`lg` accepted */
    size?: ListingSizeArg;
    /** header text; the `<:title>` block wins over it */
    title?: string;
    /** trailing colon after every label (default false — a bordered grid
     * does not need one, and Ant's `true` default puts a colon on labels
     * that already sit in their own tinted cell) */
    colon?: boolean;
    /** width of the label column in horizontal layout (any CSS length;
     * default `max-content`) */
    labelWidth?: string;
    /** rendered for an item with no value and no `<:value>` block
     * (default '—') */
    placeholder?: string;
  };
  Blocks: {
    /** one description — receives the item and its index. Rendering this
     * block for an item that also has `@value` uses the block. */
    value: [item: DescriptionsItem, index: number];
    /** header, when a string title is not enough */
    title: [];
    /** trailing header slot: an Edit button, a status chip */
    extra: [];
  };
  Element: HTMLDivElement;
}

export class Descriptions extends Component<DescriptionsSignature> {
  get columns(): number {
    let raw = this.args.columns ?? this.args.column ?? 3;
    return Math.min(4, Math.max(1, Math.round(raw)));
  }
  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  get layout(): 'horizontal' | 'vertical' {
    return this.args.layout === 'vertical' ? 'vertical' : 'horizontal';
  }
  get bordered(): string | undefined {
    return this.args.bordered ? 'true' : undefined;
  }
  get colon(): boolean {
    return this.args.colon ?? false;
  }
  get placeholder(): string {
    return this.args.placeholder ?? '—';
  }
  get hasHeader(): boolean {
    return this.args.title !== undefined;
  }

  /** Requested column count and label width ride custom properties on the
   * ROOT, never on the grid: the container query overrides the grid's own
   * `--pretui-desc-cols`, and an inline style on the same element would
   * outrank it. Requesting on the parent and resolving on the child is what
   * makes "the caller asks for 4, the pane only fits 2" resolve to 2. */
  get rootStyle() {
    return cssStyleFrom([
      '--pretui-desc-cols-req: ' + String(this.columns),
      cssDeclaration('--pretui-desc-label-w', this.args.labelWidth),
    ]);
  }

  get entries(): DescriptionsEntry[] {
    let items = this.args.items ?? [];
    return items.map((item, index) => ({
      key: item.key ?? item.label + '#' + String(index),
      item,
      index,
      span: item.span === 'fill' ? 'fill' : String(Math.min(4, Math.max(1, Math.round(item.span ?? 1)))),
      mono: item.mono ? 'true' : undefined,
    }));
  }

  textFor = (item: DescriptionsItem): string =>
    printValue(item.value, this.placeholder);

  <template>
    <div
      class='pretui-desc'
      data-test-pretui-descriptions
      data-size={{this.size}}
      data-layout={{this.layout}}
      data-cols={{this.columns}}
      data-bordered={{this.bordered}}
      style={{this.rootStyle}}
      ...attributes
    >
      {{#if (has-block 'title')}}
        <div class='pretui-desc-head'>
          <div class='pretui-desc-title'>{{yield to='title'}}</div>
          {{#if (has-block 'extra')}}
            <div class='pretui-desc-extra'>{{yield to='extra'}}</div>
          {{/if}}
        </div>
      {{else if this.hasHeader}}
        <div class='pretui-desc-head'>
          <div class='pretui-desc-title'>{{@title}}</div>
          {{#if (has-block 'extra')}}
            <div class='pretui-desc-extra'>{{yield to='extra'}}</div>
          {{/if}}
        </div>
      {{/if}}

      <dl class='pretui-desc-grid'>
        {{#each this.entries key='key' as |entry|}}
          <div
            class='pretui-desc-pair'
            data-span={{entry.span}}
            data-mono={{entry.mono}}
          >
            <dt class='pretui-desc-label'>
              {{entry.item.label}}{{#if this.colon}}<span
                  class='pretui-desc-colon'
                  aria-hidden='true'
                >:</span>{{/if}}
            </dt>
            <dd class='pretui-desc-value'>
              {{#if (has-block 'value')}}
                {{yield entry.item entry.index to='value'}}
              {{else}}
                {{this.textFor entry.item}}
              {{/if}}
            </dd>
          </div>
        {{/each}}
      </dl>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-desc {
          container-type: inline-size;
          min-width: 0;
          color: var(--foreground);
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
        }
        .pretui-desc[data-size='xs'] {
          font-size: 10.5px;
        }
        .pretui-desc[data-size='s'] {
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-desc[data-size='l'] {
          font-size: 14px;
        }
        .pretui-desc[data-size='xl'] {
          font-size: 16px;
        }
        .pretui-desc-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--space-4, 11px);
          margin-block-end: var(--space-4, 11px);
        }
        .pretui-desc-title {
          font-family: var(--font-serif);
          font-size: 1.5em;
          letter-spacing: var(--track-heading, -0.02em);
        }
        .pretui-desc-extra {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          flex: none;
        }
        /* The caller's count is requested on the root and RESOLVED here, so a
           container query below can narrow it. */
        .pretui-desc-grid {
          --pretui-desc-cols: var(--pretui-desc-cols-req, 3);
          display: grid;
          grid-template-columns: repeat(var(--pretui-desc-cols), minmax(0, 1fr));
          margin: 0;
          min-width: 0;
        }
        .pretui-desc-pair {
          min-width: 0;
          padding-block: 0.55em;
          padding-inline: 0;
        }
        .pretui-desc-pair[data-span='2'] {
          grid-column: span 2;
        }
        .pretui-desc-pair[data-span='3'] {
          grid-column: span 3;
        }
        .pretui-desc-pair[data-span='4'] {
          grid-column: span 4;
        }
        .pretui-desc-pair[data-span='fill'] {
          grid-column: 1 / -1;
        }
        .pretui-desc[data-layout='horizontal'] .pretui-desc-pair {
          display: grid;
          grid-template-columns: var(--pretui-desc-label-w, max-content) minmax(0, 1fr);
          column-gap: var(--space-5, 14px);
          align-items: baseline;
        }
        .pretui-desc-label {
          color: var(--muted-foreground);
          font-size: 0.94em;
          line-height: 1.45;
          min-width: 0;
        }
        .pretui-desc-colon {
          margin-inline-start: 1px;
        }
        .pretui-desc-value {
          margin: 0;
          min-width: 0;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .pretui-desc-pair[data-mono='true'] .pretui-desc-value {
          font-family: var(--font-mono);
          font-size: 0.94em;
          font-variant-numeric: tabular-nums;
        }
        /* Unbordered: a hairline under each row, drawn on the pair so it
           follows the fold without a single measurement. */
        .pretui-desc:not([data-bordered]) .pretui-desc-pair {
          box-shadow: inset 0 -1px 0 var(--border);
          padding-inline-end: var(--space-5, 14px);
        }
        .pretui-desc[data-bordered] .pretui-desc-grid {
          border-radius: var(--radius-surface, 10px);
          overflow: hidden;
          box-shadow: 0 0 0 1px var(--line-strong, var(--boxel-400));
          background: var(--card);
        }
        .pretui-desc[data-bordered] .pretui-desc-pair {
          padding: 0;
          box-shadow:
            inset -1px 0 0 var(--border),
            inset 0 -1px 0 var(--border);
        }
        .pretui-desc[data-bordered] .pretui-desc-label {
          background: var(--inset, var(--boxel-100));
          padding: 0.62em var(--space-4, 11px);
          font-weight: 500;
          box-shadow: inset -1px 0 0 var(--border);
        }
        .pretui-desc[data-bordered] .pretui-desc-value {
          padding: 0.62em var(--space-4, 11px);
        }
        .pretui-desc[data-layout='vertical'] .pretui-desc-label {
          display: block;
          margin-block-end: 0.2em;
        }
        /* Unnamed container query only — a NAMED one silently deletes every
           rule that follows it in the transpiled stylesheet. It resolves
           against the .pretui-desc ancestor, so it styles descendants. */
        @container (max-width: 44rem) {
          /* narrows 3 and 4; a request for 1 or 2 is already at or under it */
          .pretui-desc[data-cols='3'] .pretui-desc-grid,
          .pretui-desc[data-cols='4'] .pretui-desc-grid {
            --pretui-desc-cols: 2;
          }
          .pretui-desc-pair[data-span='3'],
          .pretui-desc-pair[data-span='4'] {
            grid-column: 1 / -1;
          }
        }
        @container (max-width: 26rem) {
          /* outweighs the 44rem block's [data-cols] selectors: @container adds no specificity */
          .pretui-desc[data-cols] .pretui-desc-grid {
            --pretui-desc-cols: 1;
          }
          .pretui-desc-pair {
            grid-column: 1 / -1;
          }
          /* The fold: label above value, whatever @layout asked for. Two
             columns of text in a 26rem pane is not a record, it is a wrap. */
          .pretui-desc[data-layout='horizontal'] .pretui-desc-pair {
            display: block;
          }
          .pretui-desc[data-layout='horizontal'] .pretui-desc-label {
            margin-block-end: 0.2em;
          }
          .pretui-desc[data-bordered] .pretui-desc-label {
            box-shadow: inset 0 -1px 0 var(--border);
          }
        }
      }
    </style>
  </template>
}
