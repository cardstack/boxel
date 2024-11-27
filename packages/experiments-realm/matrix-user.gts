import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { GridContainer } from '@cardstack/boxel-ui/components';

import StringField from 'https://cardstack.com/base/string';
import { EmailAddress } from 'https://cardstack.com/base/email';

export class MatrixUser extends CardDef {
  static displayName = 'Matrix User';
  @field username = contains(StringField);
  @field email = contains(EmailAddress);
  //threePids?

  @field title = contains(StringField, {
    computeVia: function (this: MatrixUser) {
      return this.username;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <h3><@fields.username /> </h3>
      </GridContainer>
    </template>
  };
}
