import { contains, field, Component, Card } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import TextAreaCard from 'runtime-spike/lib/text-area';
import { BlogPerson } from './blog-person';

export class BlogPost extends Card {
  @field author = contains(BlogPerson);
  @field title = contains(StringCard);
  @field body = contains(TextAreaCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title/></h1>
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
