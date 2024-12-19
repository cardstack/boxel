import {
  Component,
  CardDef,
  linksToMany,
  field,
} from 'https://cardstack.com/base/card-api';

import { Post } from './post';

export class Publication extends CardDef {
  @field featuredPosts = linksToMany(() => Post);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title /></h1>
      <h2><@fields.description /></h2>
    </template>
  };
}
