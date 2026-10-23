import { trackedObject } from '@ember/reactive/collections';
import Component from '@glimmer/component';

import AuthContainer from '../../components/auth-container.gts';
import { resetPassword } from '../../security/matrix.js';
import {
  endSessionsForNewPassword,
  readConfig,
} from '../../security/session.js';
import {
  ResetPasswordDone,
  ResetPasswordForm,
} from '../../screens/password-reset.gts';
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
        <ResetPasswordDone @onSignIn={{this.goToSignIn}}>
          {{#if @link.cli}}
            <CliWaitNotice @cli={{@link.cli}} />
          {{/if}}
        </ResetPasswordDone>
      {{else}}
        <ResetPasswordForm
          @submitDisabled={{this.submitDisabled}}
          @submitting={{this.state.resetting}}
          @paramsError={{this.state.paramsError}}
          @forgotPasswordURL={{this.forgotPasswordURL}}
          @error={{this.state.error}}
          @onSubmit={{this.submit}}
        >
          {{#if @link.cli}}
            <CliWaitNotice @cli={{@link.cli}} />
          {{/if}}
          <NewPasswordFields
            @password={{this.password}}
            @passwordLabel='Enter New Password'
            @confirmLabel='Re-Enter New Password'
            @autofocus={{true}}
          />
        </ResetPasswordForm>
      {{/if}}
    </AuthContainer>
  </template>
}
