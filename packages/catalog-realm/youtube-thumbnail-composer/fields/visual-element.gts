// Ember helpers
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

// Boxel UI Components
import { FieldContainer, BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

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

const VisualElementTypeField = createOptionSelectField({
  displayName: 'Visual Element Type',
  options: ['rectangle', 'circle', 'arrow'],
  view: 'boxel-select',
  placeholder: 'Select element type',
});

export class VisualElement extends FieldDef {
  static displayName = 'Visual Element';

  @field type = contains(VisualElementTypeField);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field rotation = contains(NumberField);
  @field opacity = contains(NumberField);
  @field fillColor = contains(ColorField);
  @field strokeColor = contains(ColorField);
  @field strokeWidth = contains(NumberField);
  @field visible = contains(BooleanField);
  @field layer = contains(NumberField);
  @field iconName = contains(StringField); // for icon type elements

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='visual-element-preview'>
        <div class='preview-shape-container'>
          <div
            class='preview-shape {{@model.type}}'
            style={{htmlSafe
              (concat
                'width: 80px; height: 60px; background: '
                @model.fillColor
                '; border: '
                @model.strokeWidth
                'px solid '
                @model.strokeColor
                '; transform: rotate('
                @model.rotation
                'deg); opacity: '
                @model.opacity
                ';'
              )
            }}
          ></div>
        </div>
        <div class='preview-info'>
          <span class='type-badge'>{{@model.type}}</span>
          <span>{{@model.width}}×{{@model.height}}</span>
          <span>Layer: {{@model.layer}}</span>
          {{#if (not @model.visible)}}
            <span class='hidden-badge'>Hidden</span>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .visual-element-preview {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
        }
        .preview-shape-container {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--boxel-sp);
          background: var(--boxel-200);
          border-radius: var(--boxel-border-radius-sm);
        }
        .preview-shape {
          transition: transform 0.2s;
        }
        .preview-shape.circle {
          border-radius: 50%;
        }
        .preview-shape.arrow {
          clip-path: polygon(
            0% 30%,
            60% 30%,
            60% 0%,
            100% 50%,
            60% 100%,
            60% 70%,
            0% 70%
          );
        }
        .preview-info {
          display: flex;
          gap: var(--boxel-sp-sm);
          font-size: var(--boxel-font-xs);
          color: var(--boxel-600);
          flex-wrap: wrap;
        }
        .type-badge {
          background: var(--boxel-purple-200);
          color: var(--boxel-purple);
          padding: 2px 6px;
          border-radius: var(--boxel-border-radius-xs);
          font-weight: 600;
          text-transform: capitalize;
        }
        .hidden-badge {
          color: var(--boxel-error-200);
          font-weight: 600;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
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

    get strokeWidth() {
      return this.args.model?.strokeWidth ?? 2;
    }

    get rotation() {
      return this.args.model?.rotation ?? 0;
    }

    get opacity() {
      return this.args.model?.opacity ?? 1;
    }

    <template>
      <div class='visual-element-editor'>
        <FieldContainer @label='Element Type'>
          <@fields.type @format='edit' />
        </FieldContainer>

        <div class='field-row'>
          <FieldContainer @label='Width'>
            <@fields.width @format='edit' />
          </FieldContainer>
          <FieldContainer @label='Height'>
            <@fields.height @format='edit' />
          </FieldContainer>
        </div>

        <div class='field-row'>
          <FieldContainer @label='Fill Color'>
            <@fields.fillColor @format='edit' />
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
        .visual-element-editor {
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
