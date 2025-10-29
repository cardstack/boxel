import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UserIcon from '@cardstack/boxel-icons/user';
import { getAvataarsUrl, AvataaarsModel } from '../utils/external/avataar';
import AvatarComponent from './components/avatar';

class EditTemplate extends Component<typeof Avatar> {
  // Convert avatar field to the format expected by the component
  get avatarModel() {
    return {
      topType: this.args.model.topType,
      accessoriesType: this.args.model.accessoriesType,
      hairColor: this.args.model.hairColor,
      facialHairType: this.args.model.facialHairType,
      clotheType: this.args.model.clotheType,
      eyeType: this.args.model.eyeType,
      eyebrowType: this.args.model.eyebrowType,
      mouthType: this.args.model.mouthType,
      skinColor: this.args.model.skinColor,
    };
  }

  updateAvatar = (model: AvataaarsModel) => {
    this.args.model.topType = model.topType;
    this.args.model.accessoriesType = model.accessoriesType;
    this.args.model.hairColor = model.hairColor;
    this.args.model.facialHairType = model.facialHairType;
    this.args.model.clotheType = model.clotheType;
    this.args.model.eyeType = model.eyeType;
    this.args.model.eyebrowType = model.eyebrowType;
    this.args.model.mouthType = model.mouthType;
    this.args.model.skinColor = model.skinColor;
  };

  <template>
    <AvatarComponent
      @model={{this.avatarModel}}
      @context={{@context}}
      @onUpdate={{this.updateAvatar}}
    />
  </template>
}

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

  static embedded = EditTemplate;
  static edit = EditTemplate;
}
