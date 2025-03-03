import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
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
import { restartableTask } from 'ember-concurrency';
import { consume } from 'ember-provide-consume-context';
import {
  type ResolvedCodeRef,
  isUrlLike,
  CardURLContextName,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';
import { not } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import CodeIcon from '@cardstack/boxel-icons/code';

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

class EditView extends Component<typeof CodeRefField> {
  @consume(CardURLContextName) declare cardURL: string | undefined;
  @tracked validationState: 'initial' | 'valid' | 'invalid' = 'initial';
  @tracked private maybeCodeRef: string | undefined = maybeSerializeCodeRef(
    this.args.model ?? undefined,
  );

  <template>
    <BoxelInput
      data-test-hasValidated={{this.setIfValid.isIdle}}
      @value={{this.maybeCodeRef}}
      @state={{this.validationState}}
      @onInput={{this.onInput}}
      @disabled={{not @canEdit}}
    />
  </template>

  constructor(owner: Owner, args: any) {
    super(owner, args);
    if (this.maybeCodeRef != null) {
      this.setIfValid.perform(this.maybeCodeRef, { checkOnly: true });
    }
  }

  private onInput = (inputVal: string) => {
    this.maybeCodeRef = inputVal;
    this.setIfValid.perform(this.maybeCodeRef);
  };

  private setIfValid = restartableTask(
    async (maybeCodeRef: string, opts?: { checkOnly?: true }) => {
      this.validationState = 'initial';
      if (maybeCodeRef.length === 0) {
        if (!opts?.checkOnly) {
          this.args.set(undefined);
        }
        return;
      }

      let parts = maybeCodeRef.split('/');
      if (parts.length < 2) {
        this.validationState = 'invalid';
        return;
      }

      let name = parts.pop()!;
      let module = parts.join('/');
      if (isUrlLike(module) && this.cardURL) {
        module = new URL(module, new URL(this.cardURL)).href;
      }
      try {
        let code = (await import(module))[name];
        if (code) {
          this.validationState = 'valid';
          if (!opts?.checkOnly) {
            this.args.set({ module, name });
          }
        } else {
          this.validationState = 'invalid';
        }
      } catch (err) {
        this.validationState = 'invalid';
      }
    },
  );
}

export default class CodeRefField extends FieldDef {
  static icon = CodeIcon;
  static [primitive]: ResolvedCodeRef;

  static [serialize](
    codeRef: ResolvedCodeRef | {},
    _doc: JSONAPISingleResourceDocument,
    _visited?: Set<string>,
    opts?: SerializeOpts,
  ) {
    return {
      ...codeRef,
      ...(opts?.maybeRelativeURL &&
      codeRef &&
      isResolvedCodeRef(codeRef) &&
      !opts?.useAbsoluteURL &&
      isUrlLike(codeRef.module)
        ? { module: opts.maybeRelativeURL(codeRef.module) }
        : {}),
    };
  }
  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    codeRef: ResolvedCodeRef | {},
  ): Promise<BaseInstanceType<T>> {
    return { ...codeRef } as BaseInstanceType<T>; // return a new object so that the model cannot be mutated from the outside
  }

  static [queryableValue](
    codeRef: ResolvedCodeRef | {} | undefined,
    stack: CardDef[] = [],
  ) {
    return maybeSerializeCodeRef(codeRef, stack);
  }

  static [formatQuery](codeRef: ResolvedCodeRef | {}) {
    return maybeSerializeCodeRef(codeRef);
  }

  static embedded = class Embedded extends BaseView {};

  static edit = EditView;
}

function maybeSerializeCodeRef(
  codeRef: ResolvedCodeRef | {} | undefined,
  stack: CardDef[] = [],
) {
  if (codeRef && isResolvedCodeRef(codeRef)) {
    if (isUrlLike(codeRef.module)) {
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
