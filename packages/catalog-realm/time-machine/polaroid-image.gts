import {
  CardDef,
  field,
  contains,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import ImageField from '../fields/image';
import Polaroid from '../components/polaroid';

class PolaroidImageEmbedded extends Component<typeof PolaroidImage> {
  get caption() {
    return this.args.model.caption;
  }

  get imageUrl() {
    return this.args.model.image?.url ?? '';
  }

  <template>
    <Polaroid @caption={{this.caption}} @url={{this.imageUrl}} />
  </template>
}

class PolaroidImageFitted extends Component<typeof PolaroidImage> {
  get caption() {
    return this.args.model.caption;
  }

  get imageUrl() {
    return this.args.model.image?.url ?? '';
  }

  <template>
    <Polaroid @caption={{this.caption}} @url={{this.imageUrl}} />
  </template>
}

// @ts-ignore - Component type compatibility issue with extended fields
export class PolaroidImage extends CardDef {
  static displayName = 'Polaroid Image';

  @field caption = contains(StringField);
  @field image = contains(ImageField);

  static embedded = PolaroidImageEmbedded;
  static isolated = PolaroidImageEmbedded;
  static fitted = PolaroidImageFitted;
}
