/* eslint-env browser */
// Creating a Boxel account on the secure origin (`register`), drawn and
// worded as the app's registration is. The page drives the Matrix server's
// registration itself: it asks for the email validation link, then follows
// the stages the server asks for — an invite code where the server requires
// one, and the email validation, which it polls for until the link in the
// email is followed. The link lands on `verify-email`.
//
// Once the account exists, the page sets its display name, signs the
// registration's own Matrix session out, and signs in to Boxel with the new
// password, passing the invite code along. That sign-in is the account's
// first, so the realm server sets the account up as the app's first sign-in
// does — its realm-server user, which records the invite code, its personal
// realm and its session room — and the user ends signed in here, or, when a
// CLI started the sign-in, with the session handed to the CLI.
//
// The password, the invite code and every other field are typed into, and
// sent from, this page. Nothing goes to the app page.

import {
  authButton,
  errorLine,
  field,
  h,
  loadingIndicator,
  renderPage,
  setLoading,
  showError,
  title,
} from './dom.js';
import {
  clientSecret as newClientSecret,
  isUsernameAvailable,
  logout,
  register,
  requestEmailToken,
  setDisplayName,
} from './matrix.js';
import { newPasswordFields } from './password-fields.js';
import {
  matrixServerName,
  readConfig,
  signInWithPassword,
  storeSession,
} from './session.js';
import {
  asSentence,
  cliCallback,
  cliParams,
  handToCli,
  modeURL,
  renderIncompleteCliLink,
  renderMessage,
  renderSignedIn,
} from './sign-in.js';

// How often the page asks whether the email has been validated.
const EMAIL_POLL_INTERVAL_MS = 1000;

const NO_NETWORK_ERROR = 'Could not connect to server';
const INVALID_INVITE_CODE =
  'This registration token does not exist or has exceeded its usage limit.';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The stage the server asks for next: the first not yet completed, of the
// first flow that every completed stage belongs to.
function nextStage({ flows = [], completed = [] }) {
  let flow =
    flows.find(({ stages = [] }) =>
      completed.every((stage) => stages.includes(stage)),
    ) ?? flows[0];
  return flow?.stages?.find((stage) => !completed.includes(stage));
}

function registrationErrorText(error) {
  let message = String(error?.data?.error ?? error?.message ?? '');
  if (error?.status === 0) {
    return NO_NETWORK_ERROR;
  }
  if (message.includes('Registration has been disabled')) {
    return 'Registration has been disabled';
  }
  if (message.includes('Unable to parse email address')) {
    return 'Email address is invalid';
  }
  return message;
}

// Where the email validation link lands once the Matrix server has validated
// the address: this origin's `verify-email` page.
function verifyEmailLink() {
  return new URL(modeURL('verify-email'), window.location.href).href;
}

export function registerMode(root) {
  let config = readConfig();
  let params = new URL(window.location.href).searchParams;
  let cli;
  if (params.has('port') || params.has('state')) {
    cli = cliCallback(params);
    if (!cli) {
      renderIncompleteCliLink(root);
      return;
    }
  }
  let suggestedUsername = params.get('user') ?? '';
  let signInURL = cli
    ? modeURL('cli-sign-in', cliParams(cli, suggestedUsername))
    : modeURL('sign-in');

  // What the registration has gathered so far.
  let state = {
    name: '',
    email: '',
    username: '',
    clientSecret: undefined,
    sid: undefined,
    sendAttempt: 0,
    session: undefined,
    token: undefined,
  };
  let running = false;
  let availabilityCheck = 0;

  // The registration form.
  let formError = errorLine('form-error');
  let nameField = field({
    label: 'Your Name',
    testId: 'name',
    input: {
      type: 'text',
      name: 'name',
      autocomplete: 'name',
      placeholder: 'Enter your name',
      'data-test-name-field': true,
    },
  });
  let emailField = field({
    label: 'Email',
    testId: 'email',
    input: {
      type: 'text',
      name: 'email',
      autocomplete: 'email',
      placeholder: 'Enter your email',
      'data-test-email-field': true,
    },
  });
  let usernameField = field({
    label: 'Username',
    testId: 'username',
    group: { prefix: '@', suffix: '' },
    input: {
      type: 'text',
      name: 'username',
      autocomplete: 'username',
      placeholder: 'Your username',
      'data-test-username-field': true,
    },
  });
  let serverNameElement = usernameField.element.querySelector(
    '[data-input-group-suffix]',
  );
  matrixServerName(config).then(
    (name) => (serverNameElement.textContent = name),
    () => undefined,
  );
  let passwords = newPasswordFields({
    labels: ['Password', 'Confirm Password'],
    placeholders: ['Your password', 'Re-enter your password'],
    hints: true,
    onChange: refresh,
  });
  let createAccount = authButton(
    {
      kind: 'primary',
      type: 'submit',
      disabled: true,
      'data-test-register-btn': true,
    },
    'Create Account',
  );

  function refresh() {
    createAccount.disabled = Boolean(
      running ||
      !nameField.input.value ||
      !emailField.input.value ||
      !usernameField.input.value ||
      !passwords.complete ||
      nameField.error ||
      emailField.error ||
      usernameField.error,
    );
    nextButton.disabled = running || !tokenField.input.value;
  }

  nameField.input.addEventListener('input', () => {
    nameField.setError(undefined);
    refresh();
  });
  nameField.input.addEventListener('blur', () => {
    if (!nameField.input.value) {
      nameField.setError('Your name is missing');
    }
    refresh();
  });
  emailField.input.addEventListener('input', () => {
    emailField.setError(undefined);
    refresh();
  });
  emailField.input.addEventListener('blur', () => {
    if (!emailField.input.value) {
      emailField.setError('Email address is missing');
    }
    refresh();
  });
  usernameField.input.addEventListener('input', () => {
    usernameField.setError(undefined);
    usernameField.setHint(undefined);
    availabilityCheck++;
    refresh();
  });
  usernameField.input.addEventListener('blur', () => checkUsername());

  async function checkUsername() {
    let username = usernameField.input.value;
    if (!username) {
      usernameField.setError('Username is missing');
      refresh();
      return;
    }
    // Usernames that could collide with the realm server's API, or with
    // realms' own users.
    if (username.startsWith('_')) {
      usernameField.setError('Username cannot start with an underscore');
      refresh();
      return;
    }
    if (username.startsWith('realm/')) {
      usernameField.setError('Username cannot start with "realm/"');
      refresh();
      return;
    }
    let check = ++availabilityCheck;
    let available;
    try {
      available = await isUsernameAvailable(username);
    } catch {
      return;
    }
    if (check !== availabilityCheck) {
      return;
    }
    if (available) {
      usernameField.setHint({
        text: 'name available',
        testId: 'username-available',
      });
    } else {
      usernameField.setError('Username is already taken');
    }
    refresh();
  }

  let registrationPage = h(
    'div',
    { class: 'registration-page', 'data-test-register-page': true },
    title({}, 'Create a Boxel Account'),
    h(
      'form',
      {
        novalidate: true,
        'data-test-register-form': true,
        onsubmit(event) {
          event.preventDefault();
          if (!createAccount.disabled) {
            startRegistration();
          }
        },
      },
      nameField.element,
      emailField.element,
      usernameField.element,
      ...passwords.elements,
      formError,
      h(
        'div',
        { class: 'button-wrapper' },
        createAccount,
        h('div', {}, 'or'),
        h(
          'a',
          {
            class: 'boxel-button auth-btn size-touch kind-secondary',
            href: signInURL,
            'data-test-cancel-btn': true,
          },
          'Login with an existing account',
        ),
      ),
    ),
  );

  // The invite code step.
  let tokenField = field({
    label: 'Your invite code',
    testId: 'token',
    input: {
      type: 'text',
      name: 'invite-code',
      autocomplete: 'off',
      placeholder: 'Enter invite code',
      'data-test-token-field': true,
    },
  });
  let nextButton = authButton(
    {
      kind: 'primary',
      type: 'submit',
      disabled: true,
      'data-test-next-btn': true,
    },
    'Next',
  );
  tokenField.input.addEventListener('input', () => {
    tokenField.setError(undefined);
    refresh();
  });
  let tokenPage = h(
    'div',
    { class: 'step', 'data-test-token-page': true, hidden: true },
    title(
      {},
      'Boxel is currently invite-only.',
      h('br'),
      'Enter your invite code here.',
    ),
    h(
      'form',
      {
        novalidate: true,
        onsubmit(event) {
          event.preventDefault();
          if (!nextButton.disabled) {
            state.token = tokenField.input.value;
            continueRegistration({
              type: 'm.login.registration_token',
              token: state.token,
              session: state.session,
            });
          }
        },
      },
      tokenField.element,
      h('div', { class: 'button-wrapper' }, nextButton),
    ),
  );

  // Waiting for the email to be validated.
  let resendButton = authButton(
    {
      kind: 'primary',
      className: 'resend-email',
      'data-test-resend-validation': true,
      async onclick() {
        resendButton.disabled = true;
        setLoading(resendButton, true);
        try {
          await sendValidationEmail(state.sendAttempt + 1);
        } catch {
          // The page keeps waiting on the email already sent.
        } finally {
          setLoading(resendButton, false);
          resendButton.disabled = false;
        }
      },
    },
    'Resend Email',
  );
  let awaitingPage = h(
    'div',
    { class: 'step', hidden: true },
    title(
      { 'data-test-email-validation': true },
      'Please check your email to complete registration',
    ),
    h(
      'ul',
      { class: 'email-validation-instruction' },
      h('li', {}, 'Leave this window open while we verify your email'),
      h('li', {}, 'This screen will update once your email is verified'),
    ),
    resendButton,
  );

  // Setting the account up.
  let creationPage = h(
    'div',
    { class: 'centered-loading', hidden: true },
    h(
      'span',
      { class: 'loading-title', 'data-test-email-validation-complete': true },
      'Email validation complete',
    ),
    h(
      'p',
      { class: 'loading-message' },
      'Please wait as we set up your account.',
    ),
    loadingIndicator('loading-spinner'),
  );

  let pages = [registrationPage, tokenPage, awaitingPage, creationPage];
  function show(page) {
    for (let each of pages) {
      each.hidden = each !== page;
    }
  }

  renderPage(root, ...pages);
  if (suggestedUsername && !suggestedUsername.includes('@')) {
    usernameField.input.value = suggestedUsername;
  }
  nameField.input.focus();
  refresh();

  async function sendValidationEmail(sendAttempt) {
    state.sid = await requestEmailToken('registration', {
      email: state.email,
      clientSecret: state.clientSecret,
      sendAttempt,
      nextLink: verifyEmailLink(),
    });
    state.sendAttempt = sendAttempt;
  }

  async function startRegistration() {
    if (!passwords.validate()) {
      return;
    }
    state.name = nameField.input.value.trim();
    state.email = emailField.input.value;
    state.username = usernameField.input.value;
    state.clientSecret = newClientSecret();
    state.session = undefined;
    running = true;
    refresh();
    setLoading(createAccount, true);
    showError(formError, undefined);
    try {
      await sendValidationEmail(1);
    } catch (e) {
      if (e.status === 400 && e.errcode === 'M_THREEPID_IN_USE') {
        emailField.setError(
          'Email address is already attached to a Boxel account',
        );
      } else {
        showError(
          formError,
          `There was an error registering: ${registrationErrorText(e)}`,
        );
      }
      running = false;
      setLoading(createAccount, false);
      refresh();
      return;
    }
    await continueRegistration(undefined);
  }

  // Makes the registration request with `auth` for the stage at hand, and
  // follows the server to the next stage until the account exists.
  async function continueRegistration(auth) {
    running = true;
    refresh();
    setLoading(
      nextButton,
      Boolean(auth?.type === 'm.login.registration_token'),
    );
    let polling = false;
    for (;;) {
      let account;
      try {
        account = await register({
          username: state.username,
          password: passwords.value,
          auth,
        });
      } catch (e) {
        let flows = e.status === 401 ? e.data : undefined;
        if (flows?.flows?.length > 0) {
          state.session = flows.session;
          let stage = nextStage(flows);
          if (stage === 'm.login.registration_token') {
            // The invite code was refused: Synapse asks for it again,
            // and the page says so in the app's words.
            if (auth?.type === 'm.login.registration_token') {
              tokenField.setError(INVALID_INVITE_CODE);
            }
            running = false;
            setLoading(nextButton, false);
            show(tokenPage);
            tokenField.input.focus();
            refresh();
            return;
          }
          if (stage === 'm.login.email.identity') {
            setLoading(nextButton, false);
            show(awaitingPage);
            if (polling) {
              await delay(EMAIL_POLL_INTERVAL_MS);
            }
            polling = true;
            auth = {
              type: 'm.login.email.identity',
              session: state.session,
              threepid_creds: {
                sid: state.sid,
                client_secret: state.clientSecret,
              },
            };
            continue;
          }
          if (stage === 'm.login.dummy') {
            auth = { type: 'm.login.dummy', session: state.session };
            continue;
          }
        }
        running = false;
        setLoading(createAccount, false);
        setLoading(nextButton, false);
        if (e.errcode === 'M_USER_IN_USE') {
          usernameField.setError('Username is already taken');
          show(registrationPage);
        } else if (auth?.type === 'm.login.registration_token') {
          tokenField.setError(
            e.status === 0 ? NO_NETWORK_ERROR : INVALID_INVITE_CODE,
          );
        } else {
          show(registrationPage);
          showError(
            formError,
            `There was an error registering: ${registrationErrorText(e)}`,
          );
        }
        refresh();
        return;
      }
      await finish(account);
      return;
    }
  }

  // The account exists: name it, end the registration's own Matrix session,
  // and sign in to Boxel, which sets the account up.
  async function finish(account) {
    show(creationPage);
    await setDisplayName(
      account.user_id,
      account.access_token,
      state.name,
    ).catch(() => undefined);
    await logout(account.access_token).catch(() => undefined);
    await signInAsNewAccount(account.user_id, passwords.value);
  }

  // The new account's first sign-in, which records the invite code. When it
  // fails, it is tried again from here, with the same password and invite
  // code: the account's first sign-in is the one that records the code.
  async function signInAsNewAccount(user, password) {
    let session;
    try {
      session = await signInWithPassword(config, {
        username: user,
        password,
        client: cli ? 'cli' : 'window',
        registrationToken: state.token,
      });
    } catch (e) {
      let error = errorLine();
      showError(error, asSentence(e.message));
      let retry = authButton(
        {
          kind: 'primary',
          'data-test-secure-retry-sign-in': true,
          async onclick() {
            retry.disabled = true;
            setLoading(retry, true);
            await signInAsNewAccount(user, password);
          },
        },
        'Try again',
      );
      renderMessage(
        root,
        'Your account was created, but signing in didn’t finish',
        error,
        h('div', { class: 'button-wrapper' }, retry),
      );
      return;
    }
    if (cli) {
      handToCli(root, cli, session);
    } else {
      storeSession(session);
      history.replaceState(null, '', modeURL('sign-in'));
      renderSignedIn(root);
    }
  }
}

// Where the link in a registration email lands, once the Matrix server has
// validated the address. The page that asked for the email is still waiting
// for it, and carries on from here by itself.
export function verifyEmailMode(root) {
  renderMessage(
    root,
    'Your email has now been validated',
    h(
      'p',
      { class: 'info', 'data-test-email-validated': true },
      'Return to the window where you are creating your Boxel account to finish. You can close this one.',
    ),
  );
}
