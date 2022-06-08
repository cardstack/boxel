import { contains, field, Component, Card } from '//cardstack.com/base/card-api';
import StringCard from '//cardstack.com/base/string';
import TextAreaCard from '//cardstack.com/base/text-area';
import { Person } from './person';

let imageURL = new URL('./logo.png', import.meta.url).href;

export class Post extends Card {
  @field author = contains(Person);
  @field title = contains(StringCard);
  @field body = contains(TextAreaCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title/><img src="{{imageURL}}"></h1>
      <h3>by <@fields.author/></h3>
      <p><@fields.body/></p>
    </template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <em><@fields.title/></em> by <@fields.author/>
    </template>
  }
}
