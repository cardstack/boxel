import {
  contains,
  linksTo,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Person } from './person';
import FileTextIcon from '@cardstack/boxel-icons/file-text';

let imageURL = new URL('./green-mango.png', import.meta.url).href;

class BasicField extends FieldDef {
  static displayName = 'Basic Field';
  @field cardTitle = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>Title: <@fields.cardTitle /></template>
  };
}

class VeryBasicField extends BasicField {
  static displayName = 'Very Basic Field';
  @field cardDescription = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      Title:
      <@fields.cardTitle />
      Description:
      <@fields.cardDescription />
    </template>
  };
}

export class Post extends CardDef {
  static displayName = 'Post';
  static icon = FileTextIcon;
  @field author = linksTo(Person);
  @field cardTitle = contains(StringField);
  @field body = contains(TextAreaField);
  @field titleRef = contains(VeryBasicField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='container'>
        <h1><@fields.cardTitle /><img
            src='{{imageURL}}'
            aria-hidden='true'
          /></h1>
        <h3>by <@fields.author.firstName /> <@fields.author.lastName /></h3>
        <p><@fields.body /></p>
      </div>
      <style scoped>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <em><@fields.cardTitle /></em>
      by
      <@fields.author.firstName />
      <@fields.author.lastName />
    </template>
  };
}
