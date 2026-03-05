import {
  contains,
  field,
  linksTo,
  CardDef,
  Component,
  FieldDef,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

import { PersonField } from './person';
import { Publication } from './publication';

export class Post extends CardDef {
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field author = contains(PersonField);
  @field views = contains(NumberField);
  @field createdAt = contains(DateTimeField);
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
  @field createdAt = contains(DateTimeField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.cardTitle />
        by
        <@fields.author.firstName />
        (<@fields.author.fullName />)</h1>
    </template>
  };
}
