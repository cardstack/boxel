import {
  CardDef,
  Component,
  contains,
  field,
  type Field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { BoxelSelect, FieldContainer } from '@cardstack/boxel-ui/components';
import { FieldRenderer } from '../components/field-renderer';
import {
  AnimatedCounterNumberField,
  BadgeNumberField,
  BasicNumberField,
  DualRangeSliderField,
  FormattedNumberField,
  GaugeNumberField,
  MaskedNumberField,
  PercentageNumberField,
  PinNumberField,
  ProgressBarNumberField,
  ProgressCircleNumberField,
  QuantityNumberField,
  RatingNumberField,
  ScoreNumberField,
  SliderNumberField,
  StatNumberField,
  StepperNumberField,
  UnitNumberField,
} from '../fields/number';

type VariantMeta = {
  value: string;
  fieldName: string;
  label: string;
};

const NUMBER_VARIANT_OPTIONS: VariantMeta[] = [
  {
    value: 'animatedCounter',
    fieldName: 'animatedCounter',
    label: AnimatedCounterNumberField.displayName ?? 'Animated Counter Number',
  },
  {
    value: 'badge',
    fieldName: 'badge',
    label: BadgeNumberField.displayName ?? 'Badge Number',
  },
  {
    value: 'basic',
    fieldName: 'basic',
    label: BasicNumberField.displayName ?? 'Basic Number',
  },
  {
    value: 'formatted',
    fieldName: 'formatted',
    label: FormattedNumberField.displayName ?? 'Formatted Number',
  },
  {
    value: 'gauge',
    fieldName: 'gauge',
    label: GaugeNumberField.displayName ?? 'Gauge Number',
  },
  {
    value: 'masked',
    fieldName: 'masked',
    label: MaskedNumberField.displayName ?? 'Masked Number',
  },
  {
    value: 'percentage',
    fieldName: 'percentage',
    label: PercentageNumberField.displayName ?? 'Percentage Number',
  },
  {
    value: 'pin',
    fieldName: 'pin',
    label: PinNumberField.displayName ?? 'PIN Number',
  },
  {
    value: 'progressBar',
    fieldName: 'progressBar',
    label: ProgressBarNumberField.displayName ?? 'Progress Bar Number',
  },
  {
    value: 'progressCircle',
    fieldName: 'progressCircle',
    label: ProgressCircleNumberField.displayName ?? 'Progress Circle Number',
  },
  {
    value: 'quantity',
    fieldName: 'quantity',
    label: QuantityNumberField.displayName ?? 'Quantity Number',
  },
  {
    value: 'range',
    fieldName: 'range',
    label: DualRangeSliderField.displayName ?? 'Dual Range',
  },
  {
    value: 'rating',
    fieldName: 'rating',
    label: RatingNumberField.displayName ?? 'Rating Number',
  },
  {
    value: 'score',
    fieldName: 'score',
    label: ScoreNumberField.displayName ?? 'Score Number',
  },
  {
    value: 'slider',
    fieldName: 'slider',
    label: SliderNumberField.displayName ?? 'Slider Number',
  },
  {
    value: 'stat',
    fieldName: 'stat',
    label: StatNumberField.displayName ?? 'Stat Number',
  },
  {
    value: 'stepper',
    fieldName: 'stepper',
    label: StepperNumberField.displayName ?? 'Stepper Number',
  },
  {
    value: 'unit',
    fieldName: 'unit',
    label: UnitNumberField.displayName ?? 'Unit Number',
  },
];

const DEFAULT_VARIANT_VALUE = NUMBER_VARIANT_OPTIONS[0]?.value ?? 'basic';

export class NumberFieldVariantPreview extends CardDef {
  static displayName = 'Number Field Variant Preview';

  @field variantSelection = contains(StringField);
  @field animatedCounter = contains(AnimatedCounterNumberField, {
    configuration: {
      presentation: {
        label: 'Downloads Today',
      },
    },
  });
  @field badge = contains(BadgeNumberField, {
    configuration: {
      presentation: {
        label: 'Items',
      },
    },
  });
  @field basic = contains(BasicNumberField);
  @field formatted = contains(FormattedNumberField, {
    configuration: {
      presentation: {
        decimals: 2,
        thousandsSeparator: ',',
        decimalSeparator: '.',
      },
    },
  });
  @field gauge = contains(GaugeNumberField, {
    configuration: {
      presentation: {
        label: 'Performance Score',
        helperText: 'Use for scores and thresholds',
        max: 100,
      },
    },
  });
  @field masked = contains(MaskedNumberField, {
    configuration: {
      presentation: {
        maskChar: '*',
        visibleDigits: 4,
      },
    },
  });
  @field percentage = contains(PercentageNumberField);
  @field pin = contains(PinNumberField, {
    configuration: {
      presentation: {
        label: 'Enter PIN',
        length: 4,
        mask: true,
      },
    },
  });
  @field progressBar = contains(ProgressBarNumberField, {
    configuration: {
      presentation: {
        label: 'Project Completion',
        helperText: '8 of 12 tasks completed',
        max: 100,
        valueFormat: 'raw',
      },
    },
  });
  @field progressCircle = contains(ProgressCircleNumberField, {
    configuration: {
      presentation: {
        label: 'Storage Used',
        helperText: '42.5 GB of 50 GB',
        max: 100,
        size: 180,
        strokeWidth: 14,
      },
    },
  });
  @field quantity = contains(QuantityNumberField);
  @field range = contains(DualRangeSliderField);
  @field rating = contains(RatingNumberField);
  @field score = contains(ScoreNumberField, {
    configuration: {
      presentation: {
        label: 'Credit Score',
      },
    },
  });
  @field slider = contains(SliderNumberField);
  @field stat = contains(StatNumberField, {
    configuration: {
      presentation: {
        label: 'Total Revenue',
        prefix: '$',
        delta: 8.3,
        deltaDirection: 'up',
      },
    },
  });
  @field stepper = contains(StepperNumberField);
  @field unit = contains(UnitNumberField, {
    configuration: {
      presentation: {
        units: [
          { value: 'kg', label: 'kg' },
          { value: 'lb', label: 'lb' },
          { value: 'g', label: 'g' },
          { value: 'oz', label: 'oz' },
        ],
        defaultUnit: 'kg',
      },
    },
  });

  static isolated = class Isolated extends Component<
    typeof NumberFieldVariantPreview
  > {
    get variantOptions() {
      return NUMBER_VARIANT_OPTIONS;
    }

    get selectOptions() {
      return this.variantOptions.map((variant) => ({
        label: variant.label,
        value: variant.value,
      }));
    }

    get selectedValue() {
      return this.args.model.variantSelection || DEFAULT_VARIANT_VALUE;
    }

    get selectedOption() {
      return this.selectOptions.find(
        (option) => option.value === this.selectedValue,
      );
    }

    get selectedVariant() {
      return this.variantOptions.find(
        (variant) => variant.value === this.selectedValue,
      );
    }

    get selectedFieldName() {
      return this.selectedVariant?.fieldName;
    }

    get instanceAsCardDef() {
      return this.args.model as unknown as CardDef;
    }

    get fieldsAsFieldMap() {
      return this.args.fields as unknown as { [fieldName: string]: Field };
    }

    selectVariant = (option: { label: string; value: string }) => {
      this.args.model.variantSelection = option.value;
    };

    <template>
      <div class='number-field-variant'>
        <div class='number-field-variant__control'>
          <label
            class='number-field-variant__label'
            for='number-variant-select'
          >
            Choose a number field variant
          </label>
          <BoxelSelect
            id='number-variant-select'
            @options={{this.selectOptions}}
            @selected={{this.selectedOption}}
            @onChange={{this.selectVariant}}
            @placeholder='Select variant'
            @searchField='label'
            @searchEnabled={{true}}
            as |opt|
          >
            {{opt.label}}
          </BoxelSelect>
        </div>

        {{#if this.selectedFieldName}}
          <FieldRenderer
            @instance={{this.instanceAsCardDef}}
            @fieldName={{this.selectedFieldName}}
            @fields={{this.fieldsAsFieldMap}}
            as |field|
          >
            {{#if field}}
              <div class='number-field-variant__preview'>
                <div class='number-field-variant__heading'>
                  {{this.selectedVariant.label}}
                </div>
                <FieldContainer @label='Edit Format'>
                  <field.component @format='edit' />
                </FieldContainer>

                <FieldContainer @label='Atom Format'>
                  <field.component @format='atom' />
                </FieldContainer>
              </div>
            {{else}}
              <div class='number-field-variant__empty'>
                Selected variant could not be rendered.
              </div>
            {{/if}}
          </FieldRenderer>
        {{else}}
          <div class='number-field-variant__empty'>
            Select a variant to preview its edit format.
          </div>
        {{/if}}
      </div>

      <style scoped>
        @layer boxelComponentL1 {
          .number-field-variant {
            display: grid;
            gap: var(--boxel-sp);
            padding: var(--boxel-sp);
            border-radius: var(--boxel-border-radius-lg);
            border: var(--boxel-border-card);
          }
          .number-field-variant__label {
            display: block;
            margin-bottom: var(--boxel-sp-xxs);
            font-weight: 600;
            color: var(--boxel-650);
          }
          .number-field-variant__preview {
            display: grid;
            gap: var(--boxel-sp-sm);
            padding: var(--boxel-sp);
            background: var(--boxel-0);
            border-radius: var(--boxel-border-radius-lg);
            box-shadow: var(--boxel-shadow-sm);
          }
          .number-field-variant__heading {
            font-weight: 600;
            color: var(--boxel-700);
            font-size: var(--boxel-font-size-lg);
          }
          .number-field-variant__empty {
            padding: var(--boxel-sp-sm);
            border-radius: var(--boxel-border-radius);
            background: var(--boxel-100);
            color: var(--boxel-500);
          }
        }
      </style>
    </template>
  };
}
