import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { BoxelButton, CircleSpinner } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { CheckMark, Exclamation } from '@cardstack/boxel-ui/icons';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';

export type ApplyButtonState =
  | 'ready'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'preparing';

interface Signature {
  Element: HTMLButtonElement | HTMLDivElement;
  Args: {
    state: ApplyButtonState;
  };
}

const AiAssistantApplyButton: TemplateOnlyComponent<Signature> = <template>
  {{#if (eq @state 'ready')}}
    <BoxelButton
      @kind='primary'
      @size='small'
      class='apply-button'
      {{setCssVar boxel-button-text-color='var(--boxel-dark)'}}
      data-test-apply-state={{@state}}
      ...attributes
    >
      Apply
    </BoxelButton>
  {{else}}
    <div class='state-indicator {{@state}}' data-test-apply-state={{@state}}>
      {{#if (eq @state 'applying')}}
        <CircleSpinner width='18' height='18' />
      {{else if (eq @state 'applied')}}
        <CheckMark width='16' height='16' />
      {{else if (eq @state 'failed')}}
        <Exclamation width='16' height='16' />
      {{else if (eq @state 'preparing')}}
        <BoxelButton
          @kind='secondary-dark'
          @size='small'
          class='apply-button'
          {{setCssVar boxel-button-text-color='var(--boxel-200)'}}
          data-test-apply-state='preparing'
          ...attributes
        >
          Working…
        </BoxelButton>
      {{/if}}
    </div>
  {{/if}}
  <style scoped>
    .apply-button {
      --boxel-button-font: 600 var(--boxel-font-xs);
      --boxel-button-min-height: 1.5rem;
      --boxel-button-padding: 0;
      position: relative;
      min-width: 58px;
      max-height: 1.5rem;
    }
    .apply-button:hover:not(:disabled),
    .apply-button:focus:not(:disabled) {
      --boxel-button-color: var(--boxel-highlight);
      filter: brightness(1.1);
    }
    .state-indicator {
      --icon-color: var(--boxel-dark);
      display: flex;
      justify-content: center;
      align-items: center;
      height: 1.5rem;
      background-color: var(--boxel-highlight);
      transition:
        width var(--boxel-transition),
        border-radius var(--boxel-transition);
    }
    .state-indicator.applying {
      --icon-stroke-width: 5;
      width: 58px;
      border-radius: 100px;
    }

    .state-indicator.preparing {
      width: 78px;
      padding: 1px;
      border-radius: 100px;
    }
    .state-indicator.preparing .apply-button {
      border: 0;
      min-width: 74px;
    }

    .state-indicator.preparing::before {
      content: '';
      position: absolute;
      top: -105px;
      left: -55px;
      width: 250px;
      height: 250px;
      background: conic-gradient(
        #ffcc8f 0deg,
        #ff3966 45deg,
        #ff309e 90deg,
        #aa1dc9 135deg,
        #d7fad6 180deg,
        #5fdfea 225deg,
        #3d83f2 270deg,
        #5145e8 315deg,
        #ffcc8f 360deg
      );
      z-index: -1;
      animation: spin 4s infinite linear;
    }

    .state-indicator.preparing::after {
      content: '';
      position: absolute;
      top: 1px;
      left: 1px;
      right: 1px;
      bottom: 1px;
      background: var(--ai-bot-message-background-color);
      border-radius: inherit;
      z-index: -1;
    }

    .state-indicator.preparing {
      position: relative;
      display: inline-block;
      border-radius: 3rem;
      color: white;
      background: var(--boxel-700);
      border: none;
      cursor: pointer;
      z-index: 1;
      overflow: hidden;
    }

    .state-indicator:not(.applying):not(.preparing) {
      width: 1.5rem;
      aspect-ratio: 1;
      border-radius: 50%;
    }
    .state-indicator.failed {
      --icon-color: var(--boxel-light);
      background-color: var(--boxel-error-200);
      border-color: var(--boxel-error-200);
    }
  </style>
</template>;

export default AiAssistantApplyButton;
