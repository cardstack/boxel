import type { TemplateOnlyComponent } from '@ember/component/template-only';

import ApplyButton from '../ai-assistant/apply-button';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    commandDescription?: string | null;
  };
}

const RoomMessageCommand: TemplateOnlyComponent<Signature> = <template>
  <div class='preparing-room-message-command' ...attributes>
    <header class='code-block-header'>
      <div class='command-description'>
        {{if @commandDescription @commandDescription 'Preparing tool call...'}}
      </div>
      <div class='actions'>
        <ApplyButton @state='preparing' data-test-command-apply='preparing' />
      </div>
    </header>
  </div>

  <style scoped>
    .preparing-room-message-command {
      background-color: var(--boxel-dark);
      color: var(--boxel-light);
      border: 1px solid var(--boxel-550);
      border-radius: var(--boxel-border-radius-xxl);
      overflow: hidden;
    }
    .code-block-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      gap: var(--boxel-sp-xxxs);
      align-items: center;
      min-height: 3.125rem; /* 50px */
      padding: var(--boxel-sp-sm);
      background-color: var(--boxel-650);
      color: var(--boxel-light);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .command-description {
      font: 400 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      line-height: 1.5em;
      text-wrap: pretty;
      overflow-wrap: break-word;
    }
    .actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-4xs);
    }
  </style>
</template>;

export default RoomMessageCommand;
