import {
  Component,
  primitive,
  serialize,
  deserialize,
  formatQuery,
  queryableValue,
  CardDef,
  BaseDefConstructor,
  BaseInstanceType,
  FieldDef,
  relativeTo,
  type SerializeOpts,
  type JSONAPISingleResourceDocument,
} from './card-api';
import { ResolvedCodeRef } from '@cardstack/runtime-common';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';

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
class Edit extends Component<typeof CodeRefField> {
  @action setModule(m: string) {
    let codeRef = { ...this.args.model, module: m };
    this.args.set(codeRef);
  }
  @action setName(m: string) {
    let codeRef = { ...this.args.model, name: m };
    this.args.set(codeRef);
  }
  <template>
    <div>
      <BoxelInput @value={{@model.module}} @onInput={{this.setModule}} />
      <BoxelInput @value={{@model.name}} @onInput={{this.setName}} />
    </div>
  </template>
}

export default class CodeRefField extends FieldDef {
  static [primitive]: ResolvedCodeRef;

  static [serialize](
    codeRef: ResolvedCodeRef,
    _doc: JSONAPISingleResourceDocument,
    _visited?: Set<string>,
    opts?: SerializeOpts,
  ) {
    return {
      ...codeRef,
      ...(opts?.maybeRelativeURL
        ? { module: opts.maybeRelativeURL(codeRef.module) }
        : {}),
    };
  }
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    codeRef: ResolvedCodeRef,
  ): Promise<BaseInstanceType<T>> {
    return { ...codeRef } as BaseInstanceType<T>; // return a new object so that the model cannot be mutated from the outside
  }
  static [queryableValue](
    codeRef: ResolvedCodeRef | undefined,
    stack: CardDef[] = [],
  ) {
    return maybeSerializeCodeRef(codeRef, stack);
  }
  static [formatQuery](codeRef: ResolvedCodeRef) {
    return maybeSerializeCodeRef(codeRef);
  }

  static embedded = class Embedded extends BaseView {};
  // The edit template is meant to be read-only, this field card is not mutable
  // static edit = class Edit extends BaseView {};
  static edit = Edit;
}

function maybeSerializeCodeRef(
  codeRef: ResolvedCodeRef | undefined,
  stack: CardDef[] = [],
) {
  if (codeRef) {
    // if a stack is passed in, use the containing card to resolve relative references
    let moduleHref =
      stack.length > 0
        ? new URL(codeRef.module, stack[0][relativeTo]).href
        : codeRef.module;
    return `${moduleHref}/${codeRef.name}`;
  }
  return undefined;
}
