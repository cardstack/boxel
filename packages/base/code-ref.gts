import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import {
  type CardContext,
  Component,
  primitive,
  FieldDef,
} from './card-api';
import { restartableTask } from 'ember-concurrency';
import { consume } from 'ember-provide-consume-context';
import {
  type ResolvedCodeRef,
  isUrlLike,
  CardContextName,
  CardURLContextName,
  fieldSerializer,
  CodeRefSerializer,
  type CodeRef,
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
  @consume(CardContextName) declare cardContext: CardContext;
  @consume(CardURLContextName) declare cardURL: string | undefined;
  @tracked validationState: 'initial' | 'valid' | 'invalid' = 'initial';
  @tracked private maybeCodeRef: string | undefined =
    CodeRefSerializer.queryableValue(this.args.model ?? undefined);

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
      this.performValidation(this.maybeCodeRef, { checkOnly: true });
    }
  }

  private onInput = (inputVal: string) => {
    this.maybeCodeRef = inputVal;
    this.cardContext.requestRender?.();
    this.performValidation(this.maybeCodeRef);
  };

  private performValidation(
    maybeCodeRef: string,
    opts?: { checkOnly?: true },
  ) {
    let validation = this.setIfValid.perform(maybeCodeRef, opts);
    // The final task state (`isIdle`) changes after the task body resolves.
    // Request once more at that explicit completion boundary so the Host sees
    // both the validation result and the settled task state.
    void validation.then(
      () => this.cardContext.requestRender?.(),
      () => this.cardContext.requestRender?.(),
    );
  }

  private setValidationState(state: 'initial' | 'valid' | 'invalid') {
    this.validationState = state;
    this.cardContext.requestRender?.();
  }

  private setIfValid = restartableTask(
    async (maybeCodeRef: string, opts?: { checkOnly?: true }) => {
      this.setValidationState('initial');
      if (maybeCodeRef.length === 0) {
        if (!opts?.checkOnly) {
          this.args.set(undefined);
        }
        return;
      }

      let parts = maybeCodeRef.split('/');
      if (parts.length < 2) {
        this.setValidationState('invalid');
        return;
      }

      let name = parts.pop()!;
      let module = parts.join('/');
      if (isUrlLike(module) && this.cardURL) {
        module = new URL(module, new URL(this.cardURL)).href;
      }
      try {
        let ref = { module, name } as CodeRef;
        let validatedRef = this.cardContext.validateCodeRef
          ? await this.cardContext.validateCodeRef(ref)
          : (await import(module))[name]
            ? (ref as ResolvedCodeRef)
            : undefined;
        if (validatedRef) {
          this.setValidationState('valid');
          if (!opts?.checkOnly) {
            this.args.set(validatedRef);
          }
        } else {
          this.setValidationState('invalid');
        }
      } catch (err) {
        this.setValidationState('invalid');
      }
    },
  );
}

export default class CodeRefField extends FieldDef {
  static displayName = 'CodeRef';
  static icon = CodeIcon;
  static [primitive]: ResolvedCodeRef;
  static [fieldSerializer] = 'code-ref';
  static embedded = class Embedded extends BaseView {};
  static edit = EditView;

  // CS-10786: emit the code reference as an inline code span — `module/name`
  // is the canonical serialization. Wrapping in backticks avoids having to
  // escape any module-path characters.
  static markdown = class Markdown extends Component<typeof CodeRefField> {
    get text() {
      let model = this.args.model;
      if (!model?.module || !model?.name) {
        return '';
      }
      // Combine module + name into the same string the edit input shows,
      // then wrap in a fence of sufficient width to contain any backticks
      // in the module path.
      let raw = `${model.module}/${model.name}`;
      let longestRun = 0;
      let match = raw.match(/`+/g);
      if (match) {
        for (let run of match) {
          if (run.length > longestRun) longestRun = run.length;
        }
      }
      let fence = '`'.repeat(Math.max(1, longestRun + 1));
      // Pad with spaces when the content starts/ends with a backtick so the
      // inline-code-span parser doesn't consume the delimiter.
      let needsPad =
        raw.startsWith('`') || raw.endsWith('`') || /^\s|\s$/.test(raw);
      return needsPad ? `${fence} ${raw} ${fence}` : `${fence}${raw}${fence}`;
    }
    <template>{{this.text}}</template>
  };
}

export class AbsoluteCodeRefField extends CodeRefField {
  static [fieldSerializer] = 'absolute-code-ref';
}
