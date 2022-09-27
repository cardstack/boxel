import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import CardContainer from 'https://cardstack.com/base/card-container';
import { BlogPerson } from './blog-person';

export class BlogPost extends Card {
  @field author = contains(BlogPerson);
  @field title = contains(StringCard);
  @field body = contains(TextAreaCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}}>
        <h1><@fields.title/></h1>
        <h3>by <@fields.author/></h3>
        <p><@fields.body/></p>
      </CardContainer>
    </template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}}>
        <em><@fields.title/></em> by <@fields.author/>
      </CardContainer>
    </template>
  }
}
