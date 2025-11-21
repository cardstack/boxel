import NumberField from '../../fields/number';

import {
  CardDef,
  field,
  contains,
  type BaseDefConstructor,
  type Field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { getField } from '@cardstack/runtime-common';

export class PercentageNumberPreview extends CardDef {
  /**
   * Percentage Field - Consolidated progress display with multiple visual styles
   *
   * Consolidates old progress-bar and progress-circle into one field type.
   *
   * Configuration options:
   * - type: 'percentage' - REQUIRED
   * - min: number - REQUIRED minimum value
   * - max: number - REQUIRED maximum value
   * - visualStyle?: 'bar' | 'circle' - Visual presentation (default: 'bar')
   * - barStyle?: 'gradient' | 'solid' - Bar appearance (when visualStyle: 'bar')
   * - label?: string - Custom label text
   * - showRange?: boolean - Show min-max range
   * - valueFormat?: 'percentage' | 'fraction' - Display as "75%" or "75 / 100"
   * - decimals?: number - Number of decimal places
   *
   * Size control via CSS custom properties in scoped styles:
   * - --progress-bar-height: Control bar height (e.g., '1.5rem', '12px')
   * - --progress-circle-size: Circle diameter (e.g., '160px', '80px')
   * - --progress-circle-stroke-width: Circle stroke (e.g., 4, 8, 12)
   * - --progress-circle-value-size: Internal text size
   * - --progress-circle-max-size: Max label text size
   */

  @field solidBar = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 100,
        visualStyle: 'bar',
        barStyle: 'solid',
        label: 'Upload',
        valueFormat: 'fraction',
        showRange: true,
      },
    },
  });

  @field gradientBar = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 100,
        visualStyle: 'bar',
        barStyle: 'gradient',
        label: 'Completion',
        showRange: false,
      },
    },
  });

  @field solidCircle = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 100,
        visualStyle: 'circle',
        barStyle: 'solid',
        label: 'Progress',
        valueFormat: 'percentage',
      },
    },
  });

  @field gradientCircle = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 100,
        visualStyle: 'circle',
        barStyle: 'gradient',
        label: 'Progress',
        valueFormat: 'fraction',
      },
    },
  });

  static displayName = 'Percentage Number Preview';
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='fields'>
        <FieldContainer
          @label='Percentage - Progress Bar (visualStyle: bar, barStyle: solid)'
          @icon={{this.getFieldIcon 'solidBar'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.solidBar @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.solidBar @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.solidBar @format='embedded' />
            </FieldContainer>
          </div>
        </FieldContainer>

        <FieldContainer
          @label='Percentage - Progress Bar (visualStyle: bar, barStyle: gradient)'
          @icon={{this.getFieldIcon 'gradientBar'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.gradientBar @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.gradientBar @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.gradientBar @format='embedded' />
            </FieldContainer>
          </div>
        </FieldContainer>
        <FieldContainer
          @label='Percentage - Progress Circle (visualStyle: circle, barStyle: gradient)'
          @icon={{this.getFieldIcon 'circle'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.solidCircle @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.solidCircle @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.solidCircle @format='embedded' />
            </FieldContainer>
          </div>
        </FieldContainer>

        <FieldContainer
          @label='Gradient Circle (visualStyle: circle, barStyle: gradient)'
          @icon={{this.getFieldIcon 'gradientCircle'}}
        >
          <div class='field-formats'>
            <FieldContainer @vertical={{true}} @label='Edit'>
              <@fields.gradientCircle @format='edit' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Atom'>
              <@fields.gradientCircle @format='atom' />
            </FieldContainer>
            <FieldContainer @vertical={{true}} @label='Embedded'>
              <@fields.gradientCircle @format='embedded' />
            </FieldContainer>
          </div>
        </FieldContainer>

      </section>
      <style scoped>
        .fields {
          display: grid;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
        }
        .field-formats {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
      </style>
    </template>
    getFieldIcon = (key: string) => {
      const field: Field<BaseDefConstructor> | undefined = getField(
        this.args.model.constructor!,
        key,
      );
      let fieldInstance = field?.card;
      return fieldInstance?.icon;
    };
  };
}
