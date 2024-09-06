import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { Price, PriceCta } from './price';

export class Offer extends CardDef {
  static displayName = 'Offer';
  @field cta = contains(PriceCta);
  @field price = contains(Price);
  // @field criteria = contains(CompoundCriteriaField);

  @field title = contains(StringField, {
    computeVia: function (this: Offer) {
      return this.cta.label;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model.cta.label}}
      {{@model.cta.subLabel}}
    </template>
  };
}
