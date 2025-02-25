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
import CodeIcon from '@cardstack/boxel-icons/code';

function moduleIsUrlLike(module: string) {
  return (
    module.startsWith('http') ||
    module.startsWith('.') ||
    module.startsWith('/')
  );
}

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

export default class CodeRefField extends FieldDef {
  static icon = CodeIcon;
  static [primitive]: ResolvedCodeRef;

  static [serialize](
    codeRef: ResolvedCodeRef,
    _doc: JSONAPISingleResourceDocument,
    _visited?: Set<string>,
    opts?: SerializeOpts,
  ) {
    return {
      ...codeRef,
      ...(opts?.maybeRelativeURL &&
      !opts?.useAbsoluteURL &&
      moduleIsUrlLike(codeRef.module)
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
  static edit = class Edit extends BaseView {};
}

function maybeSerializeCodeRef(
  codeRef: ResolvedCodeRef | undefined,
  stack: CardDef[] = [],
) {
  if (codeRef) {
    if (moduleIsUrlLike(codeRef.module)) {
      // if a stack is passed in, use the containing card to resolve relative references
      let moduleHref =
        stack.length > 0
          ? new URL(codeRef.module, stack[0][relativeTo]).href
          : codeRef.module;
      return `${moduleHref}/${codeRef.name}`;
    } else {
      return `${codeRef.module}/${codeRef.name}`;
    }
  }
  return undefined;
}
