// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ GridPlacementField — Per-card placement within a Layout grid.
// Stores grid position (col, row) and span (colSpan, rowSpan).

import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api'; // ²
import StringField from 'https://cardstack.com/base/string'; // ³
import NumberField from 'https://cardstack.com/base/number'; // ⁴
import { or } from '@cardstack/boxel-ui/helpers'; // ⁵ᵃ

export class GridPlacementField extends FieldDef { // ⁵
  static displayName = 'Grid Placement';

  @field index = contains(NumberField);      // ⁶ which card in linksToMany
  @field col = contains(NumberField);        // ⁷ 1-based column start
  @field row = contains(NumberField);        // ⁸ 1-based row start
  @field colSpan = contains(NumberField);    // ⁹ columns to span (default 1)
  @field rowSpan = contains(NumberField);    // ¹⁰ rows to span (default 1)
  @field format = contains(StringField);     // ¹¹ fitted | embedded | isolated
  @field hidden = contains(StringField);     // ¹² "true" if hidden

  static embedded = class Embedded extends Component<typeof GridPlacementField> { // ¹³
    <template>
      <span class="placement-pill">
        {{if @model.index @model.index 0}}
        <span class="placement-pos">
          c{{if @model.col @model.col 1}}r{{if @model.row @model.row 1}}
        </span>
        {{#if (or @model.colSpan @model.rowSpan)}}
          <span class="placement-span">
            {{if @model.colSpan @model.colSpan 1}}&times;{{if @model.rowSpan @model.rowSpan 1}}
          </span>
        {{/if}}
      </span>
      <style scoped>
        .placement-pill {
          display: inline-flex;
          gap: 4px;
          padding: 2px 6px;
          font-size: 10px;
          font-family: var(--font-mono, monospace);
          color: var(--muted-foreground, #64748b);
          background: var(--muted, #f1f5f9);
          border-radius: var(--boxel-border-radius-xs, 4px);
        }
        .placement-pos {
          font-weight: 600;
        }
        .placement-span {
          opacity: 0.7;
        }
      </style>
    </template>
  };
}
