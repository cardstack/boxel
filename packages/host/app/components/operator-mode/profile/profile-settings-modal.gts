import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not, and, bool } from '@cardstack/boxel-ui/helpers';

import ModalContainer from '@cardstack/host/components/modal-container';

import { ProfileInfo } from '@cardstack/host/components/operator-mode/profile-info-popover';
import config from '@cardstack/host/config/environment';

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
          <ProfileEmail
            @onSetup={{this.setupProfileEmail}}
            @changeEmail={{this.changeEmail}}
            @disableSave={{this.disableSaveForEmail}}
            @changeEmailComplete={{this.completeEmail}}
          />
        </form>
        {{#if this.displayNameError}}
          <div class='error-message' data-test-profile-save-error>
            {{this.displayNameError.message}}
          </div>
        {{/if}}
      </:content>
      <:footer>
        <div class='buttons'>
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
      </:footer>
    </ModalContainer>

    <style>
      .buttons {
        margin-left: auto;
        margin-top: auto;
        margin-bottom: auto;
      }
      .buttons > :not(:first-child) {
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
      (this.submode === 'email' && this.isSaveDisabledForEmail)
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

  private saveTask = restartableTask(async () => {
    await this.matrixService.profile.loaded; // Prevent saving before profile is loaded

    if (this.submode === 'email') {
      this.onSaveEmail?.();
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
