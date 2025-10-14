import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import PlusIcon from '@cardstack/boxel-icons/plus';
import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { TooltipIconButton } from '@cardstack/boxel-ui/components';

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
      <TooltipIconButton
        class='new-session-button'
        @icon={{PlusIcon}}
        @kind='primary-text-only'
        @size='small'
        @width='18px'
        @height='18px'
        @disabled={{@disabled}}
        {{on 'click' this.handleCreateNewSession}}
        data-test-create-room-btn
      >
        <:tooltipContent>
          {{#if this.showMenu}}
            Close New Session Settings
          {{else}}
            New Session (Shift+Click for options)
          {{/if}}
        </:tooltipContent>
      </TooltipIconButton>

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
      .new-session-button-container.menu-open .new-session-button {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight-hover);
      }
    </style>
  </template>
}
