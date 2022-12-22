import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { CardContainer } from '@cardstack/boxel-ui';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';

let styles = initStyleSheet(`
  this {
    padding: var(--boxel-sp);
  }
`);

export class Contact extends Card {
  @field fullName = contains(StringCard);
  @field preferredName = contains(StringCard);
  @field jobTitle = contains(StringCard);
  @field email = contains(StringCard); // email format
  @field phone = contains(StringCard); // phone number format
  @field cardXYZ = contains(StringCard);
  @field notes = contains(TextAreaCard);
  @field imageURL = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h3><@fields.fullName/></h3>
        <@fields.email/>
      </CardContainer>
    </template>
  }
}
