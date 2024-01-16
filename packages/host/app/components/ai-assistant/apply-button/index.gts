import Component from '@glimmer/component';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
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
        <svg class='spinner' viewBox='0 0 50 50'>
          <circle
            class='path'
            cx='25'
            cy='25'
            r='20'
            fill='none'
            stroke-width='5'
          ></circle>
        </svg>
      {{else if (eq @state 'applied')}}
        <svg class='checkmark' viewBox='3 3 14 14'>
          <path
            id='checkmark'
            d='M15.139,6,7.481,13.658,4,10.177'
            fill='none'
            stroke-linecap='round'
            stroke-linejoin='round'
            stroke-width='2'
          />
        </svg>
      {{else if (eq @state 'failed')}}
        <svg class='exclamation' viewBox='0 0 6 16'>
          <path
            d='M4.505,9.037 L1.693,9.037 L1.11,0.729 L5.093,0.729 z M1.06,12.978 C1.022,12.441 1.209,11.912 1.578,11.519 C1.996,11.161 2.539,10.981 3.088,11.019 C3.629,10.985 4.162,11.167 4.569,11.526 C4.938,11.916 5.128,12.442 5.093,12.978 C5.122,13.509 4.93,14.028 4.563,14.413 C4.163,14.78 3.63,14.969 3.088,14.937 C2.54,14.972 2,14.788 1.588,14.424 C1.218,14.037 1.026,13.513 1.06,12.978 z'
            fill='#000000'
          />
        </svg>
      {{/if}}
    </BoxelButton>
    <style>
      .apply-button {
        --boxel-button-font: 700 var(--boxel-font-size-xs) / calc(15 / 11)
          var(--boxel-font-family);
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
        animation: rotate 2s linear infinite;
        width: var(--spinner-circle-size);
        height: var(--spinner-circle-size);
      }
      .spinner .path {
        stroke: var(--boxel-dark);
        stroke-linecap: round;
        animation: dash 1.5s ease-in-out infinite;
      }
      .checkmark {
        width: 16px;
        height: 16px;
      }
      .checkmark path {
        stroke: var(--boxel-dark);
      }
      .exclamation {
        width: 17px;
        height: 17px;
      }
      .exclamation path {
        fill: var(--boxel-light);
      }

      @keyframes rotate {
        100% {
          transform: rotate(360deg);
        }
      }

      @keyframes dash {
        0% {
          stroke-dasharray: 1, 150;
          stroke-dashoffset: 0;
        }
        50% {
          stroke-dasharray: 90, 150;
          stroke-dashoffset: -35;
        }
        100% {
          stroke-dasharray: 90, 150;
          stroke-dashoffset: -124;
        }
      }
    </style>
  </template>
}
