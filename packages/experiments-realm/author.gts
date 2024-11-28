import StringCard from 'https://cardstack.com/base/string';
import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { CardContentContainer } from '@cardstack/boxel-ui/components';
import SquareUser from '@cardstack/boxel-icons/square-user';
import AuthorIcon from '@cardstack/boxel-icons/user';

export class Author extends CardDef {
  static displayName = 'Author Bio';
  static icon = SquareUser;
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Author) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
  @field description = contains(StringCard, {
    computeVia: function (this: Author) {
      return this.body;
    },
  });
  @field photo = contains(Base64ImageField);
  @field body = contains(MarkdownField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContentContainer>
        <h3><@fields.title /></h3>
        <p><@fields.body /></p>
      </CardContentContainer>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.title}}
        <AuthorIcon width='18' height='18' />
        <@fields.title />
      {{/if}}
      <style scoped>
        svg {
          vertical-align: bottom;
        }
      </style>
    </template>
  };
}
