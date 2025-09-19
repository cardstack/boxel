import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import UserIcon from '@cardstack/boxel-icons/user';
import Avatar from '../fields/avatar';
import AvatarCreatorComponent from './components/avatar-creator';
import { AvataaarsModel } from '../external/avataar-utils';

class IsolatedTemplate extends Component<typeof AvatarCreator> {
  // Convert avatar field to the format expected by the component
  get avatarModel() {
    return {
      topType: this.args.model.avatar?.topType,
      accessoriesType: this.args.model.avatar?.accessoriesType,
      hairColor: this.args.model.avatar?.hairColor,
      facialHairType: this.args.model.avatar?.facialHairType,
      clotheType: this.args.model.avatar?.clotheType,
      eyeType: this.args.model.avatar?.eyeType,
      eyebrowType: this.args.model.avatar?.eyebrowType,
      mouthType: this.args.model.avatar?.mouthType,
      skinColor: this.args.model.avatar?.skinColor,
    };
  }

  updateAvatar = (model: AvataaarsModel) => {
    this.args.model.avatar = new Avatar(model);
  };

  <template>
    <AvatarCreatorComponent
      @model={{this.avatarModel}}
      @context={{@context}}
      @onUpdate={{this.updateAvatar}}
    />
  </template>
}

export class AvatarCreator extends CardDef {
  static displayName = 'Avatar Creator';
  static icon = UserIcon;
  static prefersWideFormat = true;

  @field avatar = contains(Avatar, {
    description: 'Avatar appearance configuration',
  });

  @field title = contains(StringField, {
    computeVia: function (this: AvatarCreator) {
      return 'Avatar';
    },
  });

  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: AvatarCreator) {
      return this.avatar?.thumbnailURL || '';
    },
  });

  static isolated = IsolatedTemplate;
}
