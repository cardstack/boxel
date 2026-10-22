import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import AuthFormField from '../../components/auth-form-field.gts';
import Input from '../../components/input.gts';
import { autofocus } from '../../modifiers/autofocus.ts';
import {
  clientSecret as newClientSecret,
  requestEmailToken,
} from '../../security/matrix.js';
import { type CliCallback, resetLink } from './reset-link.ts';

// The first page of resetting a forgotten password (`forgot-password`),
// drawn and worded as the app's is: it asks the Matrix server to email a
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
  @tracked private email = '';
  @tracked private emailError: string | undefined;
  @tracked private sending = false;
  // The address the link was sent to, once it was.
  @tracked private sentTo: string | undefined;
  private clientSecret = '';
  private sendAttempt = 0;

  private get submitDisabled() {
    return this.sending || !this.email || Boolean(this.emailError);
  }

  private setEmail = (value: string) => {
    this.email = value;
    this.emailError = undefined;
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
    let email = this.email;
    this.clientSecret = newClientSecret();
    this.sendAttempt = 0;
    this.sending = true;
    try {
      await this.send(email);
    } catch {
      this.emailError = 'No account with the given email address exists';
      return;
    } finally {
      this.sending = false;
    }
    this.sentTo = email;
  };

  private resend = async () => {
    this.sending = true;
    try {
      await this.send(this.sentTo!);
    } catch {
      // The page keeps waiting on the email already sent.
    } finally {
      this.sending = false;
    }
  };

  <template>
    <AuthContainer>
      {{#if this.sentTo}}
        <span
          class='title'
          role='heading'
          aria-level='1'
          data-test-email-validation
        >Please check your email to reset your password</span>
        <ul class='email-validation-instruction'>
          <li>We've sent an email to <b>{{this.sentTo}}</b></li>
          <li>Click on the link within the email to reset your password</li>
        </ul>
        <AuthButton
          data-test-resend-validation-btn
          @variant='primary'
          @disabled={{this.sending}}
          @loading={{this.sending}}
          {{on 'click' this.resend}}
        >Resend Email</AuthButton>
      {{else}}
        <form
          class='step'
          novalidate
          data-test-forgot-password-form
          {{on 'submit' this.submit}}
        >
          <span class='title' role='heading' aria-level='1'>Forgot your
            password?</span>
          <p class='info'>Enter email to receive a reset password link.</p>
          <AuthFormField
            @label='Email Address'
            data-test-secure-field='email'
          >
            <Input
              data-test-email-field
              name='email'
              autocomplete='email'
              @type='text'
              @errorMessage={{this.emailError}}
              @state={{if this.emailError 'invalid' 'initial'}}
              @value={{this.email}}
              @onInput={{this.setEmail}}
              {{autofocus}}
            />
          </AuthFormField>
          <div class='button-wrapper'>
            <AuthButton
              data-test-reset-your-password-btn
              type='submit'
              @variant='primary'
              @disabled={{this.submitDisabled}}
              @loading={{this.sending}}
            >Reset Your Password</AuthButton>
            <div>or</div>
            <AuthButton
              data-test-cancel-reset-password-btn
              @as='anchor'
              @href={{@signInURL}}
              @variant='secondary'
            >Back to login</AuthButton>
          </div>
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
      .email-validation-instruction {
        padding: 0;
        list-style-position: inside;
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        color: var(--foreground);
      }
      .email-validation-instruction li {
        margin-bottom: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
