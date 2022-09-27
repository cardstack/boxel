import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import CardContainer from 'https://cardstack.com/base/card-container';
import { Person } from './person';
import lodash from '//cdn.skypack.dev/lodash';

let imageURL = new URL('./logo.png', import.meta.url).href;
let test = lodash.isObject({});
console.log(`{} is object? ${test}`);

export class Post extends Card {
  @field author = contains(Person);
  @field title = contains(StringCard);
  @field body = contains(TextAreaCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}}>
        <h1><@fields.title/><img src="{{imageURL}}"></h1>
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

export class BasicCard extends Card {
  @field title = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @label={{@model.constructor.name}}>
        Title: <@fields.title/>
      </CardContainer>
    </template>
  }
}
