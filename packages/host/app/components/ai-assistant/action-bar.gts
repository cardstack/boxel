import { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { BoxelButton } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    acceptAll: () => void;
    cancel: () => void;
    acceptingAll?: boolean;
  };
}

const AiAssistantActionBar: TemplateOnlyComponent<Signature> = <template>
  <div class='ai-assistant-action-bar' data-test-ai-assistant-action-bar>
    <BoxelButton
      @kind='primary'
      class='action-btn'
      data-test-accept-all
      @disabled={{@acceptingAll}}
      @loading={{@acceptingAll}}
      {{on 'click' @acceptAll}}
    >Accept All</BoxelButton>
    <BoxelButton
      @kind='secondary-dark'
      class='action-btn cancel-btn'
      data-test-cancel
      {{on 'click' @cancel}}
    >Cancel</BoxelButton>
  </div>

  <style scoped>
    .ai-assistant-action-bar {
      background-color: #3b394b;
      display: flex;
      gap: var(--boxel-sp-sm);
      padding: var(--boxel-sp-xs);
      padding-bottom: calc(2 * var(--boxel-sp-xs));
      margin-bottom: calc(-1 * var(--boxel-sp-xs));
      border-top-right-radius: var(--boxel-border-radius-lg);
      border-top-left-radius: var(--boxel-border-radius-lg);
      align-items: center;
      border: 1px solid #777;
    }
    .action-btn {
      flex: 1;
      min-content: 24px;
      --boxel-button-font: 600 var(--boxel-font-xs);
    }
    .cancel-btn {
      --boxel-button-text-color: var(--boxel-light);
    }
  </style>
</template>;

export default AiAssistantActionBar;
