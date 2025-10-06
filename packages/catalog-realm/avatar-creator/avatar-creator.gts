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
import { AvataaarsModel, createRealImage } from '../external/avataar-utils';
import { restartableTask } from 'ember-concurrency';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

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

  createRealImageTask = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('No command context found');
    }
    const sendRequestCommand = new SendRequestViaProxyCommand(commandContext);

    const result = await createRealImage({
      avatar: this.avatarModel, // This is the avatar field
      avatarUrl: this.args.model.thumbnailURL, // This is thumbnailURL field computed from avatar field
      cardInfo: this.args.model.cardInfo,
      sendRequestCommand,
    });

    return result;
  });

  get isImageGenerating() {
    return this.createRealImageTask.isRunning;
  }

  get generatedImage() {
    const result = this.createRealImageTask.lastSuccessful?.value;
    return result?.success && result?.imageUrl ? result.imageUrl : '';
  }

  get errorImageGenerating() {
    const result = this.createRealImageTask.last?.value;
    return result?.success ? '' : result?.error || '';
  }

  <template>
    <AvatarCreatorComponent
      @model={{this.avatarModel}}
      @context={{@context}}
      @onUpdate={{this.updateAvatar}}
      @isImageGenerating={{this.isImageGenerating}}
      @generatedImage={{this.generatedImage}}
      @errorImageGenerating={{this.errorImageGenerating}}
      @onCreateRealImage={{this.createRealImageTask.perform}}
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
