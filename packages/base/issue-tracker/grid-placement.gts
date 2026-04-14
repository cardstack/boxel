// GridPlacementField — Per-card placement within a Layout grid.
// Stores sort position (row) within a column.

import { FieldDef, field, contains, Component } from '../card-api';
import BooleanField from '../boolean';
import NumberField from '../number';

export class GridPlacementField extends FieldDef {
  static displayName = 'Grid Placement';

  @field row = contains(NumberField); // 1-based row start; position in array = card index
  @field hidden = contains(BooleanField);

  static embedded = class Embedded extends Component<
    typeof GridPlacementField
  > {
    <template>
      <span class='placement-pill'>
        <span class='placement-pos'>
          r{{if @model.row @model.row 1}}
        </span>
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
      </style>
    </template>
  };
}
