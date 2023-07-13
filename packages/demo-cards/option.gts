import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import {
  Component,
  Card,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

export class Option extends Card {
  static displayName = 'Option';
  @field changes = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div
        class='demo-card'
        {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
        ...attributes
      >
        @fields
      </div>
    </template>
  };
}
