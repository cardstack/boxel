import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { CardContentContainer } from '@cardstack/boxel-ui/components';

export class Author extends CardDef {
  static displayName = 'Author Bio';
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
  @field description = contains(StringCard, {
    computeVia: function (this: Author) {
      return this.body;
    },
  });
  @field photo = contains(StringCard); // TODO: image card
  @field body = contains(TextAreaCard); // TODO: markdown card

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContentContainer>
        <h3><@fields.title /></h3>
        <p><@fields.body /></p>
      </CardContentContainer>
    </template>
  };
}
