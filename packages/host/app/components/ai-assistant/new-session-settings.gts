import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

interface Signature {
  Args: {
    selectedOptions: Set<string>;
    onOptionChange: (option: string, checked: boolean) => void;
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

  <template>
    <div class='new-session-settings-menu' data-test-new-session-settings-menu>
      <div
        class='new-session-settings-title'
        data-test-new-session-settings-title
      >New Session Options</div>
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
    </div>
    <style scoped>
      .new-session-settings-menu {
        background: var(--ai-assistant-menu-background);
        border-radius: 10px;
        box-shadow: 0 10px 15px 0 rgba(0, 0, 0, 0.25);
        border: solid 1px rgba(0, 0, 0, 0.25);
        padding: 6.5px 11px;
        min-width: 220px;
      }
      .new-session-settings-title {
        font-family: Poppins, sans-serif;
        font-size: 13px;
        font-weight: 600;
        font-stretch: normal;
        font-style: normal;
        line-height: 1.23;
        letter-spacing: 0.2px;
        text-align: left;
        color: #e0e0e0;
        margin-bottom: 10px;
      }
      .new-session-settings-options {
        display: flex;
        flex-direction: column;
      }
      .new-session-settings-option {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 8px 4px;
        border-radius: 5px;
        transition: background-color 0.2s ease;
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
        border: solid 1px #afafb7;
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        background-color: transparent;
        transition: background-color 0.2s ease;
        margin: 0;
      }
      .new-session-settings-option input[type='checkbox']:checked {
        background-color: var(--boxel-teal);
        border-color: var(--boxel-teal);
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
        font-family: Poppins, sans-serif;
        font-size: 13px;
        font-weight: 500;
        font-stretch: normal;
        font-style: normal;
        line-height: 1.23;
        letter-spacing: 0.2px;
        text-align: left;
        color: #e0e0e0;
        text-wrap: nowrap;
      }
    </style>
  </template>
}
