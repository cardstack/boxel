import StringField from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { GridContainer } from '@cardstack/boxel-ui/components';

export class Author extends CardDef {
  static displayName = 'Author Bio';
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
  @field photo = contains(StringField); // TODO: image card
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
