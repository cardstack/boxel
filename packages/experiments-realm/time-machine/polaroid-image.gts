import {
  CardDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { ImageCard } from '../image-card';
import Polaroid from '../components/polaroid.gts';

class PolaroidImageEmbedded extends Component<typeof PolaroidImage> {
  get caption() {
    return this.args.model.caption;
  }

  <template>
    <Polaroid @caption={{this.caption}} @base64={{@model.image.data.base64}} />
  </template>
}

class PolaroidImageFitted extends Component<typeof PolaroidImage> {
  get caption() {
    return this.args.model.caption;
  }

  <template>
    <Polaroid @caption={{this.caption}} @base64={{@model.image.data.base64}} />
  </template>
}

export class PolaroidImage extends CardDef {
  static displayName = 'Polaroid Image';

  @field caption = contains(StringField);
  @field image = linksTo(() => ImageCard);

  static embedded = PolaroidImageEmbedded;
  static isolated = PolaroidImageEmbedded;
  static fitted = PolaroidImageFitted;
}
