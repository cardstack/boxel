import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { BoxelButton, CircleSpinner } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { CheckMark, Exclamation } from '@cardstack/boxel-ui/icons';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';

export type ApplyButtonState = 'ready' | 'applying' | 'applied' | 'failed';

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
      {{/if}}
    </div>
  {{/if}}
  <style>
    .apply-button {
      --boxel-button-font: 700 var(--boxel-font-xs);
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
    .state-indicator:not(.applying) {
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
