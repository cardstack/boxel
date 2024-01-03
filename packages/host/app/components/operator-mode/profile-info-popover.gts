import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import ProfileAvatarIcon from '@cardstack/host/components/operator-mode/profile-avatar-icon';
import MatrixService from '@cardstack/host/services/matrix-service';

interface ProfileInfoPopoverSignature {
  Args: {
    toggleProfileSettings: () => void;
  };
  Element: HTMLElement;
}

interface ProfileInfoSignature {
  Args: {};
  Element: HTMLElement;
}

export default class ProfileInfoPopover extends Component<ProfileInfoPopoverSignature> {
  @service declare matrixService: MatrixService;

  @action logout() {
    this.matrixService.logout();
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
        display: flex;
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
    </style>

    <div class='profile-popover' data-test-profile-popover ...attributes>
      <header class='header'>
        <div class='label'>
          Signed in as
        </div>

        <BoxelButton
          @kind='secondary-light'
          @size='extra-small'
          {{on 'click' @toggleProfileSettings}}
          data-test-settings-button
        >
          Settings
        </BoxelButton>
      </header>

      <ProfileInfo />

      <BoxelButton
        {{on 'click' this.logout}}
        @kind='primary-dark'
        data-test-signout-button
      >
        Sign out
      </BoxelButton>
    </div>
  </template>
}

export class ProfileInfo extends Component<ProfileInfoSignature> {
  @service declare matrixService: MatrixService;

  <template>
    <div class='profile-popover-body' data-test-profile-icon-container>
      <ProfileAvatarIcon
        @userId={{this.matrixService.userId}}
        @cssVariables={{hash
          profile-avatar-icon-size='70px'
          profile-avatar-icon-border='0'
        }}
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
