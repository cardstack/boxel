import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export const ProductCategoryField = enumField(StringField, {
  options: [
    { value: 'coffee', label: 'Coffee' },
    { value: 'tea', label: 'Tea' },
    { value: 'equipment', label: 'Equipment' },
  ],
});

export class ProductVariant extends FieldDef {
  static displayName = 'Product Variant';
  @field sku = contains(StringField);
  @field size = contains(StringField);
  // In USD.
  @field price = contains(NumberField);
}

export class Product extends CardDef {
  static displayName = 'Product';
  @field name = contains(StringField);
  @field category = contains(ProductCategoryField);
  @field origin = contains(StringField);
  @field variants = containsMany(ProductVariant);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Product) {
      return this.name ?? 'Unnamed product';
    },
  });
}
