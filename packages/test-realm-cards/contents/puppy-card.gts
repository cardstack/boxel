import Base64ImageField from '@cardstack/base/base64-image';
import {
  MaybeBase64Field,
  CardDef,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class PuppyCard extends CardDef {
  static displayName = 'Puppy Card';
  @field name = contains(StringField);
  @field picture = contains(Base64ImageField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PuppyCard) {
      return this.name;
    },
  });
  @field cardThumbnailURL = contains(MaybeBase64Field, {
    computeVia: function (this: PuppyCard) {
      return this.picture.base64;
    },
  });
}
