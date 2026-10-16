/* eslint-env browser */
// Signing in on the secure window: the window's own session (`sign-in`), or a
// session handed to the CLI waiting on a loopback port (`cli-sign-in`), with a
// password or with Google. Google returns to this origin's callback
// (`googleCallbackMode`), which finishes whichever of the two began.
//
// Everything here is typed into, and sent from, this window. Nothing goes to
// the app page.

import {
  beginGoogleSignIn,
  finishGoogleSignIn,
  googleSignInConfig,
  readConfig,
  signInWithPassword,
  signOut,
  storedSession,
  storeSession,
} from './session.js';

const LOOPBACK_CALLBACK_PATH = '/callback';
const GOOGLE_CALLBACK_SUFFIX = /\/google-callback$/;

// The window's own sign-in, from the callback Google returns to.
function signInURL() {
  return `${window.location.pathname.replace(GOOGLE_CALLBACK_SUFFIX, '/')}?mode=sign-in`;
}

// Builds an element. Text is only ever set as text, never as markup.
function h(tag, attributes = {}, ...children) {
  let element = document.createElement(tag);
  for (let [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (name.startsWith('on')) {
      element.addEventListener(name.slice(2), value);
    } else {
      element.setAttribute(name, value === true ? '' : value);
    }
  }
  element.append(...children.filter((child) => child !== undefined));
  return element;
}

// The CLI waiting for a session: the loopback port it listens on and the
// state value it expects back. Anything else is refused, so this page can only
// ever hand a session to a listener on this machine.
function cliCallback(params) {
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

export function signInMode(root) {
  let config = readConfig();
  // The window has no sign-out control; this ends its session from the
  // browser's console. Signed out here, the window shows its sign-in again.
  window.boxelSignOut = async () => {
    await signOut(config);
    signInMode(root);
  };
  let session = storedSession();
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
    root.replaceChildren(
      page(
        'This sign-in link is not complete',
        h('p', {}, 'Run the command in your terminal again to get a new link.'),
      ),
    );
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

// Where Google sends the window back to.
export async function googleCallbackMode(root) {
  let config = readConfig();
  root.replaceChildren(page('Signing you in…', h('p', {}, 'One moment.')));
  let result;
  try {
    result = await finishGoogleSignIn(config);
  } catch (e) {
    let error = errorLine();
    showError(error, e.message);
    root.replaceChildren(
      page(
        'That didn’t work',
        error,
        h(
          'a',
          {
            class: 'secure-button secondary',
            href: signInURL(),
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
  history.replaceState(null, '', signInURL());
  renderSignedIn(root);
}

function page(title, ...content) {
  return h(
    'section',
    { class: 'secure-card', 'data-test-secure-sign-in': true },
    h('h1', {}, title),
    ...content,
  );
}

function errorLine() {
  return h('p', {
    class: 'secure-error',
    role: 'alert',
    'data-test-secure-error': true,
    hidden: true,
  });
}

// The server words its errors for an API; shown here, each reads as a
// sentence.
function asSentence(message) {
  let text = String(message ?? '').trim();
  if (!text) {
    return '';
  }
  text = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function showError(element, message) {
  element.textContent = asSentence(message);
  element.hidden = !message;
}

function renderSignedIn(root) {
  root.replaceChildren(
    page(
      'You’re signed in',
      h(
        'p',
        { class: 'secure-subtitle', 'data-test-secure-signed-in': true },
        'You can close this window.',
      ),
    ),
  );
}

// The sign-in form, laid out like the app's: Google first when this server
// offers it, then an email address or username and a password.
function renderSignIn(
  root,
  config,
  { client, cli, username = '', onSignedIn },
) {
  let error = errorLine();
  let googleSlot = h('div', { class: 'secure-google', hidden: true });
  let usernameInput = h('input', {
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    required: true,
    'data-test-secure-username': true,
  });
  usernameInput.value = username;
  let passwordInput = h('input', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    required: true,
    'data-test-secure-password': true,
  });
  let submit = h(
    'button',
    {
      type: 'submit',
      class: 'secure-button',
      'data-test-secure-password-submit': true,
    },
    'Sign in',
  );
  let form = h(
    'form',
    {
      novalidate: true,
      async onsubmit(event) {
        event.preventDefault();
        if (!usernameInput.value.trim() || !passwordInput.value) {
          showError(
            error,
            'Enter your email address or username and password.',
          );
          return;
        }
        submit.disabled = true;
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
          showError(error, e.message);
          submit.disabled = false;
        } finally {
          passwordInput.value = '';
        }
      },
    },
    h(
      'label',
      { class: 'secure-field' },
      h('span', {}, 'Email address or username'),
      usernameInput,
    ),
    h(
      'label',
      { class: 'secure-field' },
      h('span', {}, 'Password'),
      passwordInput,
    ),
    error,
    submit,
  );
  root.replaceChildren(
    page(
      'Sign in to Boxel',
      client === 'cli'
        ? h(
            'p',
            { class: 'secure-subtitle' },
            'to let the Boxel CLI on this computer manage your keys',
          )
        : undefined,
      googleSlot,
      form,
    ),
  );
  if (username) {
    passwordInput.focus();
  } else {
    usernameInput.focus();
  }

  googleSignInConfig(config).then((google) => {
    if (!google) {
      return;
    }
    let button = h(
      'button',
      {
        type: 'button',
        class: 'secure-button google',
        'data-test-secure-google': true,
        async onclick() {
          button.disabled = true;
          showError(error, undefined);
          try {
            await beginGoogleSignIn(google, { client, cli });
          } catch (e) {
            showError(error, e.message);
            button.disabled = false;
          }
        },
      },
      'Continue with Google',
    );
    googleSlot.replaceChildren(
      button,
      h('p', { class: 'secure-divider' }, 'or'),
    );
    googleSlot.hidden = false;
  });
}

// Hands a session to the CLI by posting it to the CLI's loopback listener, as
// a top-level navigation, so it leaves this window only for this machine.
function handToCli(root, callback, session) {
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
  root.replaceChildren(
    page('Returning to your terminal…', h('p', {}, 'One moment.'), form),
  );
  form.submit();
}
