import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import StringField from 'https://cardstack.com/base/string';
import {
  MaybeBase64Field,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

export class PuppyCard extends CardDef {
  static displayName = 'Puppy Card';
  @field name = contains(StringField);
  @field picture = contains(Base64ImageField);
  @field title = contains(StringField, {
    computeVia: function (this: PuppyCard) {
      return this.name;
    },
  });
  @field thumbnailURL = contains(MaybeBase64Field, {
    computeVia: function (this: PuppyCard) {
      return this.picture.base64;
    },
  });
}
