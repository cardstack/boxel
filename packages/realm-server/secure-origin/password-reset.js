/* eslint-env browser */
// Resetting a forgotten password on the secure origin, drawn and worded as the
// app's is: `forgot-password` asks the Matrix server to email a reset link,
// and the link, once followed and confirmed at the Matrix server, lands on
// `reset-password`, where the new password is set.
//
// The validation session's client secret, which with the session id is what
// lets a new password be set, travels in the link's fragment, never its query
// string: a fragment never leaves the browser, while a load balancer's access
// log records every query string. The Matrix server adds the session id to the
// end of the link, so it lands in the fragment too. The page reads both and
// takes them out of the address bar and the history.
//
// The link also carries the email address the reset was asked for, so that
// once the new password is set the page can name the account to the realm
// server, which ends every secure session it has (see
// `endSessionsForNewPassword`).

import {
  authButton,
  errorLine,
  field,
  fragmentParams,
  h,
  renderPage,
  setLoading,
  showError,
  title,
} from './dom.js';
import {
  clientSecret as newClientSecret,
  requestEmailToken,
  resetPassword,
} from './matrix.js';
import { newPasswordFields } from './password-fields.js';
import { endSessionsForNewPassword, readConfig } from './session.js';
import {
  cliCallback,
  cliParams,
  modeURL,
  renderIncompleteCliLink,
} from './sign-in.js';

// The CLI the reset began from, when one did: the page carries its listener
// along so that signing in afterwards hands the session to it.
function cliFrom(params) {
  if (!params.has('port') && !params.has('state')) {
    return { cli: undefined };
  }
  let cli = cliCallback(params);
  return cli ? { cli } : { invalid: true };
}

function signInURL(cli, username) {
  return cli
    ? modeURL('cli-sign-in', cliParams(cli, username))
    : modeURL('sign-in');
}

// Where the reset link lands: `reset-password`, with the client secret, the
// email address and the CLI's listener in the fragment.
function resetLink(clientSecret, email, cli) {
  let fragment = new URLSearchParams({
    clientSecret,
    email,
    ...cliParams(cli),
  });
  return new URL(
    `${modeURL('reset-password')}#${fragment}`,
    window.location.href,
  ).href;
}

export function forgotPasswordMode(root) {
  let params = new URL(window.location.href).searchParams;
  let { cli, invalid } = cliFrom(params);
  if (invalid) {
    renderIncompleteCliLink(root);
    return;
  }
  let email = '';
  let clientSecret;
  let sendAttempt = 0;

  let emailField = field({
    label: 'Email Address',
    testId: 'email',
    input: {
      type: 'text',
      name: 'email',
      autocomplete: 'email',
      'data-test-email-field': true,
    },
  });
  let submit = authButton(
    {
      kind: 'primary',
      type: 'submit',
      disabled: true,
      'data-test-reset-your-password-btn': true,
    },
    'Reset Your Password',
  );
  let running = false;
  function refresh() {
    submit.disabled = running || !emailField.input.value || emailField.error;
  }
  emailField.input.addEventListener('input', () => {
    emailField.setError(undefined);
    refresh();
  });

  async function send() {
    await requestEmailToken('password', {
      email,
      clientSecret,
      sendAttempt: sendAttempt + 1,
      nextLink: resetLink(clientSecret, email, cli),
    });
    sendAttempt++;
  }

  renderPage(
    root,
    title({ class: 'title forgot-title' }, 'Forgot your password?'),
    h('p', { class: 'info' }, 'Enter email to receive a reset password link.'),
    h(
      'form',
      {
        novalidate: true,
        'data-test-forgot-password-form': true,
        async onsubmit(event) {
          event.preventDefault();
          if (submit.disabled) {
            return;
          }
          email = emailField.input.value;
          clientSecret = newClientSecret();
          sendAttempt = 0;
          running = true;
          refresh();
          setLoading(submit, true);
          try {
            await send();
          } catch {
            emailField.setError(
              'No account with the given email address exists',
            );
            running = false;
            setLoading(submit, false);
            refresh();
            return;
          }
          renderCheckEmail();
        },
      },
      emailField.element,
      h(
        'div',
        { class: 'button-wrapper forgot-buttons' },
        submit,
        h('div', {}, 'or'),
        h(
          'a',
          {
            class: 'boxel-button auth-btn size-touch kind-secondary',
            href: signInURL(cli, params.get('user')),
            'data-test-cancel-reset-password-btn': true,
          },
          'Back to login',
        ),
      ),
    ),
  );
  emailField.input.focus();

  function renderCheckEmail() {
    let resend = authButton(
      {
        kind: 'primary',
        'data-test-resend-validation-btn': true,
        async onclick() {
          resend.disabled = true;
          setLoading(resend, true);
          try {
            await send();
          } catch {
            // The page keeps waiting on the email already sent.
          } finally {
            setLoading(resend, false);
            resend.disabled = false;
          }
        },
      },
      'Resend Email',
    );
    renderPage(
      root,
      title(
        { class: 'title forgot-title', 'data-test-email-validation': true },
        'Please check your email to reset your password',
      ),
      h(
        'ul',
        { class: 'email-validation-instruction' },
        h('li', {}, "We've sent an email to ", h('b', {}, email)),
        h(
          'li',
          {},
          'Click on the link within the email to reset your password',
        ),
      ),
      resend,
    );
  }
}

export function resetPasswordMode(root) {
  let fragment = fragmentParams();
  let clientSecret = fragment.get('clientSecret') ?? '';
  let sid = fragment.get('sid') ?? '';
  let email = fragment.get('email') ?? '';
  let { cli } = cliFrom(fragment);
  // Out of the address bar and the history: the secret has done its job once
  // it is read.
  history.replaceState(null, '', modeURL('reset-password'));

  let error = errorLine('error forgot-error');
  let passwords = newPasswordFields({
    labels: ['Enter New Password', 'Re-Enter New Password'],
    onChange: refresh,
  });
  let submit = authButton(
    {
      kind: 'primary',
      type: 'submit',
      disabled: true,
      'data-test-reset-password-btn': true,
    },
    'Reset Password',
  );
  let running = false;
  function refresh() {
    submit.disabled = running || !passwords.complete;
  }

  function showParamsError() {
    error.replaceChildren(
      'Unable to reset your password due to invalid password reset parameters. Please restart the password reset flow by going back to ',
      h(
        'a',
        {
          href: modeURL('forgot-password', cliParams(cli)),
          'data-test-forgot-password-link': true,
        },
        'forgot password form',
      ),
      ' and try again.',
    );
    error.hidden = false;
  }

  renderPage(
    root,
    title({ class: 'title forgot-title' }, 'Reset your password'),
    h(
      'form',
      {
        novalidate: true,
        'data-test-reset-password-form': true,
        async onsubmit(event) {
          event.preventDefault();
          if (submit.disabled || !passwords.validate()) {
            return;
          }
          running = true;
          refresh();
          setLoading(submit, true);
          showError(error, undefined);
          try {
            await resetPassword({
              sid,
              clientSecret,
              newPassword: passwords.value,
            });
          } catch (e) {
            running = false;
            setLoading(submit, false);
            refresh();
            if (e.status >= 400 && e.status < 500) {
              showParamsError();
            } else {
              showError(
                error,
                'An unknown error happened. Please try again, or contact support if the problem persists.',
              );
            }
            return;
          }
          // A link that names no account still resets the password; only
          // ending the account's secure sessions needs to know whose it is.
          if (email) {
            try {
              await endSessionsForNewPassword(readConfig(), {
                username: email,
                password: passwords.value,
              });
            } catch {
              // The password is reset either way. A session the realm server
              // couldn't end runs out within its week.
            }
          }
          renderResetDone(root, cli);
        },
      },
      ...passwords.elements,
      h('div', { class: 'button-wrapper forgot-buttons' }, submit),
      error,
    ),
  );
  if (!clientSecret || !sid) {
    showParamsError();
  }
  passwords.focus();
}

function renderResetDone(root, cli) {
  renderPage(
    root,
    title(
      { class: 'title forgot-title', 'data-test-reset-password-success': true },
      'Your password is now reset',
    ),
    h(
      'p',
      { class: 'info' },
      'Your password has been successfully reset. You can use the link below to sign into your Boxel account with your new password.',
    ),
    h(
      'div',
      { class: 'button-wrapper forgot-buttons' },
      h(
        'a',
        {
          class: 'boxel-button auth-btn size-touch kind-primary',
          href: signInURL(cli),
          'data-test-back-to-login-btn': true,
        },
        'Sign In to Boxel',
      ),
    ),
  );
}
