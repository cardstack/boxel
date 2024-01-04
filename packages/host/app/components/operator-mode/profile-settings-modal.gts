import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout, all } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { type IAuthData } from 'matrix-js-sdk';
import { v4 as uuidv4 } from 'uuid';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not, and, bool, eq } from '@cardstack/boxel-ui/helpers';

import {
  CheckMark,
  IconX,
  Warning as WarningIcon,
} from '@cardstack/boxel-ui/icons';

import ModalContainer from '@cardstack/host/components/modal-container';

import { ProfileInfo } from '@cardstack/host/components/operator-mode/profile-info-popover';
import config from '@cardstack/host/config/environment';
import MatrixService from '@cardstack/host/services/matrix-service';

interface PasswordModalSignature {
  Args: {
    confirmPassword: (password: string) => void;
    clearPasswordError: () => void;
    togglePasswordModal: () => void;
    passwordError: string | undefined;
  };
  Element: HTMLElement;
}

class PasswordModal extends Component<PasswordModalSignature> {
  @tracked private password = '';

  private get passwordInputState() {
    return this.args.passwordError ? 'invalid' : 'initial';
  }

  @action private setPassword(password: string) {
    this.args.clearPasswordError();
    this.password = password;
  }

  <template>
    <ModalContainer
      @onClose={{@togglePasswordModal}}
      @title='Confirm Identity'
      @size='small'
      @centered={{true}}
      @isOpen={{true}}
      class='password-modal'
      data-test-password-modal
    >
      <:content>
        <div class='instructions'>
          Confirm your identity by entering your password below.
        </div>
        <FieldContainer @tag='label' @vertical={{true}}>
          <BoxelInput
            data-test-password-field
            @type='password'
            @value={{this.password}}
            @state={{this.passwordInputState}}
            @errorMessage={{@passwordError}}
            @onInput={{this.setPassword}}
          />
        </FieldContainer>
      </:content>
      <:footer>
        <div class='buttons'>
          <BoxelButton
            data-test-password-confirm-cancel-button
            @size='tall'
            @kind='secondary-light'
            {{on 'click' @togglePasswordModal}}
          >
            Cancel
          </BoxelButton>

          <BoxelButton
            @kind='primary'
            @size='tall'
            @disabled={{not this.password}}
            class='confirm-button'
            {{on 'click' (fn @confirmPassword this.password)}}
            data-test-confirm-password-button
          >
            Confirm
          </BoxelButton>
        </div>
      </:footer>
    </ModalContainer>
    <style>
      .password-modal :deep(.boxel-modal__inner) {
        height: 21rem;
        margin-top: calc((100vh - 21rem) / 2);
      }
      .password-modal :deep(.invalid) {
        box-shadow: none;
      }
      .buttons {
        margin-left: auto;
        margin-top: auto;
        margin-bottom: auto;
      }
      .buttons > :not(:first-child) {
        margin-left: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

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
      @title='Settings'
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
          <FieldContainer
            @label='Name'
            @tag='label'
            class='profile-field'
            @vertical={{false}}
          >
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
          {{#if this.hasPendingEmailChange}}
            <FieldContainer
              @label='Current Email'
              @tag='label'
              class='profile-field'
              @vertical={{false}}
            >
              <div class='email-versions'>
                <div class='email-version current'>
                  <div class='header'>Current</div>
                  <div
                    class='email-value'
                    data-test-current-email
                  >{{this.matrixService.profile.email}}</div>
                  <div class='verification-status'>
                    <div class='indicator'>
                      <CheckMark class='checked' />
                      <span class='verification'>Verified</span>
                    </div>
                  </div>
                </div>
                <div class='email-version pending'>
                  <div class='header'>Pending</div>
                  <div
                    class='email-value'
                    data-test-new-email
                  >{{this.email}}</div>
                  <div class='verification-status'>
                    <div class='indicator'>
                      <IconX class='cross-out' />
                      <span
                        class='verification'
                        data-test-new-email-not-verified
                      >Not Verified</span>
                    </div>
                    <BoxelButton
                      @kind='text-only'
                      @size='extra-small'
                      @loading={{this.isResending}}
                      data-test-resend-validation
                      {{on 'click' this.resendEmailVerification}}
                    >Resend</BoxelButton>
                    <BoxelButton
                      @kind='secondary-light'
                      @size='extra-small'
                      data-test-cancel-email-change
                      {{on 'click' this.cancelEmailChange}}
                    >Cancel</BoxelButton>
                  </div>
                </div>
              </div>
            </FieldContainer>
          {{else}}
            <FieldContainer
              @label='Current Email'
              @tag='label'
              class='profile-field'
              @vertical={{false}}
            >
              <div class='email'>
                {{#if this.matrixService.profile.email}}
                  <div class='email-value' data-test-current-email>
                    {{this.matrixService.profile.email}}
                  </div>
                  <div class='verification-status'>
                    <div class='indicator'>
                      <CheckMark class='checked' />
                      <span class='verification'>Verified</span>
                    </div>
                  </div>
                {{else}}
                  <div class='email-value' data-test-no-current-email>- email
                    not set -</div>
                {{/if}}
              </div>
            </FieldContainer>
            <FieldContainer
              @label='New Email'
              @tag='label'
              class='profile-field'
              @vertical={{false}}
            >
              <div class='email'>
                <BoxelInput
                  data-test-new-email-field
                  @value={{this.email}}
                  @onInput={{this.setEmail}}
                  @errorMessage={{this.emailError}}
                  @state={{this.emailValidationState}}
                />
                {{#if
                  (and
                    (eq this.emailState.type 'validateEmail') (bool this.email)
                  )
                }}
                  <div class='warning-box' data-test-email-validation-msg>
                    <div class='warning-title'>
                      <WarningIcon
                        class='warning-icon'
                        width='20px'
                        height='20px'
                        role='presentation'
                      />
                      <span>Before you proceed...</span>
                    </div>
                    <p class='warning'>
                      You will need to
                      <strong>verify your new email address</strong>
                      before the change will take effect. You may cancel this
                      process anytime before you verify your new email.
                    </p>
                  </div>
                {{/if}}
              </div>
            </FieldContainer>
          {{/if}}
        </form>

        {{! TODO this should move into the display field input}}
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
            {{on 'click' @toggleProfileSettings}}
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

    {{#if this.showPasswordModal}}
      <PasswordModal
        @confirmPassword={{this.confirmPasswordForEmailChange}}
        @clearPasswordError={{this.clearPasswordError}}
        @togglePasswordModal={{this.cancelEmailChange}}
        @passwordError={{this.passwordError}}
      />
    {{/if}}

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
      .verification-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .indicator {
        display: flex;
        align-items: center;
      }
      .checked {
        --icon-color: var(--boxel-green);
      }
      .cross-out {
        --icon-color: var(--boxel-red);
      }
      .warning-box {
        margin-top: var(--boxel-sp-xl);
        border-radius: var(--boxel-border-radius);
        border: 2px solid var(--boxel-warning-100);
      }
      .warning-title {
        display: flex;
        align-items: center;
        text-transform: uppercase;
        font-weight: bold;
        padding: var(--boxel-sp-xxs);
        background-color: var(--boxel-warning-100);
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
      }
      .warning-title span {
        margin-left: var(--boxel-sp-xs);
      }
      .warning {
        padding: var(--boxel-sp);
        margin: 0;
      }
      .email-versions {
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .email-version {
        position: relative;
        padding: var(--boxel-sp-xxs) var(--boxel-sp) var(--boxel-sp-sm);
      }
      .email-version:before {
        content: ' ';
        height: calc(100% - 20px);
        width: 3px;
        display: block;
        position: absolute;
        top: 10px;
        left: -4px;
      }
      .email-version.current:before {
        background-color: var(--boxel-red);
      }
      .email-version.pending:before {
        background-color: var(--boxel-green);
      }
      .email-version + .email-version {
        border-top: 1px solid var(--boxel-form-control-border-color);
      }
      .email-version.current {
        border-top-left-radius: var(--boxel-form-control-border-radius);
        border-top-right-radius: var(--boxel-form-control-border-radius);
        background-color: var(--boxel-100);
      }
      .email-version .header {
        text-transform: uppercase;
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        font-weight: 500;
        margin-bottom: var(--boxel-sp-xs);
      }
      .current .header {
        color: var(--boxel-red);
      }
      .pending .header {
        color: var(--boxel-green);
      }
      .email-value {
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .verification {
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        font-weight: 600;
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private displayName: string | undefined;
  @tracked private emailError: string | undefined;
  @tracked private saveSuccessIndicatorShown = false;
  @tracked private displayNameError: Error | undefined;
  @tracked private showDisplayNameValidation = false;
  @tracked private emailState:
    | { type: 'initial' }
    | { type: 'validateEmail'; email: string }
    | {
        type: 'askForPassword';
        email: string;
        passwordError?: string;
      }
    | {
        type: 'requestEmailValidation';
        email: string;
        clientSecret: string;
        sendAttempt: number;
        password: string;
      }
    | {
        type: 'sendPassword';
        email: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
        password: string;
      }
    | {
        type: 'waitForValidation';
        email: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
        password: string;
      } = { type: 'initial' };

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.setInitialValues.perform();
  }

  private get email() {
    if (this.emailState.type === 'initial') {
      return undefined;
    }
    return this.emailState.email;
  }

  private get emailValidationState() {
    return this.emailError ? 'invalid' : 'initial';
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
      (this.saveTask.isRunning ||
        !this.isDisplayNameValid ||
        this.displayName === this.matrixService.profile.displayName) &&
      (this.emailState.type !== 'validateEmail' ||
        this.emailError ||
        !this.email)
    );
  }

  private get hasPendingEmailChange() {
    return [
      'askForPassword',
      'requestEmailValidation',
      'sendPassword',
      'waitForValidation',
    ].includes(this.emailState.type);
  }

  private get showPasswordModal() {
    return (
      this.emailState.type === 'askForPassword' ||
      // we only ask for password the first time we make a request for email
      // validation--the subsequent times we use the password already provided
      (this.emailState.type === 'sendPassword' &&
        this.emailState.sendAttempt === 1) ||
      (this.emailState.type === 'requestEmailValidation' &&
        this.emailState.sendAttempt === 1)
    );
  }

  private get passwordError() {
    if (this.emailState.type === 'askForPassword') {
      return this.emailState.passwordError;
    }
    return undefined;
  }

  private get isResending() {
    return (
      (this.emailState.type === 'requestEmailValidation' ||
        this.emailState.type === 'sendPassword') &&
      this.emailState.sendAttempt > 1
    );
  }

  @action private setDisplayName(name: string) {
    // We don't want to show validation error until the user has interacted with the field,
    // i.e. when display name is blank and user opens settings modal
    this.showDisplayNameValidation = true;
    this.displayName = name;
  }

  @action private setEmail(email: string) {
    this.emailError = undefined;
    this.emailState = {
      type: 'validateEmail',
      email,
    };
  }

  @action private cancelEmailChange() {
    this.emailState = { type: 'initial' };
  }

  @action private clearPasswordError() {
    if (this.emailState.type !== 'askForPassword') {
      throw new Error(
        `invalid state: cannot perform clearPasswordError in state ${this.emailState.type}`,
      );
    }
    this.emailState = {
      ...this.emailState,
      passwordError: undefined,
    };
  }

  @action private confirmPasswordForEmailChange(password: string) {
    if (this.emailState.type !== 'askForPassword') {
      throw new Error(
        `invalid state: cannot perform confirmPasswordForEmailChange in state ${this.emailState.type}`,
      );
    }
    this.emailState = {
      ...this.emailState,
      password,
      clientSecret: uuidv4(),
      sendAttempt: 1,
      type: 'requestEmailValidation',
    };
    this.doEmailFlow.perform();
  }

  @action private onSubmit(event: Event) {
    event.preventDefault();
    this.saveTask.perform();
  }

  @action private resendEmailVerification() {
    if (
      this.emailState.type !== 'waitForValidation' &&
      this.emailState.type !== 'sendPassword'
    ) {
      throw new Error(
        `invalid state: cannot perform resendEmailVerification in state ${this.emailState.type}`,
      );
    }
    this.emailState = {
      ...this.emailState,
      clientSecret: uuidv4(),
      sendAttempt: this.emailState.sendAttempt + 1,
      type: 'requestEmailValidation',
    };
    this.doEmailFlow.perform();
  }

  private saveTask = restartableTask(async () => {
    await this.matrixService.profile.loaded; // Prevent saving before profile is loaded

    if (this.emailState.type === 'validateEmail') {
      this.emailState = {
        type: 'askForPassword',
        email: this.emailState.email,
      };
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

  private doEmailFlow = restartableTask(async () => {
    if (
      this.emailState.type === 'initial' ||
      this.emailState.type === 'validateEmail' ||
      this.emailState.type === 'askForPassword'
    ) {
      throw new Error(
        `invalid state: cannot perform doEmailFlow in state ${this.emailState.type}`,
      );
    }
    if (this.emailState.type === 'requestEmailValidation') {
      try {
        let response = await this.matrixService.requestChangeEmailToken(
          this.emailState.email,
          this.emailState.clientSecret,
          this.emailState.sendAttempt,
        );
        let { sid } = response;
        this.emailState.type;
        this.emailState = {
          ...this.emailState,
          type: 'sendPassword',
          sid,
        };
      } catch (e: any) {
        if ('errcode' in e.data) {
          switch (e.data.errcode) {
            case 'M_THREEPID_IN_USE':
              this.emailError = 'Email address is already in use';
              break;
            case 'M_BAD_JSON':
              this.emailError = 'Email address is formatted incorrectly';
              break;
            default:
              this.emailError = e.data.error;
          }
          this.emailState = {
            ...this.emailState,
            type: 'validateEmail',
          };
          return;
        }
        throw e;
      }
    }

    let auth = {
      type: 'm.login.password',
      user: this.matrixService.userId,
      password: this.emailState.password,
      identifier: {
        type: 'm.id.user',
        user: this.matrixService.userId,
      },
    } as IAuthData & { type: string };

    let emailAdded = false;
    try {
      await this.matrixService.client.addThreePidOnly({
        auth,
        client_secret: this.emailState.clientSecret,
        sid: this.emailState.sid,
      });
      emailAdded = true;
    } catch (e: any) {
      if ('errcode' in e.data) {
        switch (e.data.errcode) {
          case 'M_THREEPID_AUTH_FAILED':
            // If current type is already 'waitForValidation',
            // it means we are polling the validation.
            if (this.emailState.type === 'waitForValidation') {
              await timeout(1000);
            }
            this.emailState = {
              ...this.emailState,
              type: 'waitForValidation',
            };
            this.doEmailFlow.perform();
            return;
          case 'M_FORBIDDEN':
            this.emailState = {
              ...this.emailState,
              type: 'askForPassword',
              passwordError: 'Invalid password',
            };
            return;
        }
      }
      throw e;
    }

    if (emailAdded && this.matrixService.profile.email) {
      // finally we remove the old email from the account
      let oldEmails = this.matrixService.profile.threePids;
      await Promise.all(
        oldEmails.map((email) =>
          this.matrixService.client.deleteThreePid('email', email),
        ),
      );
      this.emailState = { type: 'initial' };
      this.matrixService.reloadProfile();
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
