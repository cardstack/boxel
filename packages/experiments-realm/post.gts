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

let imageURL = new URL('./logo.png', import.meta.url).href;

class BasicField extends FieldDef {
  static displayName = 'Basic Field';
  @field title = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      Title: <@fields.title />
    </template>
  };
}

class VeryBasicField extends BasicField {
  static displayName = 'Very Basic Field';
  @field description = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      Title:
      <@fields.title />
      Description:
      <@fields.description />
    </template>
  };
}

export class Post extends CardDef {
  static displayName = 'Post';
  static icon = FileTextIcon;
  @field author = linksTo(Person);
  @field title = contains(StringField);
  @field body = contains(TextAreaField);
  @field titleRef = contains(VeryBasicField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='container'>
        <h1><@fields.title /><img src='{{imageURL}}' aria-hidden='true' /></h1>
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
      <em><@fields.title /></em>
      by
      <@fields.author.firstName />
      <@fields.author.lastName />
    </template>
  };
}
