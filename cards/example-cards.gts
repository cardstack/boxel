import { string, contains, field, Component, Card } from 'runtime-spike/api';

export class Person extends Card {
  @field firstName = contains(string);
  @field lastName = contains(string);
  static embedded = class Embedded extends Component<typeof this> {
    static template = <template><@fields.firstName/> <@fields.lastName /></template>
  }
  static data = {
    firstName: 'Mango',
    lastName: 'Abdel-Rahman'
  }
}

export class Post extends Card {
  @field author = contains(Person);
  @field title = contains(string);
  @field body = contains(string);
  static isolated = class Isolated extends Component<typeof this> {
    static template = <template>
      <div><@fields.title/> by <@fields.author/></div>
      <p><@fields.body/></p>
    </template>
  }
  static data = {
    author: {
      firstName: 'Mango',
      lastName: 'Abdel-Rahman'
    },
    title: 'Things That I Like to Chew on',
    body: "I like to chew on my toys, my bones, and my daddy's nose"
  }
}
