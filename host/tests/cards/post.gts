import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Person } from "./person";

export class Post extends Card {
  @field title = contains(StringCard);
  @field author = contains(Person);
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.title/> by <@fields.author.firstName/></h1></template>
  }
}