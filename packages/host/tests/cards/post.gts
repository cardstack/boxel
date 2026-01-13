import {
  contains,
  field,
  linksTo,
  CardDef,
  Component,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

import { PersonField } from './person';
import { Publication } from './publication';

export class Post extends CardDef {
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field author = contains(PersonField);
  @field views = contains(NumberField);
  @field createdAt = contains(DatetimeField);
  @field publication = linksTo(() => Publication);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.cardTitle />
        by
        <@fields.author.firstName />
        (<@fields.author.fullName />)</h1>
    </template>
  };
}

export class PostField extends FieldDef {
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field author = contains(PersonField);
  @field views = contains(NumberField);
  @field createdAt = contains(DatetimeField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.cardTitle />
        by
        <@fields.author.firstName />
        (<@fields.author.fullName />)</h1>
    </template>
  };
}
