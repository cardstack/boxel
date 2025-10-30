import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';

class Embedded extends Component<typeof BoardPosition> {
  get hasValidCustomHeight() {
    return this.args.model.customHeight && this.args.model.customHeight > 0;
  }
  <template>
    <div class='board-position-compact'>
      <span class='position-label'>Position:</span>
      <span class='position-values'>
        {{@model.x}},{{@model.y}}
        •
        {{@model.width}}×{{@model.height}}
        • L{{@model.layer}}
        •
        {{if (eq @model.format 'fitted') 'Fitted' 'Embedded'}}
        {{#if (eq @model.format 'embedded')}}
          {{#if this.hasValidCustomHeight}}
            (custom:
            {{@model.customHeight}}px)
          {{else}}
            (auto:
            {{@model.autoHeight}}px)
          {{/if}}
        {{/if}}
      </span>
    </div>

    <style scoped>
      .board-position-compact {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
        line-height: 1.2;
      }

      .position-label {
        color: #6b7280;
        font-weight: 500;
        flex-shrink: 0;
      }

      .position-values {
        color: #374151;
        font-family:
          'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
          'Courier New', monospace;
        font-size: 0.75rem;
      }
    </style>
  </template>
}

class Edit extends Component<typeof BoardPosition> {
  @action
  updateField(fieldName: string, event: Event) {
    const target = event.target as HTMLInputElement;

    if (fieldName === 'format') {
      // String field
      this.args.model.format = target.value;
      // Set reasonable defaults when switching to fitted
      if (target.value === 'fitted' && !this.args.model.customHeight) {
        this.args.model.customHeight = this.args.model.autoHeight || 200;
      }
    } else {
      // Number field
      const value = parseInt(target.value, 10);
      if (!isNaN(value)) {
        (this.args.model as any)[fieldName] = value;
      }
    }
  }

  <template>
    <div class='board-position-edit'>
      <div class='position-row'>
        <label>
          <span>X:</span>
          <input
            type='number'
            value={{@model.x}}
            {{on 'input' (fn this.updateField 'x')}}
          />
        </label>
        <label>
          <span>W:</span>
          <input
            type='number'
            value={{@model.width}}
            {{on 'input' (fn this.updateField 'width')}}
          />
        </label>

        <label>
          <span>H:</span>
          <input
            type='number'
            value={{@model.customHeight}}
            placeholder={{if
              (eq @model.format 'embedded')
              @model.autoHeight
              ''
            }}
            {{on 'input' (fn this.updateField 'customHeight')}}
          />
          {{#if (eq @model.format 'embedded')}}
            <span class='height-hint'>auto: {{@model.autoHeight}}px</span>
          {{/if}}
        </label>
        <label>
          <span>Y:</span>
          <input
            type='number'
            value={{@model.y}}
            {{on 'input' (fn this.updateField 'y')}}
          />
        </label>
        <label>
          <span>Layer:</span>
          <input
            type='number'
            value={{@model.layer}}
            {{on 'input' (fn this.updateField 'layer')}}
          />
        </label>

        <label>
          <span>Format:</span>
          <input
            type='text'
            value={{@model.format}}
            placeholder='fitted, embedded, or isolated'
            {{on 'input' (fn this.updateField 'format')}}
          />
        </label>
      </div>
    </div>

    <style scoped>
      .board-position-edit {
        font-size: 0.8125rem;
      }

      .position-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .position-row label {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        color: #374151;
        font-weight: 500;
      }

      .position-row label span {
        min-width: 1.5rem;
        font-size: 0.75rem;
        color: #6b7280;
      }

      .position-row input[type='number'] {
        width: 4rem;
        padding: 0.25rem 0.375rem;
        border: 1px solid #d1d5db;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-family:
          'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
          'Courier New', monospace;
      }

      .position-row input[type='number']:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
      }

      .position-row input[type='text'] {
        width: 8rem;
        padding: 0.25rem 0.375rem;
        border: 1px solid #d1d5db;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-family: inherit;
      }

      .position-row input[type='text']:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
      }

      .height-hint {
        font-size: 0.6875rem;
        color: #9ca3af;
        margin-left: 0.25rem;
        white-space: nowrap;
      }
    </style>
  </template>
}

export class BoardPosition extends FieldDef {
  static displayName = 'Board Position';

  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field width = contains(NumberField);
  @field autoHeight = contains(NumberField); // Measured natural height for embedded format
  @field customHeight = contains(NumberField); // User-set height for fitted format
  @field layer = contains(NumberField);
  @field format = contains(StringField); // "fitted" or "embedded"

  // Computed height based on format
  @field height = contains(NumberField, {
    computeVia: function (this: BoardPosition) {
      try {
        if (this.format === 'fitted') {
          return this.customHeight || 200; // Default fitted height
        } else {
          // For embedded: use customHeight if set and > 0, otherwise autoHeight
          return this.customHeight && this.customHeight > 0
            ? this.customHeight
            : this.autoHeight || 120;
        }
      } catch (e) {
        console.error('BoardPosition: Error computing height', e);
        return 120;
      }
    },
  });

  static embedded = Embedded;
  static edit = Edit;
}
