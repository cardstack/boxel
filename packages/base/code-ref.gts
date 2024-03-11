import {
  Component,
  primitive,
  serialize,
  deserialize,
  queryableValue,
  CardDef,
  BaseDefConstructor,
  InstanceType,
  FieldDef,
  relativeTo,
  type SerializeOpts,
  type JSONAPISingleResourceDocument,
} from './card-api';

class BaseView extends Component<typeof CodeRefField> {
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

export default class CodeRefField extends FieldDef {
  @field value = primitive<CardId>();

  static [serialize](
    cardRef: CardId,
    _doc: JSONAPISingleResourceDocument,
    _visited?: Set<string>,
    opts?: SerializeOpts,
  ) {
    return {
      ...cardRef,
      ...(opts?.maybeRelativeURL
        ? { module: opts.maybeRelativeURL(cardRef.module) }
        : {}),
    };
  }
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    cardRef: CardId,
  ): Promise<InstanceType<T>> {
    return { ...cardRef } as InstanceType<T>; // return a new object so that the model cannot be mutated from the outside
  }
  static [queryableValue](cardRef: CardId | undefined, stack: CardDef[] = []) {
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
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends BaseView {};
}
