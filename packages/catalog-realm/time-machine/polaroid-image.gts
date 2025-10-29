import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { ImageCard } from '../image-card';
import Polaroid from '../components/polaroid';

class PolaroidImageEmbedded extends Component<typeof PolaroidImage> {
  get caption() {
    return this.args.model.caption;
  }

  <template>
    <Polaroid @caption={{this.caption}} @base64={{@model.data.base64}} />
  </template>
}

class PolaroidImageFitted extends Component<typeof PolaroidImage> {
  get caption() {
    return this.args.model.caption;
  }

  <template>
    <Polaroid @caption={{this.caption}} @base64={{@model.data.base64}} />
  </template>
}

// @ts-ignore - Component type compatibility issue with extended fields
export class PolaroidImage extends ImageCard {
  static displayName = 'Polaroid Image';

  @field caption = contains(StringField);

  static embedded = PolaroidImageEmbedded;
  static isolated = PolaroidImageEmbedded;
  static fitted = PolaroidImageFitted;
}
