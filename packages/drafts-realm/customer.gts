import StringField from 'https://cardstack.com/base/string';
import {
  contains,
  linksTo,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import { ContactCard } from './contact-card';
import DateTimeField from 'https://cardstack.com/base/datetime';

export class Customer extends CardDef {
  static displayName = 'Customer';

  @field name = contains(StringField);
  @field contact = linksTo(ContactCard);
  @field createdAt = contains(DateTimeField);
  @field notes = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@fields.name}}
    </template>
  };
}
