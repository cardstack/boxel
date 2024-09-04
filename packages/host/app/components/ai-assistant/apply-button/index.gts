import Component from '@glimmer/component';

import { BoxelButton, CircleSpinner } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { CheckMark, Exclamation } from '@cardstack/boxel-ui/icons';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';

export type ApplyButtonState = 'ready' | 'applying' | 'applied' | 'failed';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    state: ApplyButtonState;
  };
}

export default class AiAssistantApplyButton extends Component<Signature> {
  <template>
    <BoxelButton
      @kind='primary'
      @size='small'
      class={{cn 'apply-button' @state}}
      {{setCssVar boxel-button-text-color='var(--boxel-dark)'}}
      ...attributes
    >
      {{#if (eq @state 'ready')}}
        Apply
      {{else if (eq @state 'applying')}}
        <CircleSpinner class='spinner' />
      {{else if (eq @state 'applied')}}
        <CheckMark class='checkmark' />
      {{else if (eq @state 'failed')}}
        <Exclamation class='exclamation' />
      {{/if}}
    </BoxelButton>
    <style>
      .apply-button {
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-min-height: 1.5rem;
        --boxel-button-padding: 0;
        position: relative;
        min-width: 58px;
        max-height: 1.5rem;
        transition: min-width 0.2s ease-in-out;
      }
      .apply-button.applied,
      .apply-button.failed {
        min-width: 0;
        aspect-ratio: 1;
        padding: 0;
      }
      .apply-button.failed {
        background: var(--boxel-error-200);
        border-color: var(--boxel-error-200);
      }
      .spinner {
        --spinner-circle-size: 18px;
        width: var(--spinner-circle-size);
        height: var(--spinner-circle-size);
        --icon-color: var(--boxel-dark);
        --icon-stroke-width: 5;
      }
      .checkmark {
        width: 24px;
        height: 24px;
        --icon-color: var(--boxel-dark);
      }
      .exclamation {
        width: 17px;
        height: 17px;
        --icon-color: var(--boxel-light);
      }
      .apply-button:hover:not(:disabled),
      .apply-button:focus:not(:disabled) {
        --boxel-button-color: var(--boxel-highlight);
        filter: brightness(1.1);
      }
    </style>
  </template>
}
