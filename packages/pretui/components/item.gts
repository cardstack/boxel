// Pretui — Item: one row atom: media, title, description and actions.
import Component from '@glimmer/component';
import type { PretuiSize } from '../pretui-primitives';
import type { ListingSizeArg } from '../internal/reading-listing';
import { resolveSize } from '../pretui-primitives';

// ═════════════════════════════════════════════════════════════════════════
// Item — one row of a listing
// ═════════════════════════════════════════════════════════════════════════
//
// The media object every kit ships: leading slot, title, description, a
// trailing meta column and an actions column. It renders a `<div>`, never an
// `<li>`, so `<List>` can own the `<li>` and `<Item>` can also stand alone
// inside a card, a `<Panel>`, or a `<DataTable>`'s `<:expanded>` block.
//
// Better than Ant's `List.Item.Meta` and MUI's `ListItemText`:
//   • Ant hard-codes `<h4>` for the row title, so every list injects h4s into
//     the page outline regardless of where it sits. This emits a `<span>` and
//     documents `<:title>` as the place to put a real heading if the row IS
//     one. MUI wraps titles in `<Typography>` with no heading semantics at
//     all, which has the opposite failure: a list of section headings that
//     announces as body text.
//   • Both leave the flex-overflow bug open: a long title in a flex row
//     pushes the trailing meta off the end. The fix is applied in full here — `min-width: 0` AND the three
//     truncation declarations, never one without the others.
//   • Ant's `actions` are an `<ul>` of `<li>`s with `<em>` separators, which
//     is list markup used for spacing. Here the actions slot is a plain flex
//     row and the separator is a border.

export interface ItemSignature {
  Args: {
    /** the row's name. `<:title>` wins over it. */
    title?: string;
    /** the supporting line. `<:description>` wins over it. */
    description?: string;
    /** makes the title a link. A row with a single obvious destination
     * should have a real `<a>` — not a click handler on the row. */
    href?: string;
    /** density — `xs|s|m|l|xl`, `sm`/`md`/`lg` accepted */
    size?: ListingSizeArg;
    /** align the leading slot to the first line instead of the block centre
     * — right for a multi-line row, wrong for a single-line one */
    alignStart?: boolean;
    /* NOTE: the wrap at narrow widths is an unnamed container query, which
     * resolves against the nearest ANCESTOR container. Inside `<List>` that
     * is the row, which is already one. Standalone, give the box that holds
     * the Item `container-type: inline-size` or the wrap never fires. */
  };
  Blocks: {
    /** free body content under the title/description */
    default: [];
    /** avatar, icon, thumbnail, checkbox */
    leading: [];
    /** the row's name, when a string is not enough — put a heading here if
     * this row is genuinely a heading in your document */
    title: [];
    /** the supporting line, when a string is not enough */
    description: [];
    /** meta on the inline end: a timestamp, a StatusChip, a count */
    trailing: [];
    /** buttons or a Menu, separated from the meta */
    actions: [];
  };
  Element: HTMLDivElement;
}

export class Item extends Component<ItemSignature> {
  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  get align(): string {
    return this.args.alignStart ? 'start' : 'center';
  }

  <template>
    <div
      class='pretui-item'
      data-test-pretui-item
      data-size={{this.size}}
      data-align={{this.align}}
      ...attributes
    >
      {{#if (has-block 'leading')}}
        <div class='pretui-item-lead'>{{yield to='leading'}}</div>
      {{/if}}

      <div class='pretui-item-body'>
        {{#if (has-block 'title')}}
          <span class='pretui-item-title'>{{yield to='title'}}</span>
        {{else if @title}}
          {{#if @href}}
            <a class='pretui-item-title pretui-item-link' href={{@href}}>{{@title}}</a>
          {{else}}
            <span class='pretui-item-title'>{{@title}}</span>
          {{/if}}
        {{/if}}

        {{#if (has-block 'description')}}
          <span class='pretui-item-desc'>{{yield to='description'}}</span>
        {{else if @description}}
          <span class='pretui-item-desc'>{{@description}}</span>
        {{/if}}

        {{#if (has-block)}}
          <div class='pretui-item-content'>{{yield}}</div>
        {{/if}}
      </div>

      {{#if (has-block 'trailing')}}
        <div class='pretui-item-trail'>{{yield to='trailing'}}</div>
      {{/if}}
      {{#if (has-block 'actions')}}
        <div class='pretui-item-actions'>{{yield to='actions'}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-item {
          display: flex;
          align-items: center;
          gap: var(--pretui-item-gap, var(--space-4, 11px));
          min-width: 0;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
        .pretui-item[data-align='start'] {
          align-items: flex-start;
        }
        .pretui-item[data-size='xs'] {
          font-size: 10.5px;
        }
        .pretui-item[data-size='s'] {
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-item[data-size='l'] {
          font-size: 14px;
        }
        .pretui-item[data-size='xl'] {
          font-size: 16px;
        }
        .pretui-item-lead {
          flex: none;
          display: flex;
          align-items: center;
        }
        /* min-width:0 is half the fix; without the three truncation
           declarations on the text it hard-clips instead of ellipsising
           */
        .pretui-item-body {
          flex: 1 1 auto;
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .pretui-item-title {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }
        .pretui-item-link {
          color: inherit;
          text-decoration: none;
        }
        .pretui-item-link:hover {
          text-decoration: underline;
        }
        .pretui-item-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 3px;
        }
        .pretui-item-desc {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--muted-foreground);
          font-size: 0.94em;
        }
        .pretui-item-content {
          min-width: 0;
          margin-block-start: 2px;
        }
        .pretui-item-trail {
          flex: none;
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          color: var(--muted-foreground);
          font-size: 0.94em;
          font-variant-numeric: tabular-nums;
        }
        .pretui-item-actions {
          flex: none;
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
        }
        /* Unnamed container query on the nearest ancestor container (List's
           row, or whatever the caller made a container). At this width the
           trailing meta wraps under the body rather than crushing the title. */
        @container (max-width: 22rem) {
          .pretui-item {
            flex-wrap: wrap;
          }
          .pretui-item-trail {
            margin-inline-start: auto;
          }
        }
      }
    </style>
  </template>
}
