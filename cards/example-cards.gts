import { contains, field, Component, Card } from 'runtime-spike/lib/card-api'; // TODO should this be considered an external?
import StringCard from 'runtime-spike/lib/string'; // TODO should this be considered an external?

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.firstName/> <@fields.lastName /></template>
  }
}

export class Post extends Card {
  @field author = contains(Person);
  @field title = contains(StringCard);
  @field body = contains(StringCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div><@fields.title/> by <@fields.author/></div>
      <p><@fields.body/></p>
    </template>
  }
}
