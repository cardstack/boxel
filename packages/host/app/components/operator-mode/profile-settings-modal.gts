import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  CheckMark,
  IconX,
  Warning as WarningIcon,
} from '@cardstack/boxel-ui/icons';
import { type IAuthData } from 'matrix-js-sdk';

import { restartableTask, timeout } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { v4 as uuidv4 } from 'uuid';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
} from '@cardstack/boxel-ui/components';

import { not, and, bool, eq } from '@cardstack/boxel-ui/helpers';
import {
  isMatrixError,
  isInteractiveAuth,
  nextUncompletedStage,
  type InteractiveAuth,
} from '@cardstack/host/lib/matrix-utils';

import ModalContainer from '@cardstack/host/components/modal-container';

import { ProfileInfo } from '@cardstack/host/components/operator-mode/profile-info-popover';
import config from '@cardstack/host/config/environment';
import MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    toggleProfileSettings: () => void;
  };
  Element: HTMLElement;
}

export default class ProfileSettingsModal extends Component<Signature> {
  <template>
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
    </style>

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
                    {{#if this.emailHasBeenValidated}}
                      <div class='indicator'>
                        <CheckMark class='checked' />
                        <span
                          class='verification'
                          data-test-new-email-verified
                        >Verified</span>
                      </div>
                      <BoxelButton
                        @kind='secondary-light'
                        @size='extra-small'
                        data-test-cancel-email-change
                        {{on 'click' this.cancelEmailChange}}
                      >Cancel</BoxelButton>
                      <BoxelButton
                        @kind='primary'
                        @size='extra-small'
                        data-test-email-confirm-identity
                      >Confirm Identity</BoxelButton>
                    {{else}}
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
                        data-test-resend-button
                      >Resend</BoxelButton>
                      <BoxelButton
                        @kind='secondary-light'
                        @size='extra-small'
                        data-test-cancel-email-change
                        {{on 'click' this.cancelEmailChange}}
                      >Cancel</BoxelButton>
                    {{/if}}
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
    <style>
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
        type: 'requestEmailValidation';
        email: string;
        clientSecret: string;
        sendAttempt: number;
      }
    | {
        type: 'waitForValidation';
        email: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
        session?: string;
      }
    | {
        type: 'askForPassword';
        email: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
        session: string;
        password?: string;
      }
    | {
        type: 'sendPassword';
        email: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
        session: string;
        password: string;
      } = { type: 'initial' };

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.setInitialValues.perform();
  }

  private get email() {
    if (this.emailState.type === 'initial') {
      return;
    }
    return this.emailState.email;
  }

  private get emailValidationState() {
    return this.emailError ? 'invalid' : 'initial';
  }

  private get saveButtonText() {
    if (this.saveSuccessIndicatorShown) return 'Saved!';
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
      'requestEmailValidation',
      'waitForValidation',
      'askForPassword',
      'sendPassword',
    ].includes(this.emailState.type);
  }

  private get emailHasBeenValidated() {
    return ['askForPassword', 'sendPassword'].includes(this.emailState.type);
  }

  @action private setDisplayName(name: string) {
    this.showDisplayNameValidation = true; // We don't want to show validation error until the user has interacted with the field, i.e. when display name is blank and user opens settings modal
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

  @action private setPasswordForEmailChange(password: string) {
    if (this.emailState.type !== 'askForPassword') {
      throw new Error(
        `invalid state: cannot perform setPasswordForEmailChange in state ${this.emailState.type}`,
      );
    }
    this.emailState = {
      ...this.emailState,
      password,
    };
  }

  @action private confirmPasswordForEmailChange() {
    if (this.emailState.type !== 'askForPassword') {
      throw new Error(
        `invalid state: cannot perform confirmPasswordForEmailChange in state ${this.emailState.type}`,
      );
    }
    if (!this.emailState.password) {
      throw new Error(
        `cannot confirmPasswordForEmailChange, password is not set`,
      );
    }
    this;
    this.emailState = {
      ...this.emailState,
      password: this.emailState.password,
      type: 'sendPassword',
    };
    this.doEmailFlow.perform();
  }

  @action private onSubmit(event: Event) {
    event.preventDefault();
    this.saveTask.perform();
  }

  private saveTask = restartableTask(async () => {
    await this.matrixService.profile.loaded; // Prevent saving before profile is loaded

    this.displayNameError = undefined;

    // try {
    // TODO only perform updates of changed items
    // TODO include email update here too
    // TODO handle email already exists error
    if (this.emailState.type === 'validateEmail') {
      this.emailState = {
        type: 'requestEmailValidation',
        email: this.emailState.email,
        clientSecret: uuidv4(),
        sendAttempt: 1,
      };
    } else if (
      this.emailState.type === 'requestEmailValidation' ||
      this.emailState.type === 'waitForValidation'
    ) {
      this.emailState.sendAttempt++;
    }
    // we use Promise.allSettled because the rejection of on promise
    // should not effect the other promises
    let [maybeDisplayNameResponse, maybeEmailResponse] =
      await Promise.allSettled([
        this.displayName !== this.matrixService.profile.displayName
          ? this.matrixService.setDisplayName(this.displayName || '')
          : undefined,
        this.emailState.type === 'requestEmailValidation'
          ? this.matrixService.requestChangeEmailToken(
              this.emailState.email,
              this.emailState.clientSecret,
              this.emailState.sendAttempt,
            )
          : undefined,
        ,
        new Promise((resolve) =>
          setTimeout(resolve, config.minSaveTaskDurationMs),
        ),
      ]); // Add a bit of artificial delay if needed, to make the save button feel more responsive
    // } catch (e) {
    //   this.error = new Error('Failed to save profile. Please try again.');
    // }
    if (maybeDisplayNameResponse?.status === 'rejected') {
      this.displayNameError = new Error(
        'Failed to save profile. Please try again.',
      );
    }
    if (
      (maybeEmailResponse?.status === 'fulfilled' &&
        this.emailState.type === 'requestEmailValidation') ||
      this.emailState.type === 'waitForValidation'
    ) {
      this.emailState = {
        type: 'waitForValidation',
        email: this.emailState.email,
        clientSecret: this.emailState.clientSecret,
        sendAttempt: this.emailState.sendAttempt,
        sid: (maybeEmailResponse as PromiseFulfilledResult<{ sid: string }>)
          .value.sid,
      };
      this.doEmailFlow.perform();
    } else if (maybeEmailResponse.status === 'rejected') {
      // handle responses:
      // {"errcode":"M_THREEPID_IN_USE","error":"Email is already in use"}
      // {"errcode":"M_BAD_JSON","error":"1 validation error for EmailRequestTokenBody\nemail\n  Unable to parse email address (type=value_error)"}

      throw new Error(`TODO: email change request error handling`);
      // } else if (isMatrixError(e) && e.errcode === 'M_USER_IN_USE') {
      //   if (this.state.type === 'login') {
      //     throw new Error(
      //       `invalid state: cannot doRegistrationFlow() with errcode '${e.errcode}' in state ${this.state.type}`,
      //     );
      //   }
      //   this.usernameError = 'User Name is already taken';
      //   this.state = { type: 'initial' };
      // }
    }

    this.matrixService.reloadProfile(); // To get the updated display name in templates
    this.afterSaveTask.perform();
  });

  private doEmailFlow = restartableTask(async () => {
    if (
      this.emailState.type === 'initial' ||
      this.emailState.type === 'validateEmail' ||
      this.emailState.type === 'requestEmailValidation'
    ) {
      throw new Error(
        `invalid state: cannot perform doEmailFlow in state ${this.emailState.type}`,
      );
    }
    let response: any;
    let auth: (IAuthData & { type: string }) | undefined;
    if (this.emailState.type === 'sendPassword') {
      auth = {
        type: 'm.login.password',
        session: this.emailState.session,
        password: this.emailState.password,
        identifier: {
          type: 'm.id.user',
          user: this.matrixService.userId,
        },
      } as IAuthData & { type: string };
    } else {
      // we need to send in some kind of auth property in order to get a properly
      // formatted auth flow back, so we just send our email auth (which TBH should
      // prevent the need from asking for the user's password)
      auth = {
        type: 'm.login.email.identity',
        session: this.emailState.session,
        threepid_creds: {
          sid: this.emailState.sid,
          client_secret: this.emailState.clientSecret,
        },
      } as IAuthData & { type: string };
    }

    let emailAdded = false;
    try {
      response = await this.matrixService.client.addThreePidOnly({
        auth,
        client_secret: this.emailState.clientSecret,
        sid: this.emailState.sid,
      });
      emailAdded = true;
    } catch (e: any) {
      let maybeAuthFlow = e.data;
      if (isInteractiveAuth(maybeAuthFlow) && maybeAuthFlow.flows.length > 0) {
        let nextStage = nextUncompletedStage(maybeAuthFlow);
        await this.nextEmailStateFromResponse(nextStage, maybeAuthFlow);
      } else {
        throw e;
      }
    }

    if (emailAdded && this.matrixService.profile.email) {
      // finally we remove the old email from the account
      await this.matrixService.client.deleteThreePid(
        'email',
        this.matrixService.profile.email,
      );
      this.matrixService.reloadProfile();
      this.afterSaveTask.perform();
    }
  });

  private async nextEmailStateFromResponse(
    nextStage: string,
    authflow: InteractiveAuth,
  ) {
    if (
      this.emailState.type === 'initial' ||
      this.emailState.type === 'validateEmail' ||
      this.emailState.type === 'requestEmailValidation'
    ) {
      throw new Error(
        `invalid state: cannot perform nextEmailStateFromResponse in state ${this.emailState.type}`,
      );
    }
    let completed = authflow.completed ?? [];
    let { session } = authflow;
    // annoyingly this will not show up in the flows until _after_ it is
    //  completed. seems like a matrix bug to me...
    if (!completed.find((s) => s === 'm.login.email.identity')) {
      // If current type is already 'waitForValidation',
      // it means we are polling the validation.
      if (this.emailState.type === 'waitForValidation') {
        await timeout(1000);
      }
      this.emailState = {
        ...this.emailState,
        type: 'waitForValidation',
        session,
      };
      this.doEmailFlow.perform();
      return;
    }

    if (nextStage === 'm.login.password') {
      this.emailState = {
        ...this.emailState,
        type: 'askForPassword',
        session,
      };
    } else {
      throw new Error(
        `Don't know to to handle auth stage '${nextStage}' from auth flow: ${JSON.stringify(
          authflow,
          null,
          2,
        )}`,
      );
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
