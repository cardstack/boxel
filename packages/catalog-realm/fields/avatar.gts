import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UserIcon from '@cardstack/boxel-icons/user';
import { getAvataarsUrl } from '../components/avatar-creator';

export default class Avatar extends FieldDef {
  static displayName = 'Avatar';
  static icon = UserIcon;

  @field topType = contains(StringField, {
    description: 'Selected hair/top style',
  });

  @field accessoriesType = contains(StringField, {
    description: 'Selected accessories type',
  });

  @field hairColor = contains(StringField, {
    description: 'Selected hair color',
  });

  @field facialHairType = contains(StringField, {
    description: 'Selected facial hair type',
  });

  @field clotheType = contains(StringField, {
    description: 'Selected clothing type',
  });

  @field eyeType = contains(StringField, {
    description: 'Selected eye type',
  });

  @field eyebrowType = contains(StringField, {
    description: 'Selected eyebrow type',
  });

  @field mouthType = contains(StringField, {
    description: 'Selected mouth type',
  });

  @field skinColor = contains(StringField, {
    description: 'Selected skin color',
  });

  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: Avatar) {
      return getAvataarsUrl({
        topType: this.topType,
        accessoriesType: this.accessoriesType,
        hairColor: this.hairColor,
        facialHairType: this.facialHairType,
        clotheType: this.clotheType,
        eyeType: this.eyeType,
        eyebrowType: this.eyebrowType,
        mouthType: this.mouthType,
        skinColor: this.skinColor,
      });
    },
  });
}
