import { contains, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { Person } from './person';
import lodash from '//cdn.skypack.dev/lodash';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';

let imageURL = new URL('./logo.png', import.meta.url).href;
let test = lodash.isObject({});
console.log(`{} is object? ${test}`);

let styles = initStyleSheet(`:host { --background-color: #ffcad4; } this { display: contents; }`);

export class Post extends Card {
  @field author = contains(Person);
  @field title = contains(StringCard);
  @field body = contains(TextAreaCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <h1><@fields.title/><img src="{{imageURL}}"></h1>
        <h3>by <@fields.author.firstName/> <@fields.author.lastName/></h3>
        <p><@fields.body/></p>
      </div>
    </template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <em><@fields.title/></em> by <@fields.author.firstName/> <@fields.author.lastName/>
      </div>
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
