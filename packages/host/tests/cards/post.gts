import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import DatetimeCard from 'https://cardstack.com/base/datetime';
import NumberCard from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

import { PersonField } from './person';

export class Post extends CardDef {
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field author = contains(PersonField);
  @field views = contains(NumberCard);
  @field createdAt = contains(DatetimeCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title />
        by
        <@fields.author.firstName />
        (<@fields.author.fullName />)</h1>
    </template>
  };
}

export class PostField extends FieldDef {
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field author = contains(PersonField);
  @field views = contains(NumberCard);
  @field createdAt = contains(DatetimeCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title />
        by
        <@fields.author.firstName />
        (<@fields.author.fullName />)</h1>
    </template>
  };
}
