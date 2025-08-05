import {
  Component,
  CardDef,
  linksToMany,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';

import { Post } from './post';

export class Publication extends CardDef {
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field featuredPosts = linksToMany(() => Post);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title /></h1>
      <h2><@fields.description /></h2>
    </template>
  };
}
