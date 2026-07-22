import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

// Exercises the common template shapes: the positional
// `formatDateTime` helper call, and direct interpolation of
// `contains(NumberField)` / `contains(TextAreaField)` values.
export class Event extends CardDef {
  static displayName = 'Event';
  @field when = contains(DatetimeField);
  @field capacity = contains(NumberField);
  @field notes = contains(TextAreaField);
  static isolated = class extends Component<typeof Event> {
    <template>
      <time>{{formatDateTime @model.when 'MMM D'}}</time>
      <span>{{@model.capacity}}</span>
      <p>{{@model.notes}}</p>
    </template>
  };
}
