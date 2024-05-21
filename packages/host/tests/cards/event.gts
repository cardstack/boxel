import { contains, field } from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';
import DateField from 'https://cardstack.com/base/date';
import StringField from 'https://cardstack.com/base/string';

export class Event extends CardDef {
  @field title = contains(StringField);
  @field venue = contains(StringField);
  @field date = contains(DateField);
}
