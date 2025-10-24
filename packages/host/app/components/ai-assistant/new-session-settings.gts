import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { Button, ContextButton } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    selectedOptions: Set<string>;
    onOptionChange: (option: string, checked: boolean) => void;
    onClose: () => void;
    onCreateSession: () => void;
  };
}

export default class NewSessionSettings extends Component<Signature> {
  options = [
    'Add Same Skills',
    'Copy File History',
    'Summarize Current Session',
  ];

  @action
  isSelected(option: string) {
    return this.args.selectedOptions.has(option);
  }

  @action
  onOptionChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const option = target.name;
    const checked = target.checked;
    this.args.onOptionChange(option, checked);
  }

  @action
  handleCreateSession() {
    this.args.onCreateSession();
  }

  <template>
    <div class='new-session-settings-menu' data-test-new-session-settings-menu>
      <div class='new-session-settings-header'>
        <div
          class='new-session-settings-title'
          data-test-new-session-settings-title
        >New Session Options</div>
        <ContextButton
          @icon='close'
          @variant='ghost'
          @size='small'
          class='new-session-settings-close-button'
          data-test-new-session-settings-close-button
          {{on 'click' @onClose}}
        />
      </div>
      <div
        class='new-session-settings-options'
        data-test-new-session-settings-options
      >
        {{#each this.options as |option|}}
          <label
            class='new-session-settings-option
              {{if (this.isSelected option) "checked"}}'
            data-test-new-session-settings-option={{option}}
          >
            <input
              type='checkbox'
              name={{option}}
              checked={{this.isSelected option}}
              {{on 'change' this.onOptionChange}}
              data-test-new-session-settings-checkbox={{option}}
            />
            <span
              class='new-session-settings-label'
              data-test-new-session-settings-label={{option}}
            >{{option}}</span>
          </label>
        {{/each}}
      </div>
      <div class='new-session-settings-footer'>
        <Button
          @kind='primary'
          @size='small'
          class='new-session-settings-create-button'
          data-test-new-session-settings-create-button
          {{on 'click' this.handleCreateSession}}
        >
          Start New Session
        </Button>
      </div>
    </div>
    <style scoped>
      .new-session-settings-menu {
        --new-sessions-menu-foreground: #e0e0e0;

        background: var(--ai-assistant-menu-background);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 10px 15px 0 rgba(0, 0, 0, 0.25);
        border: solid 1px rgba(0, 0, 0, 0.25);
        padding: 6.5px 11px 11px 11px;
        min-width: 13.75rem;
        color: var(--new-sessions-menu-foreground);
      }
      .new-session-settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6.5px;
      }
      .new-session-settings-title {
        font-weight: 600;
        letter-spacing: var(--boxel-lsp-sm);
      }
      .new-session-settings-close-button:hover {
        color: var(--boxel-light);
      }
      .new-session-settings-options {
        display: flex;
        flex-direction: column;
        margin-bottom: var(--boxel-sp-sm);
      }
      .new-session-settings-option {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 7px 4px;
        border-radius: 5px;
        transition: background-color var(--boxel-transition);
      }
      .new-session-settings-option:hover {
        background-color: var(--ai-assistant-menu-hover-background);
      }
      .new-session-settings-option.checked {
        background-color: var(--boxel-650);
      }
      .new-session-settings-option input[type='checkbox'] {
        width: 18px;
        height: 18px;
        border-radius: 3px;
        border: solid 1px var(--boxel-400);
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        background-color: transparent;
        transition: background-color var(--boxel-transition);
        margin: 0;
      }
      .new-session-settings-option input[type='checkbox']:checked {
        background-color: var(--boxel-highlight);
        border-color: var(--boxel-highlight);
      }
      .new-session-settings-option input[type='checkbox']:checked::after {
        content: '';
        position: absolute;
        left: 5px;
        top: 2px;
        width: 4px;
        height: 8px;
        border: solid #333;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .new-session-settings-label {
        font-weight: 500;
        letter-spacing: var(--boxel-lsp-sm);
        text-wrap: nowrap;
      }
      .new-session-settings-footer {
        display: flex;
        justify-content: center;
      }
      .new-session-settings-create-button {
        width: 100%;
      }
    </style>
  </template>
}
