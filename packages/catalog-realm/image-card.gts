import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import Base64ImageField from 'https://cardstack.com/base/base64-image';

class ImageCardEmbedded extends Component<typeof ImageCard> {
  <template>
    <@fields.data />
  </template>
}
class ImageCardFitted extends Component<typeof ImageCard> {
  <template>
    <@fields.data />
  </template>
}

// TODO: Destructure card into field when file def support is available
// Currently, this is a workaround to create base64 fields that are intentionall
// not shared with the AI to avoid large context sizes.
export class ImageCard extends CardDef {
  static displayName = 'Image';

  @field data = contains(Base64ImageField);

  static isolated = ImageCardEmbedded;
  static embedded = ImageCardEmbedded;
  static fitted = ImageCardFitted;
}
