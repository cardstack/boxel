import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import {
  Card,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import { Author } from './author';

export class BlogPost extends Card {
  @field title = contains(StringCard);
  @field slug = contains(StringCard);
  @field body = contains(TextAreaCard); // TODO: rich text
  @field authorBio = linksTo(Author);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title /> by <@fields.authorBio />
    </template>
  };
}
