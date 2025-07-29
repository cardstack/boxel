import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import PlusIcon from '@cardstack/boxel-icons/plus';
import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { Button, Tooltip } from '@cardstack/boxel-ui/components';

import { and } from '@cardstack/boxel-ui/helpers';

import config from '@cardstack/host/config/environment';

import NewSessionSettings from './new-session-settings';

interface Signature {
  Args: {
    disabled?: boolean;
    onCreateNewSession: (addSameSkills: boolean) => void;
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
    // Check if Shift key is pressed
    if (event.shiftKey) {
      event.preventDefault();
      this.showMenu = !this.showMenu;
      return;
    }

    // Normal click behavior
    const addSameSkills = this.selectedOptions.has('Add Same Skills');
    this.args.onCreateNewSession(addSameSkills);
  }

  @action
  closeMenu() {
    this.showMenu = false;
  }

  <template>
    <div class='new-session-button-container'>
      <Tooltip>
        <:trigger>
          <Button
            title='New Session'
            class='button new-session-button {{if this.showMenu "menu-open"}}'
            @kind='text-only'
            @size='extra-small'
            @disabled={{@disabled}}
            {{on 'click' this.handleCreateNewSession}}
            data-test-create-room-btn
          >
            <PlusIcon />
          </Button>
        </:trigger>
        <:content>
          New Session (Shift+Click for options)
        </:content>
      </Tooltip>

      {{! TODO: remove feature flag once all options are implemented }}
      {{#if (and this.showMenu config.featureFlags.SHOW_NEW_SESSION_SETTINGS)}}
        <div class='new-session-menu-wrapper' {{onClickOutside this.closeMenu}}>
          <NewSessionSettings
            @selectedOptions={{this.selectedOptions}}
            @onOptionChange={{this.updateOption}}
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
        top: 18px;
        right: 0;
        z-index: 1000;
      }
      .button {
        --boxel-button-text-color: var(--boxel-highlight);
        --boxel-button-padding: 1px 0;
        --boxel-button-min-width: 0;
        --boxel-button-min-height: 0;
        --boxel-loading-indicator-size: 16px;

        border-radius: var(--boxel-border-radius-xs);
        transform: translateY(-1px);
      }
      .button:hover,
      .button.menu-open {
        --boxel-button-text-color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
      }
      .button[disabled] {
        --boxel-button-text-color: var(--boxel-400);
        background-color: transparent;
        border-color: transparent;
      }
      .button svg {
        width: 18px;
        height: 18px;
        stroke-width: 2.5;
      }
    </style>
  </template>
}
