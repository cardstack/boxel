import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import cn from '../helpers/cn.ts';
import { and, bool, eq, or } from '../helpers/truth-helpers.ts';
import FailureBordered from './icons/failure-bordered.gts';
import SuccessBordered from './icons/success-bordered.gts';
import type { IconComponent } from './icons/types.ts';
import LoadingIndicator from './loading-indicator.gts';

// boxel-ui's InputGroup: an input in a bordered row with text before and
// after it, such as a username between its `@` and its server name. Only the
// parts the secure origin's pages draw are here: the group's own input and
// its text accessories.

export type InputGroupValidationState =
  | 'initial'
  | 'valid'
  | 'invalid'
  | 'loading';

interface TextSignature {
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

const Text: TemplateOnlyComponent<TextSignature> = <template>
  <span
    class='text-accessory'
    data-test-boxel-input-group-text-accessory
    ...attributes
  >{{yield}}</span>
  <style scoped>
    @layer boxelComponentL1 {
      .text-accessory {
        align-items: center;
        color: color-mix(
          in oklch,
          var(--muted-foreground) 55%,
          var(--foreground)
        );
        display: flex;
        font-size: var(--boxel-font-size-sm);
        padding: var(--boxel-input-group-padding-y)
          var(--boxel-input-group-padding-x);
        text-align: center;
        white-space: nowrap;
      }
    }
  </style>
</template>;

export interface AccessoriesBlockArg {
  Text: typeof Text;
}

interface Signature {
  Args: {
    autocomplete?: string;
    disabled?: boolean;
    errorMessage?: string;
    id?: string;
    name?: string;
    onBlur?: (ev: Event) => void;
    onInput?: (value: string) => void;
    placeholder?: string;
    state?: InputGroupValidationState;
    validIcon?: IconComponent;
    value?: string;
  };
  Blocks: {
    after: [AccessoriesBlockArg];
    before: [AccessoriesBlockArg];
  };
  // The input itself, as a BoxelInput's attributes go on its input.
  Element: HTMLInputElement;
}

export default class InputGroup extends Component<Signature> {
  get elementId() {
    return this.args.id || guidFor(this);
  }

  private get validationIcon(): IconComponent | undefined {
    if (this.args.disabled) {
      return undefined;
    }
    switch (this.args.state) {
      case 'valid':
        return this.args.validIcon ?? SuccessBordered;
      case 'invalid':
        return FailureBordered;
      default:
        return undefined;
    }
  }

  private onInput = (event: Event) => {
    this.args.onInput?.((event.target as HTMLInputElement).value);
  };

  private onBlur = (event: Event) => {
    this.args.onBlur?.(event);
  };

  <template>
    {{#let
      (and (eq @state 'invalid') (bool @errorMessage))
      (hash Text=Text)
      as |shouldShowErrorMessage Accessories|
    }}
      <div class='container'>
        <div
          class={{cn
            'boxel-input-group'
            boxel-input-group--invalid=(eq @state 'invalid')
            boxel-input-group--disabled=(or @disabled (eq @state 'loading'))
          }}
          data-test-boxel-input-group
          data-test-boxel-input-group-validation-state={{if
            @disabled
            false
            @state
          }}
        >
          {{yield Accessories to='before'}}
          <input
            class='form-control'
            id={{this.elementId}}
            name={{@name}}
            placeholder={{@placeholder}}
            value={{@value}}
            disabled={{@disabled}}
            autocomplete={{@autocomplete}}
            aria-invalid={{if (eq @state 'invalid') 'true'}}
            aria-errormessage={{if
              shouldShowErrorMessage
              (concat 'error-message-' this.elementId)
              false
            }}
            {{on 'input' this.onInput}}
            {{on 'blur' this.onBlur}}
            ...attributes
          />
          {{yield Accessories to='after'}}
          {{#if this.validationIcon}}
            <div class={{cn 'validation-icon-container' @state}}>
              <this.validationIcon />
            </div>
          {{else if (eq @state 'loading')}}
            <div class={{cn 'validation-icon-container' @state}}>
              <LoadingIndicator />
            </div>
          {{/if}}
        </div>
        {{#if shouldShowErrorMessage}}
          <div
            id={{concat 'error-message-' this.elementId}}
            class='error-message'
            data-test-boxel-input-group-error-message
          >{{@errorMessage}}</div>
        {{/if}}
      </div>
    {{/let}}
    <style scoped>
      .container {
        display: flex;
        flex-direction: column;
      }
      .boxel-input-group {
        --boxel-input-group-padding-x: var(--boxel-sp-sm);
        --boxel-input-group-padding-y: var(--boxel-sp-xxs);
        --boxel-input-group-border-color: var(
          --border,
          var(--boxel-form-control-border-color)
        );
        --boxel-input-group-border-radius: var(
          --boxel-form-control-border-radius
        );
        --boxel-input-group-inner-border-radius: calc(
          var(--boxel-input-group-border-radius) - 1px
        );
        --boxel-input-group-interior-border-width: 0;
        --boxel-input-group-height: var(
          --boxel-input-height,
          var(--boxel-form-control-height)
        );
        --boxel-input-group-icon-length: calc(
          var(--boxel-icon-sm) + var(--boxel-sp-xs) * 2
        );

        border-radius: var(--boxel-input-group-border-radius);
        cursor: text;
        position: relative;
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        width: 100%;
        max-width: 100%;
        min-height: var(--boxel-input-group-height);
        background-color: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        border: 1px solid var(--boxel-input-group-border-color);
      }

      @layer boxelComponentL1 {
        .boxel-input-group > .form-control {
          -moz-appearance: none;
          -webkit-appearance: none;
          appearance: none;
          background-clip: padding-box;
          display: block;
          flex: 1 1 auto;
          min-width: 0;
          padding: var(--boxel-input-group-padding-y)
            var(--boxel-input-group-padding-x);
          width: 1%;
          background-color: inherit;
          color: inherit;
        }
        .boxel-input-group > .form-control {
          position: relative;
          z-index: 1;
          outline-offset: 0;
          margin: 0;
          min-height: inherit;
          box-shadow: none;
          border: none;
        }
        .boxel-input-group > .form-control:focus-visible {
          z-index: 5;
        }
      }

      /* With text accessories alone, the group is outlined as a whole when
         its input has focus, and the input itself is not. */
      .boxel-input-group:focus-within:not(.boxel-input-group--invalid) {
        outline: 1px solid var(--ring, var(--boxel-highlight));
        border-color: var(--ring, var(--boxel-highlight));
      }
      .boxel-input-group > .form-control:focus-visible,
      .boxel-input-group > .form-control {
        outline: none;
      }

      .boxel-input-group--disabled .form-control,
      .boxel-input-group--disabled :deep(.text-accessory) {
        border-color: var(--boxel-input-group-border-color);
        opacity: 0.5;
      }

      .boxel-input-group > :last-child {
        border-top-right-radius: var(--boxel-input-group-inner-border-radius);
        border-bottom-right-radius: var(
          --boxel-input-group-inner-border-radius
        );
      }

      .boxel-input-group > :not(:last-child) {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
      }

      .boxel-input-group > :first-child {
        border-top-left-radius: var(--boxel-input-group-inner-border-radius);
        border-bottom-left-radius: var(--boxel-input-group-inner-border-radius);
      }

      .boxel-input-group > :not(:first-child) {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
      }

      .boxel-input-group--invalid:not(.boxel-input-group--disabled) {
        box-shadow: 0 0 0 1px var(--destructive, var(--boxel-error-100));
      }

      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        .validation-icon-container,
      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        .form-control,
      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        :deep(.text-accessory) {
        border-color: var(--destructive, var(--boxel-error-100));
      }

      .boxel-input-group--disabled ~ .error-message {
        display: none;
      }

      .error-message {
        margin-top: var(--boxel-sp-xxxs);
        margin-left: calc(var(--boxel-sp-sm) + 1px);
        color: var(--destructive-ink);
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        letter-spacing: var(--boxel-lsp);
      }

      .validation-icon-container {
        display: flex;
        align-items: center;
        justify-content: center;
        user-select: none;
        width: var(--boxel-input-group-icon-length);
      }
    </style>
  </template>
}
