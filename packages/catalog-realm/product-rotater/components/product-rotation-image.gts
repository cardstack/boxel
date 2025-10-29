import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

import { ImageCard } from '../../image-card';

class ProductRotationImageEmbedded extends Component<
  typeof ProductRotationImage
> {
  get angleLabel() {
    return this.args.model?.angleLabel ?? '';
  }

  <template>
    <img
      class='rotation-image__img'
      src='data:image/*;base64={{@model.data.base64}}'
      alt={{this.angleLabel}}
    />

    <style scoped>
      .rotation-image__img {
        width: 100%;
        height: 100%;
        aspect-ratio: 1 / 1;
        display: block;
        object-fit: contain;
      }
    </style>
  </template>
}

// @ts-ignore - Component type compatibility issue with extended fields
export class ProductRotationImage extends ImageCard {
  static displayName = 'Product Rotation Image';

  @field angleLabel = contains(StringField);
  @field angleDegrees = contains(NumberField);
  @field title = contains(StringField, {
    computeVia: function (this: ProductRotationImage) {
      return this.angleLabel
        ? 'Product Rotation Image ' + this.angleLabel
        : 'Product Rotation Image';
    },
  });

  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: ProductRotationImage) {
      return this.data?.base64 ?? '';
    },
  });

  static isolated = ProductRotationImageEmbedded;
  static embedded = ProductRotationImageEmbedded;
  static fitted = ProductRotationImageEmbedded;
}
