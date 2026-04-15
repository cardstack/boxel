// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ GridSettingsField — Configuration for a Layout grid.
// Defines columns, rows, gap, padding, and sizing modes.

import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api'; // ²
import StringField from 'https://cardstack.com/base/string'; // ³
import NumberField from 'https://cardstack.com/base/number'; // ⁴

export class GridSettingsField extends FieldDef { // ⁵
  static displayName = 'Grid Settings';

  @field columns = contains(NumberField);       // ⁶ e.g. 4
  @field rows = contains(NumberField);          // ⁷ e.g. 3 (auto-grows beyond this)
  @field gapPx = contains(NumberField);         // ⁸ e.g. 16
  @field paddingPx = contains(NumberField);     // ⁹ e.g. 24
  @field rowHeight = contains(StringField);     // ¹⁰ "200px" | "1fr" | "minmax(200px,1fr)"
  @field columnSizing = contains(StringField);  // ¹¹ "1fr" | "300px 1fr 1fr 300px"

  static embedded = class Embedded extends Component<typeof GridSettingsField> { // ¹²
    <template>
      <div class="grid-settings-summary">
        <span class="setting">
          <span class="label">Grid</span>
          <span class="value">
            {{if @model.columns @model.columns 4}}&times;{{if @model.rows @model.rows 3}}
          </span>
        </span>
        <span class="setting">
          <span class="label">Gap</span>
          <span class="value">{{if @model.gapPx @model.gapPx 16}}px</span>
        </span>
        {{#if @model.rowHeight}}
          <span class="setting">
            <span class="label">Row</span>
            <span class="value">{{@model.rowHeight}}</span>
          </span>
        {{/if}}
      </div>
      <style scoped>
        .grid-settings-summary {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-3xs, 6px);
          font-size: 11px;
          font-family: var(--font-mono, monospace);
        }
        .setting {
          display: inline-flex;
          gap: 3px;
          padding: 2px 6px;
          background: var(--muted, #f1f5f9);
          border-radius: var(--boxel-border-radius-xs, 4px);
        }
        .label {
          color: var(--muted-foreground, #94a3b8);
          font-weight: 500;
        }
        .value {
          color: var(--foreground, #1e293b);
          font-weight: 600;
        }
      </style>
    </template>
  };
}
