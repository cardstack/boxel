import { Component, primitive, serialize, deserialize, queryableValue, Card, CardConstructor, CardInstanceType } from './card-api';
import { type ExportedCardRef } from "@cardstack/runtime-common";

class BaseView extends Component<typeof CardRefCard> {
  <template>
    <div data-test-ref>
      Module: {{@model.module}} Name: {{@model.name}}
    </div>
  </template>
}

export default class CardRefCard extends Card {
  static [primitive]: ExportedCardRef;

  static [serialize](cardRef: ExportedCardRef) {
    return {...cardRef}; // return a new object so that the model cannot be mutated from the outside
  }
  static async [deserialize]<T extends CardConstructor>(this: T, cardRef: ExportedCardRef): Promise<CardInstanceType<T>> {
    return {...cardRef} as CardInstanceType<T>;// return a new object so that the model cannot be mutated from the outside
  }
  static [queryableValue](cardRef: ExportedCardRef | undefined) {
    if (cardRef) {
      return `${cardRef.module}/${cardRef.name}`; // this assumes the module is an absolute reference
    }
    return undefined;
  }

  static embedded = class Embedded extends BaseView {}
  static isolated = class Isolated extends BaseView {}
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends BaseView {}
}
