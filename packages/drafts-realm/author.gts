import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import {
  Component,
  Card,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { GridContainer } from '@cardstack/boxel-ui';

export class Author extends Card {
  static displayName = 'Author Bio';
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
  @field photo = contains(StringCard); // TODO: image card
  @field body = contains(TextAreaCard); // TODO: markdown card

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <@fields.firstName />
        <@fields.lastName />
      </GridContainer>
    </template>
  };
}
