// Boxel UI Components
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

// Base Card API
import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import ColorField from 'https://cardstack.com/base/color';
import NumberField from 'https://cardstack.com/base/number';
import UrlField from 'https://cardstack.com/base/url';

// Local imports
import ImageField from '../../fields/image';
import { createOptionSelectField } from '../../utils/create-option-select';

const BackgroundTypeField = createOptionSelectField({
  displayName: 'Background Type',
  options: ['solid', 'gradient', 'image'],
  view: 'boxel-select',
  placeholder: 'Select background type',
});

const GradientDirectionField = createOptionSelectField({
  displayName: 'Gradient Direction',
  options: [
    { label: 'Left to Right', value: 'to right' },
    { label: 'Top to Bottom', value: 'to bottom' },
    { label: 'Diagonal', value: '135deg' },
    { label: 'Diagonal Reverse', value: '45deg' },
  ],
  view: 'boxel-select',
  placeholder: 'Select direction',
});

export class BackgroundElement extends FieldDef {
  static displayName = 'Background';

  @field type = contains(BackgroundTypeField);
  @field primaryColor = contains(ColorField);
  @field secondaryColor = contains(ColorField);
  @field gradientDirection = contains(GradientDirectionField);
  @field image = contains(ImageField);
  @field imageUrl = contains(UrlField); // optional override
  @field imageScale = contains(NumberField);
  @field imagePositionX = contains(NumberField);
  @field imagePositionY = contains(NumberField);

  static edit = class Edit extends Component<typeof this> {
    get imageScale() {
      return this.args.model?.imageScale ?? 100;
    }

    get imagePositionX() {
      return this.args.model?.imagePositionX ?? 50;
    }

    get imagePositionY() {
      return this.args.model?.imagePositionY ?? 50;
    }

    updateImageScale = (value: string) => {
      const numValue = parseInt(value, 10);
      if (this.args.model) {
        this.args.model.imageScale = numValue;
      }
    };

    updateImagePositionX = (value: string) => {
      const numValue = parseInt(value, 10);
      if (this.args.model) {
        this.args.model.imagePositionX = numValue;
      }
    };

    updateImagePositionY = (value: string) => {
      const numValue = parseInt(value, 10);
      if (this.args.model) {
        this.args.model.imagePositionY = numValue;
      }
    };

    <template>
      <div class='background-editor'>
        <div class='field-group'>
          <label>Background Type</label>
          <@fields.type @format='edit' />
        </div>

        {{#if (eq @model.type 'solid')}}
          <div class='field-group'>
            <label>Color</label>
            <@fields.primaryColor @format='edit' />
          </div>
        {{/if}}

        {{#if (eq @model.type 'gradient')}}
          <div class='field-group'>
            <label>Primary Color</label>
            <@fields.primaryColor @format='edit' />
          </div>
          <div class='field-group'>
            <label>Secondary Color</label>
            <@fields.secondaryColor @format='edit' />
          </div>
          <div class='field-group'>
            <label>Gradient Direction</label>
            <@fields.gradientDirection @format='edit' />
          </div>
        {{/if}}

        {{#if (eq @model.type 'image')}}
          <div class='field-group'>
            <label>Background Image</label>
            <@fields.image @format='edit' />
          </div>

          <div class='field-group'>
            <label>Image URL (optional override)</label>
            <@fields.imageUrl @format='edit' />
          </div>
          <div class='field-group'>
            <label>Image Scale (%)</label>
            <div class='range-control'>
              <BoxelInput
                @type='range'
                @value={{this.imageScale}}
                @onInput={{this.updateImageScale}}
                min='50'
                max='200'
                step='1'
              />
              <span class='scale-value'>{{this.imageScale}}%</span>
            </div>
          </div>
          <div class='field-group'>
            <label>Horizontal Position (%)</label>
            <div class='range-control'>
              <BoxelInput
                @type='range'
                @value={{this.imagePositionX}}
                @onInput={{this.updateImagePositionX}}
                min='0'
                max='100'
                step='1'
              />
              <span class='position-value'>{{this.imagePositionX}}%</span>
            </div>
          </div>
          <div class='field-group'>
            <label>Vertical Position (%)</label>
            <div class='range-control'>
              <BoxelInput
                @type='range'
                @value={{this.imagePositionY}}
                @onInput={{this.updateImagePositionY}}
                min='0'
                max='100'
                step='1'
              />
              <span class='position-value'>{{this.imagePositionY}}%</span>
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .background-editor {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .field-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .field-group label {
          font-weight: 600;
          font-size: 14px;
          color: #374151;
        }
        .range-control {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .scale-value,
        .position-value {
          font-size: 12px;
          color: #6b7280;
          min-width: 50px;
          text-align: right;
        }
        .upload-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .file-input {
          padding: 8px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 14px;
        }
        .file-info {
          font-size: 12px;
          color: #6b7280;
          padding: 4px 0;
        }
        .button-row {
          display: flex;
          gap: 8px;
        }
        .upload-error {
          font-size: 12px;
          color: #dc2626;
          padding: 8px;
          background: #fee2e2;
          border-radius: 4px;
        }
      </style>
    </template>
  };
}
