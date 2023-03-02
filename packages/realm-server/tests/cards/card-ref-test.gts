import {
  contains,
  field,
  Component,
  Card,
} from 'https://cardstack.com/base/card-api';
import CardRefCard from 'https://cardstack.com/base/card-ref';

export class TestCard extends Card {
  @field ref = contains(CardRefCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.ref />
    </template>
  };
}
