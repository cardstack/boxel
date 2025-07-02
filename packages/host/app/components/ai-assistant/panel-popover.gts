import type { TemplateOnlyComponent } from '@ember/component/template-only';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    header: [];
    body: [];
  };
  Args: { onClose: () => void };
}

const AiAssistantPanelPopover: TemplateOnlyComponent<Signature> = <template>
  <style scoped>
    .panel-popover {
      position: absolute;
      top: 0;
      left: 0;
      margin-top: var(--boxel-sp-sm);
      width: 24.5rem;
      min-height: 12.5rem;
      max-height: 75vh;
      background-color: #4f4b57;
      border-radius: var(--boxel-border-radius-xl);
      color: var(--boxel-light);
      box-shadow: 0 5px 15px 0 rgba(0, 0, 0, 0.5);
      z-index: var(--host-ai-panel-popover-z-index);
      display: flex;
      flex-direction: column;
    }

    .header {
      position: relative;
      padding: var(--boxel-sp);
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: var(--boxel-lsp-xs);
      line-height: 1.2;
    }
    .header :deep(button) {
      transform: rotate(180deg);
      position: absolute;
      right: var(--boxel-sp-xs);
      top: var(--boxel-sp-xs);
    }

    .body {
      overflow-y: auto;
      flex-grow: 1;
    }
  </style>

  <div
    {{onClickOutside @onClose exceptSelector='.past-session-menu,.delete'}}
    class='panel-popover'
    ...attributes
  >
    <div class='header'>
      {{yield to='header'}}
    </div>
    <div class='body'>
      {{yield to='body'}}
    </div>
  </div>
</template>;

export default AiAssistantPanelPopover;
