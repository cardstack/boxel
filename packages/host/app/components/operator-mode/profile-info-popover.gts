import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not } from '@cardstack/boxel-ui/helpers';

import ModalContainer from '@cardstack/host/components/modal-container';
import ProfileAvatarIcon from '@cardstack/host/components/operator-mode/profile-avatar-icon';
import MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {};
  Element: HTMLElement;
}

export default class ProfileInfoPopover extends Component<Signature> {
  @service declare matrixService: MatrixService;
  @tracked private isOpened = false;
  @tracked private profileSettingsOpened = false;
  @tracked private displayName;

  @action setPopoverProfileOpen(open: boolean) {
    this.isOpened = open;
  }

  @action openSettings() {
    this.isOpened = false;
    this.profileSettingsOpened = true;
  }

  @action closeSettings() {
    this.profileSettingsOpened = false;
  }

  @action logout() {
    this.matrixService.logout();
  }

  @action setDisplayName(name: string) {
    this.displayName = name;
  }

  @action save() {
    // this.matrixService.setDisplayName(this.displayName);
    // this.profileSettingsOpened = false;
  }

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    this.displayName = this.matrixService.profile.displayName || '';
  }

  <template>
    <style>
      .profile-popover {
        width: 280px;
        height: 280px;
        position: absolute;
        bottom: 68px;
        left: 20px;
        z-index: 1;
        background: white;
        padding: var(--boxel-sp);
        flex-direction: column;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        transition: all 0.1s ease-out;
        opacity: 0;
        display: flex;
      }

      .profile-popover.opened {
        opacity: 1;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header .label {
        color: var(--boxel-dark);
        text-transform: uppercase;
      }

      .profile-icon-container {
        bottom: 0;
        position: absolute;
        width: var(--search-sheet-closed-height);
        height: var(--search-sheet-closed-height);
        border-radius: 50px;
        margin-left: var(--boxel-sp);
        z-index: 1;
      }

      .profile-icon-button {
        border: 0;
        padding: 0;
        background: transparent;
      }
    </style>

    <div class='profile-icon-container'>
      <button
        class='profile-icon-button'
        {{on 'click' (fn this.setPopoverProfileOpen (not this.isOpened))}}
        data-test-profile-icon-button
      >
        <ProfileAvatarIcon @userId={{this.matrixService.userId}} />
      </button>
    </div>

    {{#if this.isOpened}}
      <div
        class='profile-popover {{if this.isOpened "opened"}}'
        {{onClickOutside
          (fn this.setPopoverProfileOpen false)
          exceptSelector='.profile-icon-button'
        }}
        data-test-profile-popover
      >
        <header class='header'>
          <div class='label'>
            Signed in as
          </div>

          <BoxelButton
            @kind='secondary-light'
            @size='extra-small'
            {{on 'click' this.openSettings}}
            data-test-settings-button
          >
            Settings
          </BoxelButton>
        </header>

        <Profile />

        <BoxelButton
          {{on 'click' this.logout}}
          @kind='primary-dark'
          data-test-signout-button
        >
          Sign out
        </BoxelButton>
      </div>
    {{/if}}

    {{#if this.profileSettingsOpened}}
      <ModalContainer
        @onClose={{this.closeSettings}}
        @title='Settings'
        @size='large'
        @centered={{true}}
        @isOpen={{this.profileSettingsOpened}}
        data-test-settings-modal
      >
        <:sidebar>
          <Profile />
        </:sidebar>
        <:content>
          <FieldContainer
            @label='Name'
            @tag='label'
            class=''
            @vertical={{false}}
          >
            <BoxelInput
              data-test-token-field
              @value={{this.matrixService.profile.displayName}}
              @errorMessage=''
              @onInput={{this.setDisplayName}}
            />
          </FieldContainer>
        </:content>
      </ModalContainer>
    {{/if}}
  </template>
}

export class Profile extends Component<Signature> {
  @service declare matrixService: MatrixService;

  <template>
    <div class='profile-popover-body' data-test-profile-icon-container>
      <ProfileAvatarIcon
        @userId={{this.matrixService.userId}}
        class='profile-icon--big'
      />

      <div class='display-name' data-test-profile-display-name>
        {{this.matrixService.profile.displayName}}
      </div>

      <div class='profile-handle' data-test-profile-icon-handle>
        {{this.matrixService.userId}}
      </div>
    </div>
    <style>
      .profile-popover-body {
        margin: auto;
        display: flex;
        flex-direction: column;
      }

      .profile-popover-body > * {
        margin: auto;
      }

      .profile-popover-body > .profile-icon {
        width: 70px;
        height: 70px;
        font-size: var(--boxel-font-size-xxl);
      }

      .display-name {
        margin-top: var(--boxel-sp-xxxs);
        font-size: var(--boxel-font-size);
        font-weight: bold;
      }

      .profile-handle {
        margin-top: var(--boxel-sp-xxxxs);
        color: var(--boxel-500);
      }
    </style>
  </template>
}
