import { trackedObject } from '@ember/reactive/collections';
import Component from '@glimmer/component';

import AuthContainer from '../../components/auth-container.gts';
import {
  ForgotPasswordForm,
  ResetEmailSent,
} from '../../screens/password-reset.gts';
import { navigation } from '../navigation.js';
import {
  clientSecret as newClientSecret,
  requestEmailToken,
} from '../../security/matrix.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import { resetLink } from './reset-link.ts';

// The first page of resetting a forgotten password (`forgot-password`), on
// the screens the app draws too: it asks the Matrix server to email a
// reset link, which, once followed and confirmed at the Matrix server, lands
// on `reset-password`.

interface Signature {
  Args: {
    cli?: CliCallback;
    // Where "Back to login" goes.
    signInURL: string;
  };
}

export default class ForgotPassword extends Component<Signature> {
  private state = trackedObject({
    email: '',
    emailError: undefined as string | undefined,
    sending: false,
    // The address the link was sent to, once it was.
    sentTo: undefined as string | undefined,
  });
  // The validation session the link is sent for, and how many times it has
  // been sent; a resend reuses the session.
  private clientSecret = '';
  private sendAttempt = 0;

  private get submitDisabled() {
    return (
      this.state.sending || !this.state.email || Boolean(this.state.emailError)
    );
  }

  private goToSignIn = () => {
    navigation.assign(this.args.signInURL);
  };

  private setEmail = (value: string) => {
    this.state.email = value;
    this.state.emailError = undefined;
  };

  private async send(email: string) {
    await requestEmailToken('password', {
      email,
      clientSecret: this.clientSecret,
      sendAttempt: this.sendAttempt + 1,
      nextLink: resetLink(this.clientSecret, email, this.args.cli),
    });
    this.sendAttempt++;
  }

  private submit = async (event: Event) => {
    event.preventDefault();
    if (this.submitDisabled) {
      return;
    }
    let email = this.state.email;
    this.clientSecret = newClientSecret();
    this.sendAttempt = 0;
    this.state.sending = true;
    try {
      await this.send(email);
    } catch {
      this.state.emailError = 'No account with the given email address exists';
      return;
    } finally {
      this.state.sending = false;
    }
    this.state.sentTo = email;
  };

  private resend = async () => {
    this.state.sending = true;
    try {
      await this.send(this.state.sentTo!);
    } catch {
      // The page keeps waiting on the email already sent.
    } finally {
      this.state.sending = false;
    }
  };

  <template>
    <AuthContainer>
      {{#if this.state.sentTo}}
        <ResetEmailSent
          @email={{this.state.sentTo}}
          @resending={{this.state.sending}}
          @onResend={{this.resend}}
        />
      {{else}}
        <ForgotPasswordForm
          @email={{this.state.email}}
          @emailError={{this.state.emailError}}
          @submitDisabled={{this.submitDisabled}}
          @submitting={{this.state.sending}}
          @autofocus={{true}}
          @onEmailInput={{this.setEmail}}
          @onSubmit={{this.submit}}
          @onSignIn={{this.goToSignIn}}
        />
      {{/if}}
    </AuthContainer>
  </template>
}
