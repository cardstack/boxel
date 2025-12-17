import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import ImageField from '../../fields/image';

class ProductRotationImageEmbedded extends Component<
  typeof ProductRotationImage
> {
  get angleLabel() {
    return this.args.model?.angleLabel ?? '';
  }

  get imageUrl() {
    return this.args.model?.image?.url ?? '';
  }

  <template>
    <img
      class='rotation-image__img'
      src={{this.imageUrl}}
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

export class ProductRotationImage extends CardDef {
  static displayName = 'Product Rotation Image';

  @field angleLabel = contains(StringField);
  @field angleDegrees = contains(NumberField);
  @field image = contains(ImageField);
  @field title = contains(StringField, {
    computeVia: function (this: ProductRotationImage) {
      return this.angleLabel
        ? 'Product Rotation Image ' + this.angleLabel
        : 'Product Rotation Image';
    },
  });

  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: ProductRotationImage) {
      return this.image?.url ?? '';
    },
  });

  static isolated = ProductRotationImageEmbedded;
  static embedded = ProductRotationImageEmbedded;
  static fitted = ProductRotationImageEmbedded;
}
