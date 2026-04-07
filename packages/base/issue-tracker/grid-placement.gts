// GridPlacementField — Per-card placement within a Layout grid.
// Stores grid position (col, row) and span (colSpan, rowSpan).

import { FieldDef, field, contains, Component } from '../card-api';
import BooleanField from '../boolean';
import enumField from '../enum';
import NumberField from '../number';
import StringField from '../string';

import { or } from '@cardstack/boxel-ui/helpers';

const gridPlacementFormats = [
  { value: 'fitted', label: 'Fitted' },
  { value: 'embedded', label: 'Embedded' },
  { value: 'isolated', label: 'Isolated' },
];

export class GridPlacementField extends FieldDef {
  static displayName = 'Grid Placement';

  @field index = contains(NumberField); // which card in linksToMany
  @field col = contains(NumberField); // 1-based column start
  @field row = contains(NumberField); // 1-based row start
  @field colSpan = contains(NumberField); // columns to span (default 1)
  @field rowSpan = contains(NumberField); // rows to span (default 1)
  @field format = contains(
    enumField(StringField, { options: gridPlacementFormats }),
  );
  @field hidden = contains(BooleanField);

  static embedded = class Embedded extends Component<
    typeof GridPlacementField
  > {
    <template>
      <span class='placement-pill'>
        {{if @model.index @model.index 0}}
        <span class='placement-pos'>
          c{{if @model.col @model.col 1}}r{{if @model.row @model.row 1}}
        </span>
        {{#if (or @model.colSpan @model.rowSpan)}}
          <span class='placement-span'>
            {{if @model.colSpan @model.colSpan 1}}&times;{{if
              @model.rowSpan
              @model.rowSpan
              1
            }}
          </span>
        {{/if}}
      </span>
      <style scoped>
        .placement-pill {
          display: inline-flex;
          gap: 4px;
          padding: 2px 6px;
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--muted-foreground);
          background: var(--muted);
          border-radius: var(--boxel-border-radius-xs);
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
