// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ KanbanColumnField — Lane configuration for a Kanban board.
// Each column represents a status/category lane.

import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api'; // ²
import StringField from 'https://cardstack.com/base/string'; // ³
import NumberField from 'https://cardstack.com/base/number'; // ⁴

export class KanbanColumnField extends FieldDef { // ⁵
  static displayName = 'Kanban Column';

  @field key = contains(StringField);          // ⁶ unique lane ID (e.g. "todo", "in-progress")
  @field label = contains(StringField);        // ⁷ display name ("To Do", "In Progress")
  @field color = contains(StringField);        // ⁸ header accent color hex (e.g. "#3b82f6")
  @field wipLimit = contains(NumberField);     // ⁹ max cards (0 = unlimited)
  @field collapsed = contains(StringField);    // ¹⁰ "true" if collapsed
  @field sortOrder = contains(NumberField);    // ¹¹ lane display order

  static embedded = class Embedded extends Component<typeof KanbanColumnField> { // ¹²
    <template>
      <span class="column-pill">
        {{#if @model.color}}
          <span class="color-dot" style="background: {{@model.color}}"></span>
        {{/if}}
        <span class="column-label">{{if @model.label @model.label "Untitled"}}</span>
        {{#if @model.wipLimit}}
          <span class="wip-badge">max {{@model.wipLimit}}</span>
        {{/if}}
      </span>
      <style scoped>
        .column-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          font-size: 11px;
          font-family: var(--font-sans, system-ui, sans-serif);
          color: var(--foreground, #1e293b);
          background: var(--muted, #f1f5f9);
          border-radius: var(--boxel-border-radius-xs, 4px);
        }
        .color-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .column-label {
          font-weight: 600;
        }
        .wip-badge {
          font-size: 9px;
          color: var(--muted-foreground, #94a3b8);
          font-weight: 400;
        }
      </style>
    </template>
  };
}
