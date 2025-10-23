import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { StepRangeScroller } from '../components/step-range-scroller';

export class YearRangeField extends FieldDef {
  @field startValue = contains(NumberField);
  @field endValue = contains(NumberField);

  static displayName = 'Year Range';

  static edit = class Edit extends Component<typeof this> {
    <template>
      <StepRangeScroller
        @startValue={{@model.startValue}}
        @endValue={{@model.endValue}}
        @min={{1950}}
        @max={{2020}}
        @interval={{10}}
        @onChange={{this.updateRange}}
      />
    </template>

    updateRange = (values: { startValue: number; endValue: number }) => {
      this.args.model.startValue = values.startValue;
      this.args.model.endValue = values.endValue;
    };
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='year-range-display'>
        <span>{{@model.startValue}}s - {{@model.endValue}}s</span>
      </div>
      <style scoped>
        .year-range-display {
          padding: 0.5rem;
          background: var(--boxel-50);
          border-radius: 0.25rem;
          text-align: center;
          font-weight: 500;
        }
      </style>
    </template>
  };
}
