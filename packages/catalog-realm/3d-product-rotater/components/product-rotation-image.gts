import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

import { ProductImageCard } from './product-image-card';

class ProductRotationImageEmbedded extends Component<
  typeof ProductRotationImage
> {
  get angleLabel() {
    return this.args.model?.angleLabel ?? '';
  }

  get imageCard() {
    return this.args.model.image;
  }

  <template>
    <img
      class='rotation-image__img'
      src='data:image/*;base64={{@model.image.data.base64}}'
      alt={{this.angleLabel}}
    />

    <style scoped>
      .rotation-image__img {
        width: 100%;
        height: 100%;
        aspect-ratio: 1 / 1;
        display: block;
      }
    </style>
  </template>
}

export class ProductRotationImage extends CardDef {
  static displayName = 'Product Rotation Image';

  @field angleLabel = contains(StringField);
  @field angleDegrees = contains(NumberField);
  @field image = linksTo(() => ProductImageCard);

  static isolated = ProductRotationImageEmbedded;
  static embedded = ProductRotationImageEmbedded;
  static fitted = ProductRotationImageEmbedded;
}
