import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import Base64ImageField from 'https://cardstack.com/base/base64-image';

class ProductImageCardEmbedded extends Component<typeof ProductImageCard> {
  <template>
    <@fields.data />
  </template>
}

class ProductImageCardFitted extends Component<typeof ProductImageCard> {
  <template>
    <@fields.data />
  </template>
}

export class ProductImageCard extends CardDef {
  static displayName = 'Product Image';

  @field data = contains(Base64ImageField);

  static isolated = ProductImageCardEmbedded;
  static embedded = ProductImageCardEmbedded;
  static fitted = ProductImageCardFitted;
}
