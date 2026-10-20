/* eslint-env browser */
// Signing in on the secure origin: the window's own session (`sign-in`), or a
// session handed to the CLI waiting on a loopback port (`cli-sign-in`), with a
// password or with Google. Google returns to this origin's callback
// (`googleCallbackMode`), which finishes whichever of the two began. The page
// is the app's sign-in page, drawn the same and worded the same, with its
// links to create an account and to reset a password.
//
// Everything here is typed into, and sent from, this window. Nothing goes to
// the app page.

import {
  beginGoogleSignIn,
  finishGoogleSignIn,
  googleSignInConfig,
  liveSession,
  readConfig,
  signInWithPassword,
  signOut,
  storedSession,
  storeSession,
} from './session.js';
import { signInFailed } from './sign-in-copy.js';
import {
  authButton,
  errorLine,
  field,
  googleIcon,
  h,
  linkButton,
  renderPage,
  setLoading,
  showError,
  title,
} from './dom.js';

const LOOPBACK_CALLBACK_PATH = '/callback';
const GOOGLE_CALLBACK_SUFFIX = /\/google-callback$/;

// The shell's own address, from wherever beneath it the page is.
export function shellPath() {
  return window.location.pathname.replace(GOOGLE_CALLBACK_SUFFIX, '/');
}

// The address of one of the shell's modes. `params` are plain values, never
// an origin or URL, which a firewall in front of a deployment may refuse in a
// query string.
export function modeURL(mode, params = {}) {
  let query = new URLSearchParams({ mode });
  for (let [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(name, value);
    }
  }
  return `${shellPath()}?${query}`;
}

// The CLI a page signs in for, as the query parameters that name it on every
// page of the flow: its loopback port and the state it expects back, and the
// username it suggested. Empty for the window's own sign-in.
export function cliParams(cli, username) {
  if (!cli) {
    return {};
  }
  let port;
  try {
    port = new URL(cli.url).port;
  } catch {
    return {};
  }
  return { port, state: cli.state, user: username || undefined };
}

// The page a Google sign-in started from, rebuilt from the `resume` the window
// kept when it sent the user to Google: the CLI's sign-in, for the same
// listener and with the same username, or else the window's own. The CLI keeps
// waiting on its listener while the user starts again there.
function startURL(resume) {
  let cli = resume?.client === 'cli' ? resume.cli : undefined;
  let params = cliParams(cli, resume?.username);
  if (!params.port || !params.state) {
    return modeURL('sign-in');
  }
  return modeURL('cli-sign-in', params);
}

// The CLI waiting for a session: the loopback port it listens on and the
// state value it expects back. Anything else is refused, so this page can only
// ever hand a session to a listener on this machine.
export function cliCallback(params) {
  let port = Number(params.get('port'));
  let state = params.get('state') ?? '';
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(state)
  ) {
    return undefined;
  }
  return {
    url: `http://127.0.0.1:${port}${LOOPBACK_CALLBACK_PATH}`,
    state,
  };
}

// A page that only says something: a title, and what follows it.
export function renderMessage(root, heading, ...content) {
  renderPage(
    root,
    h(
      'section',
      { class: 'message', 'data-test-secure-sign-in': true },
      title({}, heading),
      ...content,
    ),
  );
}

export async function signInMode(root) {
  let config = readConfig();
  // The window has no sign-out control; this ends its session from the
  // browser's console. Signed out here, the window shows its sign-in again.
  window.boxelSignOut = async () => {
    await signOut(config);
    await signInMode(root);
  };
  // A stored session the server has ended, as signing out of the app ends it,
  // shows the sign-in, with no error: the user simply isn't signed in.
  if (storedSession()) {
    renderMessage(root, 'Checking your sign-in…', h('p', {}, 'One moment.'));
  }
  let session = await liveSession(config);
  if (session) {
    renderSignedIn(root);
  } else {
    renderSignIn(root, config, {
      client: 'window',
      onSignedIn(signedIn) {
        storeSession(signedIn);
        renderSignedIn(root);
      },
    });
  }
}

export function cliSignInMode(root) {
  let config = readConfig();
  let params = new URL(window.location.href).searchParams;
  let callback = cliCallback(params);
  if (!callback) {
    renderIncompleteCliLink(root);
    return;
  }
  renderSignIn(root, config, {
    client: 'cli',
    cli: callback,
    username: params.get('user') ?? '',
    onSignedIn(signedIn) {
      handToCli(root, callback, signedIn);
    },
  });
}

export function renderIncompleteCliLink(root) {
  renderMessage(
    root,
    'This sign-in link is not complete',
    h(
      'p',
      { class: 'info' },
      'Run the command in your terminal again to get a new link.',
    ),
  );
}

// Where Google sends the window back to.
export async function googleCallbackMode(root) {
  let config = readConfig();
  renderSigningIn(root);
  let result;
  try {
    result = await finishGoogleSignIn(config);
  } catch (e) {
    let startAgain = startURL(e.resume);
    if (e.code === 'google-cancelled') {
      // Pressing Cancel at Google isn't a failure: back to the page the
      // sign-in started from, to try again or sign in with a password.
      window.location.replace(startAgain);
      return;
    }
    let error = errorLine();
    showError(error, asSentence(e.message));
    renderMessage(
      root,
      'That didn’t work',
      error,
      h(
        'div',
        { class: 'button-wrapper' },
        h(
          'a',
          {
            class: 'boxel-button auth-btn size-touch kind-secondary',
            href: startAgain,
            'data-test-secure-start-again': true,
          },
          'Start again',
        ),
      ),
    );
    return;
  }
  let { session, resume } = result;
  if (resume?.client === 'cli' && resume.cli) {
    handToCli(root, resume.cli, session);
    return;
  }
  storeSession(session);
  // Back to the window's own address, so a reload shows the signed-in window
  // rather than this callback.
  history.replaceState(null, '', modeURL('sign-in'));
  renderSignedIn(root);
}

// The app's "Signing you in…", while a sign-in it can't show a form for
// finishes.
function renderSigningIn(root) {
  renderPage(
    root,
    h(
      'div',
      { class: 'centered-loading', 'data-test-secure-signing-in': true },
      h('span', { class: 'loading-title' }, 'Signing you in…'),
    ),
  );
}

// The server words its errors for an API; shown here, each reads as a
// sentence.
export function asSentence(message) {
  let text = String(message ?? '').trim();
  if (!text) {
    return '';
  }
  text = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function renderSignedIn(root) {
  renderMessage(
    root,
    'You’re signed in to Boxel',
    h(
      'p',
      { class: 'info', 'data-test-secure-signed-in': true },
      'You can close this window.',
    ),
  );
}

// The app's sign-in page: the Google button when this server offers Google,
// then an email address or username and a password, the link to reset a
// forgotten password, and the link to create an account.
function renderSignIn(
  root,
  config,
  { client, cli, username = '', onSignedIn },
) {
  let error = errorLine();
  let subtitleSlot = h('div', { hidden: true });
  let googleSlot = h('div', { hidden: true });
  let usernameField = field({
    label: 'Email Address or Username',
    testId: 'username',
    input: {
      type: 'text',
      name: 'username',
      autocomplete: 'username',
      placeholder: 'Your email address',
      'data-test-secure-username': true,
    },
  });
  let passwordField = field({
    label: 'Password',
    testId: 'password',
    input: {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      placeholder: 'Your password',
      'data-test-secure-password': true,
    },
  });
  let usernameInput = usernameField.input;
  let passwordInput = passwordField.input;
  usernameInput.value = username;
  let submit = authButton(
    {
      kind: 'primary',
      type: 'submit',
      disabled: true,
      'data-test-secure-password-submit': true,
    },
    'Sign In',
  );
  let submitting = false;
  // Sign In waits for both fields, as the app's does; typing clears an error.
  function refresh() {
    submit.disabled =
      submitting || !usernameInput.value.trim() || !passwordInput.value;
  }
  for (let input of [usernameInput, passwordInput]) {
    input.addEventListener('input', () => {
      showError(error, undefined);
      refresh();
    });
  }
  let cliPageParams = cliParams(cli, username);
  let form = h(
    'form',
    {
      novalidate: true,
      'data-test-secure-sign-in-form': true,
      async onsubmit(event) {
        event.preventDefault();
        if (submit.disabled) {
          return;
        }
        submitting = true;
        refresh();
        setLoading(submit, true);
        showError(error, undefined);
        try {
          onSignedIn(
            await signInWithPassword(config, {
              username: usernameInput.value,
              password: passwordInput.value,
              client,
            }),
          );
        } catch (e) {
          showError(error, signInFailed(e));
          passwordInput.value = '';
          submitting = false;
          setLoading(submit, false);
          refresh();
        }
      },
    },
    googleSlot,
    usernameField.element,
    passwordField.element,
    linkButton(
      {
        kind: 'link-muted',
        size: 'extra-small',
        className: 'forgot-password',
        'data-test-secure-forgot-password': true,
        onclick() {
          window.location.assign(modeURL('forgot-password', cliPageParams));
        },
      },
      'Forgot password?',
    ),
    submit,
    error,
    h(
      'p',
      { class: 'register-prompt' },
      h('span', { class: 'register-prompt-text' }, "Don't have an account?"),
      linkButton(
        {
          kind: 'link-primary',
          className: 'register-link',
          'data-test-secure-register': true,
          onclick() {
            window.location.assign(modeURL('register', cliPageParams));
          },
        },
        'Create a new Boxel account',
      ),
    ),
  );
  renderPage(
    root,
    title(
      { 'data-test-secure-sign-in-title': true },
      'Sign in to your Boxel Account',
    ),
    subtitleSlot,
    form,
  );
  refresh();
  if (username) {
    passwordInput.focus();
  } else {
    usernameInput.focus();
  }

  googleSignInConfig(config).then((google) => {
    if (!google) {
      return;
    }
    let button = authButton(
      {
        className: 'google-button',
        'data-test-secure-google': true,
        async onclick() {
          button.disabled = true;
          setLoading(button, true);
          showError(error, undefined);
          try {
            await beginGoogleSignIn(google, { client, cli, username });
          } catch (e) {
            showError(error, asSentence(e.message));
            setLoading(button, false);
            button.disabled = false;
          }
        },
      },
      googleIcon(),
      'Continue with Google',
    );
    subtitleSlot.replaceWith(
      h(
        'p',
        { class: 'subtitle', 'data-test-secure-sign-in-subtitle': true },
        "Use Google to get started in one tap - we'll create your Boxel account if you don't have one yet.",
      ),
    );
    googleSlot.replaceWith(
      button,
      h(
        'div',
        { class: 'divider', 'aria-hidden': 'true' },
        h('span', { class: 'divider-label' }, 'or use your email'),
      ),
    );
  });
}

// Hands a session to the CLI by posting it to the CLI's loopback listener, as
// a top-level navigation, so it leaves this window only for this machine.
export function handToCli(root, callback, session) {
  let form = h('form', {
    method: 'POST',
    action: callback.url,
    'data-test-secure-cli-handoff': true,
  });
  for (let [name, value] of Object.entries({
    state: callback.state,
    secure_session: session.token,
    user_id: session.user,
    expires_at: session.expiresAt,
  })) {
    let input = h('input', { type: 'hidden', name });
    input.value = value;
    form.append(input);
  }
  renderMessage(
    root,
    'Returning to your terminal…',
    h('p', { class: 'info' }, 'One moment.'),
    form,
  );
  form.submit();
}
