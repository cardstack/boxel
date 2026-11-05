import { markDefinition } from '@cardstack/base/mark-definition';
import {
  CardDef,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import AddressField from '@cardstack/base/address';
import BooleanField from '@cardstack/base/boolean';
import DateField from '@cardstack/base/date';
import EmailField from '@cardstack/base/email';
import enumField from '@cardstack/base/enum';
import MarkdownField from '@cardstack/base/markdown';
import NumberField from '@cardstack/base/number';
import PhoneNumberField from '@cardstack/base/phone-number';
import StringField from '@cardstack/base/string';
import UrlField from '@cardstack/base/url';

export class ShopOwner extends CardDef {
  static displayName = 'Shop Owner';
  @field fullName = contains(StringField);
  @field email = contains(EmailField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ShopOwner) {
      return this.fullName ?? 'Unnamed owner';
    },
  });
}

export const PriceLevelField = markDefinition(
  enumField(StringField, {
    options: ['$', '$$', '$$$'],
  }),
);

export class CoffeeShop extends CardDef {
  static displayName = 'Coffee Shop';
  @field name = contains(StringField);
  @field tagline = contains(StringField);
  @field description = contains(MarkdownField);
  @field phone = contains(PhoneNumberField);
  @field email = contains(EmailField);
  @field website = contains(UrlField);
  @field address = contains(AddressField);
  @field seatingCapacity = contains(NumberField);
  @field hasWifi = contains(BooleanField);
  @field openedOn = contains(DateField);
  @field priceLevel = contains(PriceLevelField);
  @field menuHighlights = containsMany(StringField);
  @field owner = linksTo(() => ShopOwner);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: CoffeeShop) {
      return this.name ?? 'Untitled coffee shop';
    },
  });
}
