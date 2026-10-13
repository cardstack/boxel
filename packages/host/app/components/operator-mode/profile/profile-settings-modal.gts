import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not, and, bool, eq, or } from '@cardstack/boxel-ui/helpers';

import CredentialFieldsFrame from '@cardstack/host/components/matrix/credential-fields';
import ModalContainer from '@cardstack/host/components/modal-container';

import { ProfileInfo } from '@cardstack/host/components/operator-mode/profile-info-popover';
import config from '@cardstack/host/config/environment';
import {
  CredentialFields,
  credentialFieldsError,
} from '@cardstack/host/lib/credential-fields';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import ProfileEmail from './profile-email';
import ProfileSubscription from './profile-subscription';

// Subscription sits below the fold in this fixed-height modal
const scrollIntoViewIfRequested = modifier(
  (element: HTMLElement, [requested]: [boolean]) => {
    if (requested) {
      element.scrollIntoView({ block: 'start' });
    }
  },
);

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
      @cardContainerClass='profile-settings'
      class='profile-settings-modal'
      data-test-settings-modal
    >
      <:sidebar>
        <ProfileInfo />
      </:sidebar>
      <:content>
        <form class='settings-form' {{on 'submit' this.onSubmit}}>
          {{#unless (bool this.submode)}}
            <FieldContainer @label='Name' @tag='label' class='profile-field'>
              <BoxelInput
                data-test-display-name-field
                @value={{this.matrixService.profile.displayName}}
                @onInput={{this.setDisplayName}}
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
            <CredentialFieldsFrame
              class='password-settings-fields'
              @form='change-password'
              @fields={{this.passwordFields}}
            />
          {{else}}
            <ProfileEmail
              @onSetup={{this.setupProfileEmail}}
              @changeEmail={{this.changeEmail}}
              @disableSave={{this.disableSaveForEmail}}
              @changeEmailComplete={{this.completeEmail}}
            />
          {{/if}}
          <div
            class='profile-settings-subscription'
            {{scrollIntoViewIfRequested this.subscriptionRequested}}
            data-test-profile-subscription-section
          >
            <ProfileSubscription />
          </div>
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
              class='profile-settings-change-pw-button'
              @size='tall'
              @kind='secondary-light'
              {{on 'click' this.changePassword}}
              data-test-change-password-button
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

    <style scoped>
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
      .profile-settings-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.profile-settings) {
        height: 80vh;
      }
      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
      .profile-field :deep(.invalid) {
        box-shadow: none;
      }

      .settings-form,
      .profile-settings-subscription {
        --settings-modal-gap: var(--boxel-sp-xl);
        display: grid;
        gap: var(--settings-modal-gap);
      }

      @container dialog-box (width <= 48rem) {
        .settings-form,
        .profile-settings-subscription {
          --settings-modal-gap: var(--boxel-sp);
        }
        /* The password fields stack their labels, as profile fields do. */
        .password-settings-fields {
          --credential-layout: narrow;
          --credential-fields-height: calc(
            (
                var(--boxel-sp-sm) + var(--boxel-body-font-size) * 1.1 +
                  var(--boxel-sp-xs) + var(--boxel-outline-width) * 2 +
                  var(--boxel-form-control-height)
              ) *
              3 + var(--settings-modal-gap) * 2
          );
        }
        .profile-settings-change-pw-button {
          margin-right: auto;
          padding-inline: var(--boxel-sp-xs);
          font-size: 0.8125rem;
        }
        .buttons {
          gap: var(--boxel-sp-xs);
        }
        .right-buttons > :not(:first-child) {
          margin-left: 0;
        }
        .right-buttons {
          display: flex;
          gap: var(--boxel-sp-xs);
        }
      }

      /* FieldContainer's 8rem label column is 40% of a phone-width modal,
         shredding the values beside it. Inherited from the form. */
      @container dialog-box (width <= 28rem) {
        .settings-form {
          --boxel-field-label-size: 5.5rem;
        }
      }
    </style>
  </template>

  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @tracked private displayName: string | undefined;
  @tracked private submode: 'email' | 'password' | undefined;
  @tracked private saveSuccessIndicatorShown = false;
  @tracked private displayNameError: Error | undefined;
  @tracked private showDisplayNameValidation = false;
  @tracked private isSaveDisabledForEmail = false;
  // The current, new and confirmed passwords are typed into a frame on the
  // secure origin, which changes the password. A new one is made each time
  // the password form opens, so it starts empty.
  @tracked private passwordFields = new CredentialFields();
  @tracked private error: string | undefined;
  private onSaveEmail: (() => void) | undefined;
  private resetChangeEmail: (() => void) | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.setInitialValues.perform();
  }

  private get subscriptionRequested() {
    return (
      this.operatorModeStateService.profileSettingsSection === 'subscription'
    );
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
    return !this.passwordFields.complete;
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
    this.passwordFields = new CredentialFields();
    this.passwordFields.setContext({
      username: this.matrixService.userId ?? undefined,
    });
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
    if (!this.passwordFields.complete) {
      throw new Error(
        'bug: should never get here: the current and new passwords are required',
      );
    }

    try {
      this.error = undefined;
      let result = await this.passwordFields.submit({
        operation: 'set-password',
        args: {
          auth: {
            type: 'm.login.password',
            user: this.matrixService.userId,
            identifier: {
              type: 'm.id.user',
              user: this.matrixService.userId,
            },
          },
          accessToken: this.matrixService.accessToken,
        },
      });
      if (!result.ok) {
        throw credentialFieldsError(result);
      }
      this.submode = undefined;
    } catch (e: any) {
      if ('errcode' in e.data && e.data.errcode === 'M_FORBIDDEN') {
        this.passwordFields.setFieldError('current', 'Invalid password');
      } else {
        this.error = 'Unknown error';
      }
    }
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
