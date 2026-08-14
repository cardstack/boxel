import { htmlSafe } from '@ember/template';
import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import GaugeIcon from '@cardstack/boxel-icons/gauge';

import { stateColor, type Hue } from './utils/index';

/**
 * How much of something a place or offer can hold, and how that total is
 * carved up before anything is sold or assigned.
 *
 * Capacity is configuration, not live state: the field stores the ceiling and
 * the named slices (a stadium's season-ticket / member / away split, a venue
 * room's theatre vs banquet layouts, a course's staff-reserved seats). What
 * has actually been used against that ceiling is booking data that lives on
 * other cards and changes by the minute — a consumer joins the two at render
 * time. Storing "remaining" here would be storing a derived value that goes
 * stale the moment anyone books.
 *
 * Allocation names are the consumer's vocabulary; the block has no opinion on
 * what a slice is called or how many there are.
 */
export class CapacityAllocationField extends FieldDef {
  static displayName = 'Capacity Allocation';

  @field name = contains(StringField);
  @field quantity = contains(NumberField);

  @field title = contains(StringField, {
    computeVia: function (this: CapacityAllocationField) {
      return this.name ?? 'Allocation';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='alloc'>
        <span class='alloc-name'>{{if @model.name @model.name '—'}}</span>
        <span class='alloc-qty'>{{formatCount @model.quantity}}</span>
      </span>
      <style scoped>
        .alloc {
          display: inline-flex;
          gap: var(--boxel-sp-xs);
          align-items: baseline;
          font-size: var(--boxel-font-size-sm);
        }
        .alloc-name {
          color: var(--foreground, var(--boxel-dark));
        }
        .alloc-qty {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

// The segment palette cycles in a fixed order so the same allocation index
// gets the same hue on every card — a legend the eye can carry between rows.
const SEGMENT_HUES: Hue[] = ['teal', 'blue', 'purple', 'amber', 'pink', 'green'];

// Inline styles carry only computed widths and token-derived colors, never
// user strings.
function htmlSafeStyle(style: string) {
  return htmlSafe(style);
}

function formatCount(n?: number | null): string {
  if (n == null || Number.isNaN(n)) {
    return '—';
  }
  return new Intl.NumberFormat().format(n);
}

interface Segment {
  name: string;
  quantity: number;
  percent: number;
  bg: string;
  ring: string;
}

function segmentsOf(model: {
  total?: number | null;
  allocations?: { name?: string | null; quantity?: number | null }[];
}): Segment[] {
  let total = model.total ?? 0;
  if (total <= 0) {
    return [];
  }
  return (model.allocations ?? [])
    .filter((a) => (a.quantity ?? 0) > 0)
    .map((a, i) => {
      let color = stateColor(SEGMENT_HUES[i % SEGMENT_HUES.length]);
      return {
        name: a.name ?? '—',
        quantity: a.quantity ?? 0,
        percent: Math.min(100, ((a.quantity ?? 0) / total) * 100),
        bg: color.ring,
        ring: color.ring,
      };
    });
}

function allocatedOf(model: {
  allocations?: { quantity?: number | null }[];
}): number {
  return (model.allocations ?? []).reduce(
    (sum, a) => sum + (a.quantity ?? 0),
    0,
  );
}

export default class CapacityField extends FieldDef {
  static displayName = 'Capacity';
  static icon = GaugeIcon;

  @field total = contains(NumberField);
  /** What one unit is, in the consumer's words: seats, rooms, places. */
  @field unit = contains(StringField);
  @field allocations = containsMany(CapacityAllocationField);

  @field allocated = contains(NumberField, {
    computeVia: function (this: CapacityField) {
      return allocatedOf(this);
    },
  });

  @field unallocated = contains(NumberField, {
    computeVia: function (this: CapacityField) {
      return Math.max(0, (this.total ?? 0) - allocatedOf(this));
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: CapacityField) {
      let total = this.total;
      if (total == null) {
        return 'Capacity';
      }
      let unit = this.unit ? ` ${this.unit}` : '';
      return `${formatCount(total)}${unit}`;
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='cap-atom'>
        {{formatCount @model.total}}{{#if @model.unit}}
          <span class='cap-unit'>{{@model.unit}}</span>{{/if}}
      </span>
      <style scoped>
        .cap-atom {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .cap-unit {
          font-weight: 400;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get segments(): Segment[] {
      return segmentsOf(this.args.model);
    }

    get overAllocated(): boolean {
      let total = this.args.model.total ?? 0;
      return total > 0 && allocatedOf(this.args.model) > total;
    }

    get hasBreakdown(): boolean {
      return this.segments.length > 0;
    }

    widthOf = (segment: Segment) => `width: ${segment.percent}%`;
    swatchOf = (segment: Segment) => `background: ${segment.bg}`;

    <template>
      <div class='capacity'>
        {{#if @model.total}}
          <div class='cap-head'>
            <span class='cap-total'>{{formatCount @model.total}}</span>
            {{#if @model.unit}}<span class='cap-unit'>{{@model.unit}}</span>{{/if}}
            {{#if this.overAllocated}}
              <span class='cap-warning'>Allocations exceed total</span>
            {{/if}}
          </div>
          {{#if this.hasBreakdown}}
            <div
              class='cap-bar {{if this.overAllocated "over"}}'
              role='img'
              aria-label='Capacity allocation breakdown'
            >
              {{#each this.segments as |segment|}}
                <span
                  class='cap-segment'
                  style={{htmlSafeStyle (this.widthOf segment)}}
                  title='{{segment.name}}: {{formatCount segment.quantity}}'
                ><span
                    class='cap-fill'
                    style={{htmlSafeStyle (this.swatchOf segment)}}
                  /></span>
              {{/each}}
            </div>
            <ul class='cap-legend'>
              {{#each this.segments as |segment|}}
                <li class='cap-row'>
                  <span
                    class='cap-swatch'
                    style={{htmlSafeStyle (this.swatchOf segment)}}
                  />
                  <span class='cap-name'>{{segment.name}}</span>
                  <span class='cap-qty'>{{formatCount segment.quantity}}</span>
                </li>
              {{/each}}
              {{#if @model.unallocated}}
                <li class='cap-row cap-row-rest'>
                  <span class='cap-swatch cap-swatch-rest' />
                  <span class='cap-name'>Unallocated</span>
                  <span class='cap-qty'>{{formatCount @model.unallocated}}</span>
                </li>
              {{/if}}
            </ul>
          {{/if}}
        {{else}}
          <p class='cap-empty'>No capacity set</p>
        {{/if}}
      </div>
      <style scoped>
        .capacity {
          font-family: var(--font-sans, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
        }
        .cap-head {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-4xs);
        }
        .cap-total {
          font-size: var(--boxel-font-size);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .cap-unit {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .cap-warning {
          margin-left: auto;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--boxel-danger);
        }
        .cap-bar {
          display: flex;
          height: 0.5rem;
          border-radius: 999px;
          overflow: hidden;
          background: var(--muted, var(--boxel-100));
        }
        .cap-bar.over {
          outline: 1px solid var(--boxel-danger);
          outline-offset: 1px;
        }
        .cap-segment {
          display: block;
          height: 100%;
        }
        .cap-fill {
          display: block;
          height: 100%;
          /* Full-strength hue would shout; the mix keeps segments legible as
             a group while staying inside the token system. */
          opacity: 0.75;
        }
        .cap-legend {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cap-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-font-size-xs);
        }
        .cap-swatch {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 2px;
          flex: none;
          opacity: 0.75;
        }
        .cap-swatch-rest {
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-200));
        }
        .cap-name {
          color: var(--foreground, var(--boxel-dark));
        }
        .cap-qty {
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .cap-row-rest .cap-name {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .cap-empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
