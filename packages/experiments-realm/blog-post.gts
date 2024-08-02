import StringCard from 'https://cardstack.com/base/string';
import MarkdownCard from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import { Author } from './author';

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  @field title = contains(StringCard);
  @field slug = contains(StringCard);
  @field body = contains(MarkdownCard);
  @field authorBio = linksTo(Author);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title /> by <@fields.authorBio />
    </template>
  };
}
