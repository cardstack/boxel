import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { Person } from './person';
import lodash from '//cdn.skypack.dev/lodash';

// TODO bring this back after we support import.meta again
// let imageURL = new URL('./logo.png', import.meta.url).href;
let imageURL = new URL('https://assets.website-files.com/6182a59f245e661700a870fc/6182a59f245e66fab1a871f6_chris-f4d9cc447cac8e25d1d56fa73b0b85fd.jpeg');
let test = lodash.isObject({});
console.log(`{} is object? ${test}`);

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

export class BasicCard extends Card {
  @field title = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      Title: <@fields.title/>
    </template>
  }
}
