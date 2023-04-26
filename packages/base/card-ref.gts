import {
  Component,
  primitive,
  serialize,
  deserialize,
  queryableValue,
  Card,
  CardConstructor,
  CardInstanceType,
  Primitive,
  relativeTo,
} from './card-api';

class BaseView extends Component<typeof CardRefCard> {
  <template>
    <div data-test-ref>
      Module:
      {{@model.module}}
      Name:
      {{@model.name}}
    </div>
  </template>
}

type CardId = { name: string; module: string };

export default class CardRefCard extends Primitive {
  static [primitive]: CardId;

  static [serialize](cardRef: CardId) {
    return { ...cardRef }; // return a new object so that the model cannot be mutated from the outside
  }
  static async [deserialize]<T extends CardConstructor>(
    this: T,
    cardRef: CardId
  ): Promise<CardInstanceType<T>> {
    return { ...cardRef } as CardInstanceType<T>; // return a new object so that the model cannot be mutated from the outside
  }
  static [queryableValue](cardRef: CardId | undefined, stack: Card[] = []) {
    if (cardRef) {
      // if a stack is passed in, use the containing card to resolve relative references
      let moduleHref =
        stack.length > 0
          ? new URL(cardRef.module, stack[0][relativeTo]).href
          : cardRef.module;
      return `${moduleHref}/${cardRef.name}`;
    }
    return undefined;
  }

  static embedded = class Embedded extends BaseView {};
  static isolated = class Isolated extends BaseView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends BaseView {};
}
