import {
  contains,
  field,
  Component,
  CardDef,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import World from '@cardstack/boxel-icons/world';

class EcommerceCategory extends CardDef {
  static displayName = 'Ecommerce Category';
  static icon = World;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia(this: EcommerceCategory) {
      return this.name;
    },
  });
}

class EcommerceTag extends CardDef {
  static displayName = 'Ecommerce Tag';
  static icon = World;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia(this: EcommerceTag) {
      return this.name;
    },
  });
}

export class EcommerceProduct extends CardDef {
  static displayName = 'Ecommerce Product';
  static icon = World;
  @field name = contains(StringField);
  @field categories = linksToMany(EcommerceCategory);
  @field tags = linksToMany(EcommerceTag);
  @field title = contains(StringField, {
    computeVia(this: EcommerceProduct) {
      return this.name;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}
