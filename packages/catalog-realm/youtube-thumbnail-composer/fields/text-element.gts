// Ember helpers
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

// Boxel UI Components
import { FieldContainer, BoxelInput } from '@cardstack/boxel-ui/components';

// Base Card API
import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';

// Local imports
import { createOptionSelectField } from '../../utils/create-option-select';

const FontFamilyField = createOptionSelectField({
  displayName: 'Font Family',
  options: [
    { label: 'Arial', value: 'Arial, sans-serif' },
    { label: 'Impact', value: 'Impact, sans-serif' },
    { label: 'Comic Sans', value: '"Comic Sans MS", cursive' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Courier', value: '"Courier New", monospace' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Verdana', value: 'Verdana, sans-serif' },
    { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  ],
  view: 'boxel-select',
  placeholder: 'Select font family',
});

const FontWeightField = createOptionSelectField({
  displayName: 'Font Weight',
  options: [
    { label: 'Normal', value: '400' },
    { label: 'Bold', value: '700' },
    { label: 'Extra Bold', value: '900' },
  ],
  view: 'boxel-select',
  placeholder: 'Select font weight',
});

export class TextElement extends FieldDef {
  static displayName = 'Text Element';

  @field content = contains(StringField);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field fontSize = contains(NumberField);
  @field fontFamily = contains(FontFamilyField);
  @field fontWeight = contains(FontWeightField);
  @field color = contains(ColorField);
  @field strokeColor = contains(ColorField);
  @field strokeWidth = contains(NumberField);
  @field rotation = contains(NumberField);
  @field opacity = contains(NumberField);
  @field visible = contains(BooleanField);
  @field layer = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='text-element-preview'>
        <div
          class='preview-text'
          style={{htmlSafe
            (concat
              'font-size: '
              @model.fontSize
              'px; font-family: '
              @model.fontFamily
              '; font-weight: '
              @model.fontWeight
              '; color: '
              @model.color
              '; -webkit-text-stroke: '
              @model.strokeWidth
              'px '
              @model.strokeColor
              '; transform: rotate('
              @model.rotation
              'deg); opacity: '
              @model.opacity
              ';'
            )
          }}
        >
          {{@model.content}}
        </div>
        <div class='preview-info'>
          <span>Position: ({{@model.x}}, {{@model.y}})</span>
          <span>Layer: {{@model.layer}}</span>
        </div>
      </div>

      <style scoped>
        .text-element-preview {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
        }
        .preview-text {
          font-size: 24px;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .preview-info {
          display: flex;
          gap: var(--boxel-sp-sm);
          font-size: var(--boxel-font-xs);
          color: var(--boxel-600);
        }
        .hidden-badge {
          color: var(--boxel-error-200);
          font-weight: 600;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    updateFontSize = (value: string) => {
      if (this.args.model) {
        this.args.model.fontSize = parseInt(value, 10);
      }
    };

    updateStrokeWidth = (value: string) => {
      if (this.args.model) {
        this.args.model.strokeWidth = parseFloat(value);
      }
    };

    updateRotation = (value: string) => {
      if (this.args.model) {
        this.args.model.rotation = parseInt(value, 10);
      }
    };

    updateOpacity = (value: string) => {
      if (this.args.model) {
        this.args.model.opacity = parseFloat(value);
      }
    };

    get fontSize() {
      return this.args.model?.fontSize ?? 48;
    }

    get strokeWidth() {
      return this.args.model?.strokeWidth ?? 0;
    }

    get rotation() {
      return this.args.model?.rotation ?? 0;
    }

    get opacity() {
      return this.args.model?.opacity ?? 1;
    }

    <template>
      <div class='text-element-editor'>
        <FieldContainer @label='Content'>
          <@fields.content @format='edit' />
        </FieldContainer>

        <FieldContainer @label='Font Size'>
          <div class='range-control'>
            <BoxelInput
              @type='range'
              @value={{this.fontSize}}
              @onInput={{this.updateFontSize}}
              min='12'
              max='200'
              step='1'
            />
            <span class='range-value'>{{this.fontSize}}px</span>
          </div>
        </FieldContainer>

        <FieldContainer @label='Font Family'>
          <@fields.fontFamily @format='edit' />
        </FieldContainer>

        <FieldContainer @label='Font Weight'>
          <@fields.fontWeight @format='edit' />
        </FieldContainer>

        <div class='field-row'>
          <FieldContainer @label='Text Color'>
            <@fields.color @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Stroke Color'>
            <@fields.strokeColor @format='edit' />
          </FieldContainer>
        </div>

        <FieldContainer @label='Stroke Width'>
          <div class='range-control'>
            <BoxelInput
              @type='range'
              @value={{this.strokeWidth}}
              @onInput={{this.updateStrokeWidth}}
              min='0'
              max='20'
              step='0.5'
            />
            <span class='range-value'>{{this.strokeWidth}}px</span>
          </div>
        </FieldContainer>

        <div class='field-row'>
          <FieldContainer @label='X Position'>
            <@fields.x @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Y Position'>
            <@fields.y @format='edit' />
          </FieldContainer>
        </div>

        <FieldContainer @label='Rotation'>
          <div class='range-control'>
            <BoxelInput
              @type='range'
              @value={{this.rotation}}
              @onInput={{this.updateRotation}}
              min='-180'
              max='180'
              step='1'
            />
            <span class='range-value'>{{this.rotation}}°</span>
          </div>
        </FieldContainer>

        <div class='field-row'>
          <FieldContainer @label='Layer (Z-Index)'>
            <@fields.layer @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Opacity'>
            <div class='range-control'>
              <BoxelInput
                @type='range'
                @value={{this.opacity}}
                @onInput={{this.updateOpacity}}
                min='0'
                max='1'
                step='0.1'
              />
              <span class='range-value'>{{this.opacity}}</span>
            </div>
          </FieldContainer>
        </div>

        <FieldContainer @label='Visible'>
          <@fields.visible @format='edit' />
        </FieldContainer>
      </div>

      <style scoped>
        .text-element-editor {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }
        .field-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: var(--boxel-sp);
        }
        .range-control {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .range-control input[type='range'] {
          flex: 1;
        }
        .range-value {
          min-width: 60px;
          text-align: right;
          font-size: var(--boxel-font-sm);
          color: var(--boxel-600);
          font-weight: 500;
        }
      </style>
    </template>
  };
}
