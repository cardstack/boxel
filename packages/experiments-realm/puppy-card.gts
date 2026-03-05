import Base64ImageField from '@cardstack/base/base64-image';
import StringField from '@cardstack/base/string';
import {
  MaybeBase64Field,
  CardDef,
  field,
  contains,
} from '@cardstack/base/card-api';
import DogIcon from '@cardstack/boxel-icons/dog';

export class PuppyCard extends CardDef {
  static displayName = 'Puppy Card';
  static icon = DogIcon;
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
