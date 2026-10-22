import { on } from '@ember/modifier';
import { trackedObject } from '@ember/reactive/collections';
import Component from '@glimmer/component';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import { resetPassword } from '../../security/matrix.js';
import {
  endSessionsForNewPassword,
  readConfig,
} from '../../security/session.js';
import { navigation } from '../navigation.js';
import NewPasswordFields from '../new-password-fields.gts';
import { NewPassword } from '../new-password.ts';
import { cliParams, modeURL } from '../urls.js';
import { signInURL } from '../cli-links.ts';
import type { ResetLink } from './reset-link.ts';
import CliWaitNotice from '../sign-in/cli-wait-notice.gts';

// Where a password reset link lands (`reset-password`), once it was
// confirmed at the Matrix server: the new password is set here. Setting it
// ends every secure session the account has.

interface Signature {
  Args: {
    link: ResetLink;
  };
}

export default class ResetPassword extends Component<Signature> {
  private password = new NewPassword();
  private state = trackedObject({
    resetting: false,
    done: false,
    error: undefined as string | undefined,
    paramsError: !this.args.link.clientSecret || !this.args.link.sid,
  });

  private get submitDisabled() {
    return this.state.resetting || !this.password.complete;
  }

  private get forgotPasswordURL() {
    return modeURL('forgot-password', cliParams(this.args.link.cli));
  }

  private get signInURL() {
    return signInURL(this.args.link.cli);
  }

  private goToSignIn = () => {
    navigation.assign(this.signInURL);
  };

  private submit = async (event: Event) => {
    event.preventDefault();
    if (this.submitDisabled || !this.password.validate()) {
      return;
    }
    let { sid, clientSecret, email } = this.args.link;
    let newPassword = this.password.password;
    this.state.resetting = true;
    this.state.error = undefined;
    this.state.paramsError = false;
    try {
      await resetPassword({ sid, clientSecret, newPassword });
    } catch (e) {
      this.state.resetting = false;
      let { status } = e as { status: number };
      if (status >= 400 && status < 500) {
        this.state.paramsError = true;
      } else {
        this.state.error =
          'An unknown error happened. Please try again, or contact support if the problem persists.';
      }
      return;
    }
    // A link that names no account still resets the password; only ending
    // the account's secure sessions needs to know whose it is.
    if (email) {
      try {
        await endSessionsForNewPassword(readConfig(), {
          username: email,
          password: newPassword,
        });
      } catch {
        // The password is reset either way. A session the realm server
        // couldn't end runs out within its week.
      }
    }
    this.state.resetting = false;
    this.state.done = true;
  };

  <template>
    <AuthContainer>
      {{#if this.state.done}}
        <span
          class='title'
          role='heading'
          aria-level='1'
          data-test-secure-title
          data-test-reset-password-success
        >Your password is now reset</span>
        <p class='info'>Your password has been successfully reset. You can use
          the link below to sign into your Boxel account with your new password.</p>
        {{#if @link.cli}}
          <CliWaitNotice @cli={{@link.cli}} />
        {{/if}}
        <div class='button-wrapper'>
          <AuthButton
            data-test-back-to-login-btn
            type='button'
            {{on 'click' this.goToSignIn}}
            @variant='primary'
          >Sign In to Boxel</AuthButton>
        </div>
      {{else}}
        <form
          class='step'
          novalidate
          data-test-reset-password-form
          {{on 'submit' this.submit}}
        >
          <span
            class='title'
            role='heading'
            aria-level='1'
            data-test-secure-title
          >Reset your password</span>
          {{#if @link.cli}}
            <CliWaitNotice @cli={{@link.cli}} />
          {{/if}}
          <NewPasswordFields
            @password={{this.password}}
            @passwordLabel='Enter New Password'
            @confirmLabel='Re-Enter New Password'
            @autofocus={{true}}
          />
          <div class='button-wrapper'>
            <AuthButton
              data-test-reset-password-btn
              type='submit'
              @variant='primary'
              @disabled={{this.submitDisabled}}
              @loading={{this.state.resetting}}
            >Reset Password</AuthButton>
          </div>
          {{#if this.state.paramsError}}
            <span
              class='error'
              role='alert'
              data-test-reset-password-error
              data-test-secure-error
            >Unable to reset your password due to invalid password reset
              parameters. Please restart the password reset flow by going back
              to
              <a
                href={{this.forgotPasswordURL}}
                data-test-forgot-password-link
              >forgot password form</a>
              and try again.</span>
          {{else if this.state.error}}
            <span
              class='error'
              role='alert'
              data-test-reset-password-error
              data-test-secure-error
            >{{this.state.error}}</span>
          {{/if}}
        </form>
      {{/if}}
    </AuthContainer>
    <style scoped>
      .step {
        display: contents;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp);
      }
      .info {
        margin-top: 0;
        margin-bottom: var(--boxel-sp-sm);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
        color: var(--foreground);
      }
      .button-wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        margin-top: var(--boxel-sp-lg);
        gap: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
        text-align: center;
      }
      .error a {
        color: var(--boxel-highlight);
        text-decoration: underline;
      }
    </style>
  </template>
}
