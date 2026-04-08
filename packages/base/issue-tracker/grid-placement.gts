// GridPlacementField — Per-card placement within a Layout grid.
// Stores grid position (col, row)

import { FieldDef, field, contains, Component } from '../card-api';
import BooleanField from '../boolean';
import NumberField from '../number';

export class GridPlacementField extends FieldDef {
  static displayName = 'Grid Placement';

  @field index = contains(NumberField); // which card in linksToMany
  @field col = contains(NumberField); // 1-based column start
  @field row = contains(NumberField); // 1-based row start
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
