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
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field featuredPosts = linksToMany(() => Post);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.cardTitle /></h1>
      <h2><@fields.cardDescription /></h2>
    </template>
  };
}
