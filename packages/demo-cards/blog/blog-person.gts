import {
  contains,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class BlogPerson extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName /> <@fields.lastName />
    </template>
  };
  static isolated = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName /> <@fields.lastName />
    </template>
  };
}
