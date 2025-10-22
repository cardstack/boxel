import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import PlusIcon from '@cardstack/boxel-icons/plus';
import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { IconButton, Tooltip } from '@cardstack/boxel-ui/components';

import NewSessionSettings from './new-session-settings';

interface Signature {
  Args: {
    disabled?: boolean;
    onCreateNewSession: (opts?: {
      addSameSkills: boolean;
      shouldCopyFileHistory: boolean;
      shouldSummarizeSession: boolean;
    }) => void;
  };
}

export default class NewSessionButton extends Component<Signature> {
  @tracked showMenu = false;
  @tracked selectedOptions: Set<string> = new Set();

  @action
  updateOption(option: string, checked: boolean) {
    if (checked) {
      this.selectedOptions.add(option);
    } else {
      this.selectedOptions.delete(option);
    }
    this.selectedOptions = new Set(this.selectedOptions);
  }

  @action
  handleCreateNewSession(event: MouseEvent) {
    // Check if Shift key is pressed or menu is open
    if (event.shiftKey || this.showMenu) {
      event.preventDefault();
      this.showMenu = !this.showMenu;
      return;
    }

    this.args.onCreateNewSession();
  }

  @action
  closeMenu() {
    this.showMenu = false;
  }

  @action
  handleCreateNewSessionFromSettings() {
    this.args.onCreateNewSession({
      addSameSkills: this.selectedOptions.has('Add Same Skills'),
      shouldCopyFileHistory: this.selectedOptions.has('Copy File History'),
      shouldSummarizeSession: this.selectedOptions.has(
        'Summarize Current Session',
      ),
    });
    this.closeMenu();
  }

  <template>
    <div class='new-session-button-container {{if this.showMenu "menu-open"}}'>
      <Tooltip>
        <:trigger>
          <IconButton
            class='button new-session-button'
            @icon={{PlusIcon}}
            @size='extra-small'
            @width='18'
            @height='18'
            @disabled={{@disabled}}
            aria-expanded='{{this.showMenu}}'
            {{on 'click' this.handleCreateNewSession}}
            data-test-create-room-btn
          />
        </:trigger>
        <:content>
          {{#if this.showMenu}}
            Close New Session Settings
          {{else}}
            New Session (Shift+Click for options)
          {{/if}}
        </:content>
      </Tooltip>

      {{! TODO: remove feature flag once all options are implemented }}
      {{#if this.showMenu}}
        <div class='new-session-menu-wrapper' {{onClickOutside this.closeMenu}}>
          <NewSessionSettings
            @selectedOptions={{this.selectedOptions}}
            @onOptionChange={{this.updateOption}}
            @onClose={{this.closeMenu}}
            @onCreateSession={{this.handleCreateNewSessionFromSettings}}
          />
        </div>
      {{/if}}
    </div>

    <style scoped>
      .new-session-button-container {
        position: relative;
      }
      .new-session-menu-wrapper {
        position: absolute;
        top: 20px;
        right: 0;
        z-index: 1000;
      }
      .button {
        width: var(--boxel-button-mini);
        height: var(--boxel-button-mini);
        padding: 0;
        transform: translateY(-1px);
      }
      .button :deep(svg) {
        stroke-width: 2.5;
      }
      .button :deep(.loading-icon) {
        width: 16px;
        height: 16px;
      }
      .button:not(:disabled) {
        color: var(--boxel-highlight);
      }
      .button:hover:not(:disabled) {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
      }
      .button[aria-expanded='true'] {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight-hover);
      }
    </style>
  </template>
}
