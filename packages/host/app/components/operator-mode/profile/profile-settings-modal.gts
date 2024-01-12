import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { type IAuthData } from 'matrix-js-sdk';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not, and, bool, eq, or } from '@cardstack/boxel-ui/helpers';

import ModalContainer from '@cardstack/host/components/modal-container';

import { ProfileInfo } from '@cardstack/host/components/operator-mode/profile-info-popover';
import config from '@cardstack/host/config/environment';
import { isValidPassword } from '@cardstack/host/lib/matrix-utils';
import MatrixService from '@cardstack/host/services/matrix-service';

import ProfileEmail from './profile-email';

interface Signature {
  Args: {
    toggleProfileSettings: () => void;
  };
  Element: HTMLElement;
}

export default class ProfileSettingsModal extends Component<Signature> {
  <template>
    <ModalContainer
      @onClose={{@toggleProfileSettings}}
      @title={{this.title}}
      @size='large'
      @centered={{true}}
      @isOpen={{true}}
      class='profile-settings-modal'
      data-test-settings-modal
    >
      <:sidebar>
        <ProfileInfo />
      </:sidebar>
      <:content>
        <form {{on 'submit' this.onSubmit}}>
          {{#unless (bool this.submode)}}
            <FieldContainer @label='Name' @tag='label' class='profile-field'>
              <BoxelInput
                data-test-display-name-field
                @value={{this.matrixService.profile.displayName}}
                @onInput={{this.setDisplayName}}
                @valid={{this.isDisplayNameValid}}
                @errorMessage={{if
                  (not this.isDisplayNameValid)
                  'Name is required'
                }}
                @state={{if
                  (and
                    this.showDisplayNameValidation (not this.isDisplayNameValid)
                  )
                  'invalid'
                }}
              />
            </FieldContainer>
          {{/unless}}
          {{#if (eq this.submode 'password')}}
            <FieldContainer
              @label='Current Password'
              @tag='label'
              class='profile-field'
            >
              <BoxelInput
                data-test-current-password-field
                type='password'
                @errorMessage={{this.currentPasswordError}}
                @state={{this.currentPasswordInputState}}
                @value={{this.currentPassword}}
                @onInput={{this.setCurrentPassword}}
              />
            </FieldContainer>
            <FieldContainer
              @label='New Password'
              @tag='label'
              class='profile-field'
            >
              <BoxelInput
                data-test-new-password-field
                type='password'
                @errorMessage={{this.newPasswordError}}
                @state={{this.newPasswordInputState}}
                @value={{this.newPassword}}
                @onInput={{this.setNewPassword}}
                @onBlur={{this.checkNewPassword}}
              />
            </FieldContainer>
            <FieldContainer
              @label='Confirm New Password'
              @tag='label'
              class='profile-field'
            >
              <BoxelInput
                data-test-confirm-password-field
                type='password'
                @errorMessage={{this.confirmPasswordError}}
                @state={{this.confirmPasswordInputState}}
                @value={{this.confirmPassword}}
                @onInput={{this.setConfirmPassword}}
                @onBlur={{this.checkConfirmPassword}}
              />
            </FieldContainer>
          {{else}}
            <ProfileEmail
              @onSetup={{this.setupProfileEmail}}
              @changeEmail={{this.changeEmail}}
              @disableSave={{this.disableSaveForEmail}}
              @changeEmailComplete={{this.completeEmail}}
            />
          {{/if}}
        </form>
        {{#if (or (bool this.displayNameError) (bool this.error))}}
          <div class='error-message' data-test-profile-save-error>
            {{if
              this.displayNameError
              this.displayNameError.message
              this.error
            }}
          </div>
        {{/if}}
      </:content>
      <:footer>
        <div class='buttons'>
          {{#unless (eq this.submode 'password')}}
            <BoxelButton
              data-test-change-password-button
              @size='tall'
              @kind='secondary-light'
              {{on 'click' this.changePassword}}
            >
              Change Password
            </BoxelButton>
          {{/unless}}
          <div class='right-buttons'>
            <BoxelButton
              data-test-confirm-cancel-button
              @size='tall'
              @kind='secondary-light'
              {{on 'click' this.cancel}}
            >
              Cancel
            </BoxelButton>

            <BoxelButton
              @kind='primary'
              @size='tall'
              @disabled={{this.isSaveButtonDisabled}}
              class='save-button'
              {{on 'click' (perform this.saveTask)}}
              data-test-profile-settings-save-button
            >
              {{this.saveButtonText}}
            </BoxelButton>
          </div>
        </div>
      </:footer>
    </ModalContainer>

    <style>
      .buttons {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
      }
      .right-buttons {
        margin-left: auto;
      }
      .right-buttons > :not(:first-child) {
        margin-left: var(--boxel-sp-xs);
      }
      .profile-settings-modal {
        height: 70vh;
      }
      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
      .profile-field :deep(.invalid) {
        box-shadow: none;
      }
      .profile-field + .profile-field {
        margin-top: var(--boxel-sp-xl);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private displayName: string | undefined;
  @tracked private submode: 'email' | 'password' | undefined;
  @tracked private saveSuccessIndicatorShown = false;
  @tracked private displayNameError: Error | undefined;
  @tracked private showDisplayNameValidation = false;
  @tracked private isSaveDisabledForEmail = false;
  @tracked private currentPassword: string | undefined;
  @tracked private currentPasswordError: string | undefined;
  @tracked private newPassword: string | undefined;
  @tracked private newPasswordError: string | undefined;
  @tracked private confirmPassword: string | undefined;
  @tracked private confirmPasswordError: string | undefined;
  @tracked private error: string | undefined;
  private onSaveEmail: (() => void) | undefined;
  private resetChangeEmail: (() => void) | undefined;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.setInitialValues.perform();
  }

  private get title() {
    switch (this.submode) {
      case 'email':
        return `Settings > Email`;
      case 'password':
        return `Settings > Password`;
      default:
        return 'Settings';
    }
  }

  private get saveButtonText() {
    if (this.saveSuccessIndicatorShown) {
      return 'Saved!';
    }
    return this.saveTask.isRunning ? 'Saving…' : 'Save';
  }

  private get isDisplayNameValid() {
    return this.displayName !== undefined && this.displayName.length > 0;
  }

  private get isSaveButtonDisabled() {
    return (
      (!this.submode &&
        (this.saveTask.isRunning ||
          !this.isDisplayNameValid ||
          this.displayName === this.matrixService.profile.displayName)) ||
      (this.submode === 'email' && this.isSaveDisabledForEmail) ||
      (this.submode === 'password' && this.isSaveButtonDisabledForPassword)
    );
  }

  private get isSaveButtonDisabledForPassword() {
    return this.hasPasswordMissingFields || this.hasPasswordError;
  }

  private get hasPasswordMissingFields() {
    return !this.currentPassword || !this.newPassword || !this.confirmPassword;
  }

  private get hasPasswordError() {
    return (
      this.currentPasswordError ||
      this.newPasswordError ||
      this.confirmPasswordError
    );
  }

  @action private setDisplayName(name: string) {
    // We don't want to show validation error until the user has interacted with the field,
    // i.e. when display name is blank and user opens settings modal
    this.showDisplayNameValidation = true;
    this.displayName = name;
  }

  @action private changeEmail() {
    this.submode = 'email';
  }

  @action private completeEmail() {
    if (this.submode === 'email') {
      this.submode = undefined;
    }
  }

  @action private changePassword() {
    this.submode = 'password';
  }

  @action private cancel() {
    if (this.submode === 'email') {
      this.resetChangeEmail?.();
    }

    if (this.submode) {
      this.submode = undefined;
    } else {
      this.args.toggleProfileSettings();
    }
  }

  @action private onSubmit(event: Event) {
    event.preventDefault();
    this.saveTask.perform();
  }

  @action private setupProfileEmail(
    onSave: () => void,
    resetChangeEmail: () => void,
  ) {
    this.onSaveEmail = onSave;
    this.resetChangeEmail = resetChangeEmail;
  }

  @action private disableSaveForEmail(isDisabled: boolean) {
    this.isSaveDisabledForEmail = isDisabled;
  }

  @action private setCurrentPassword(currentPassword: string) {
    this.currentPassword = currentPassword;
    this.currentPasswordError = undefined;
  }

  @action private setNewPassword(newPassword: string) {
    this.newPassword = newPassword;
    this.newPasswordError = undefined;
  }

  @action private setConfirmPassword(confirmPassword: string) {
    this.confirmPassword = confirmPassword;
    this.confirmPasswordError = undefined;
  }

  @action
  private checkNewPassword() {
    if (!this.newPassword) {
      this.newPasswordError = 'Password is missing';
    } else if (!isValidPassword(this.newPassword)) {
      this.newPasswordError =
        'Password must be at least 8 characters long and include a number and a symbol';
    }
  }

  @action
  private checkConfirmPassword() {
    if (this.confirmPassword !== this.newPassword) {
      this.confirmPasswordError = 'Passwords do not match';
    }
  }

  private get currentPasswordInputState() {
    return this.currentPasswordError ? 'invalid' : 'initial';
  }

  private get newPasswordInputState() {
    return this.newPasswordError ? 'invalid' : 'initial';
  }

  private get confirmPasswordInputState() {
    return this.confirmPasswordError ? 'invalid' : 'initial';
  }

  private saveTask = restartableTask(async () => {
    await this.matrixService.profile.loaded; // Prevent saving before profile is loaded

    if (this.submode === 'email') {
      this.onSaveEmail?.();
      return;
    } else if (this.submode === 'password') {
      await this.onSavePassword();
      return;
    }

    this.displayNameError = undefined;
    if (this.displayName !== this.matrixService.profile.displayName) {
      try {
        await all([
          this.matrixService.setDisplayName(this.displayName || ''),
          timeout(config.minSaveTaskDurationMs),
        ]);
      } catch (e) {
        this.displayNameError = new Error(
          'Failed to save profile. Please try again.',
        );
      }
      this.matrixService.reloadProfile(); // To get the updated display name in templates
      this.afterSaveTask.perform();
    }
  });

  private async onSavePassword() {
    if (!this.currentPassword) {
      throw new Error(
        'bug: should never get here: current password is required',
      );
    } else if (!this.newPassword) {
      throw new Error('bug: should never get here: new password is required');
    }

    try {
      this.error = undefined;
      let auth = {
        type: 'm.login.password',
        user: this.matrixService.userId,
        password: this.currentPassword,
        identifier: {
          type: 'm.id.user',
          user: this.matrixService.userId,
        },
      } as IAuthData & { type: string };
      await this.matrixService.client.setPassword(auth, this.newPassword);
      this.resetPasswordFields();
      this.submode = undefined;
    } catch (e: any) {
      if ('errcode' in e.data && e.data.errcode === 'M_FORBIDDEN') {
        this.currentPasswordError = 'Invalid password';
      } else {
        this.error = 'Unknown error';
      }
    }
  }

  private resetPasswordFields() {
    this.currentPassword = undefined;
    this.newPassword = undefined;
    this.confirmPassword = undefined;
    this.currentPasswordError = undefined;
    this.newPasswordError = undefined;
    this.confirmPasswordError = undefined;
  }

  private afterSaveTask = restartableTask(async () => {
    this.saveSuccessIndicatorShown = true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    this.saveSuccessIndicatorShown = false;
  });

  private setInitialValues = restartableTask(async () => {
    await this.matrixService.profile.loaded;
    this.displayName = this.matrixService.profile.displayName;
  });
}
