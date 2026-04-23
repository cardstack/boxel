// KanbanColumnField — Lane configuration for a Kanban board.
// Each column represents a status/category lane.

import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import ColorField from 'https://cardstack.com/base/color';

import { cssVar } from '@cardstack/boxel-ui/helpers';

export class KanbanColumnField extends FieldDef {
  static displayName = 'Kanban Column';

  @field key = contains(StringField); // unique lane ID (e.g. "todo", "in-progress")
  @field label = contains(StringField); // display name ("To Do", "In Progress")
  @field color = contains(ColorField); // label accent color hex (e.g. "#3b82f6")
  @field wipLimit = contains(NumberField); // max cards (0 = unlimited)
  @field collapsed = contains(BooleanField);
  @field sortOrder = contains(NumberField); // lane display order

  static embedded = class Embedded extends Component<typeof KanbanColumnField> {
    <template>
      <span class='column-pill'>
        {{#if @model.color}}
          <span
            class='color-dot'
            style={{cssVar kanban-column-label-color=@model.color}}
          />
        {{/if}}
        <span class='column-label'>{{if
            @model.label
            @model.label
            'Untitled'
          }}</span>
        {{#if @model.wipLimit}}
          <span class='wip-badge'>max {{@model.wipLimit}}</span>
        {{/if}}
      </span>
      <style scoped>
        .column-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          font-size: 11px;
          font-family: var(--font-sans);
          color: var(--foreground);
          background: color-mix(in oklab, var(--foreground) 5%, transparent);
          border-radius: var(--boxel-border-radius-xs);
        }
        .color-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          background-color: var(--kanban-column-label-color);
        }
        .column-label {
          font-weight: 600;
        }
        .wip-badge {
          font-size: 9px;
          color: var(--muted-foreground);
          font-weight: 400;
        }
      </style>
    </template>
  };
}
