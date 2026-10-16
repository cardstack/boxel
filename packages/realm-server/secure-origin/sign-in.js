/* eslint-env browser */
// Signing in on the secure window: the window's own session (`sign-in`), or a
// session handed to the CLI waiting on a loopback port (`cli-sign-in`).
//
// Everything here is typed into, and sent from, this window. Nothing comes
// from, or goes to, the app page.

import {
  completeSignIn,
  readConfig,
  signOut,
  startSignIn,
  storedSession,
  storeSession,
} from './session.js';

// How often the window asks whether single sign-on has been confirmed.
const SSO_POLL_MS = 2000;

const LOOPBACK_CALLBACK_PATH = '/callback';

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

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
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
  let session = storedSession();
  if (session) {
    renderSignedIn(root, config, session);
  } else {
    renderSignIn(root, config, {
      client: 'window',
      onSignedIn(signedIn) {
        storeSession(signedIn);
        renderSignedIn(root, config, signedIn);
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
    username: params.get('user') ?? '',
    onSignedIn(signedIn) {
      handToCli(root, callback, signedIn);
    },
  });
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

function showError(element, message) {
  element.textContent = message ?? '';
  element.hidden = !message;
}

function renderSignedIn(root, config, session) {
  let error = errorLine();
  let button = h(
    'button',
    {
      type: 'button',
      class: 'secure-button secondary',
      'data-test-secure-sign-out': true,
      async onclick() {
        button.disabled = true;
        try {
          await signOut(config);
        } catch (e) {
          // The session is already forgotten here; the server ends it when it
          // expires.
          showError(error, e.message);
        }
        signInMode(root);
      },
    },
    'Sign out',
  );
  root.replaceChildren(
    page(
      'You’re signed in',
      h(
        'p',
        {},
        'Signed in as ',
        h('strong', { 'data-test-secure-user': true }, session.user),
        ` until ${formatTime(session.expiresAt)}.`,
      ),
      h(
        'p',
        { class: 'secure-note' },
        'This window keeps its own sign-in. Cards in the app can’t see or use it.',
      ),
      error,
      button,
    ),
  );
}

// Asks for the account, then for the user to confirm it is them.
function renderSignIn(root, config, { client, username = '', onSignedIn }) {
  let error = errorLine();
  let input = h('input', {
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    required: true,
    'data-test-secure-username': true,
  });
  input.value = username;
  let submit = h(
    'button',
    {
      type: 'submit',
      class: 'secure-button',
      'data-test-secure-continue': true,
    },
    'Continue',
  );
  let form = h(
    'form',
    {
      novalidate: true,
      async onsubmit(event) {
        event.preventDefault();
        if (!input.value.trim()) {
          showError(error, 'Enter your email address or username.');
          return;
        }
        submit.disabled = true;
        showError(error, undefined);
        try {
          let started = await startSignIn(config, {
            username: input.value,
            client,
          });
          renderConfirm(root, config, {
            client,
            started,
            onSignedIn,
            onRestart: () =>
              renderSignIn(root, config, {
                client,
                username: input.value,
                onSignedIn,
              }),
          });
        } catch (e) {
          showError(error, e.message);
          submit.disabled = false;
        }
      },
    },
    h(
      'label',
      { class: 'secure-field' },
      h('span', {}, 'Email address or username'),
      input,
    ),
    error,
    submit,
  );
  root.replaceChildren(
    page(
      client === 'cli'
        ? 'Sign in the Boxel CLI'
        : 'Sign in to the secure window',
      h(
        'p',
        {},
        client === 'cli'
          ? 'Confirm it’s you to let the Boxel CLI on this computer manage your keys.'
          : 'Confirm it’s you to manage your keys here, where cards in the app can’t reach.',
      ),
      form,
    ),
  );
  input.focus();
}

function renderConfirm(
  root,
  config,
  { client, started, onSignedIn, onRestart },
) {
  let error = errorLine();
  let parts = [];
  let finished = false;
  let succeed = (session) => {
    finished = true;
    onSignedIn(session);
  };

  if (started.stages.includes('password')) {
    let password = h('input', {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      required: true,
      'data-test-secure-password': true,
    });
    // Gives a password manager the account the password belongs to.
    let username = h('input', {
      type: 'text',
      name: 'username',
      autocomplete: 'username',
      hidden: true,
      tabindex: '-1',
    });
    username.value = started.user;
    let submit = h(
      'button',
      {
        type: 'submit',
        class: 'secure-button',
        'data-test-secure-password-submit': true,
      },
      'Sign in',
    );
    parts.push(
      h(
        'form',
        {
          novalidate: true,
          async onsubmit(event) {
            event.preventDefault();
            if (!password.value) {
              showError(error, 'Enter your password.');
              return;
            }
            submit.disabled = true;
            showError(error, undefined);
            try {
              succeed(
                await completeSignIn(config, {
                  signIn: started.signIn,
                  password: password.value,
                }),
              );
            } catch (e) {
              showError(error, e.message);
              submit.disabled = false;
              if (e.code === 'expired' || e.code === 'used') {
                onRestart();
              }
            } finally {
              password.value = '';
            }
          },
        },
        username,
        h(
          'label',
          { class: 'secure-field' },
          h('span', {}, 'Password'),
          password,
        ),
        submit,
      ),
    );
    queueMicrotask(() => password.focus());
  }

  if (started.stages.includes('sso') && started.ssoURL) {
    let waiting = h(
      'p',
      {
        class: 'secure-note',
        'data-test-secure-sso-waiting': true,
        hidden: true,
      },
      'Confirm it’s you in the window that opened. This page continues on its own once you have.',
    );
    let polling = false;
    let poll = async () => {
      if (polling) {
        return;
      }
      polling = true;
      try {
        while (!finished && Date.now() < Date.parse(started.expiresAt)) {
          try {
            succeed(await completeSignIn(config, { signIn: started.signIn }));
            return;
          } catch (e) {
            if (e.code !== 'pending') {
              showError(error, e.message);
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, SSO_POLL_MS));
        }
        if (!finished) {
          showError(error, 'This sign-in has expired. Start again.');
        }
      } finally {
        polling = false;
      }
    };
    let ssoButton = h(
      'button',
      {
        type: 'button',
        class: 'secure-button google',
        'data-test-secure-sso': true,
        onclick() {
          showError(error, undefined);
          // A separate window, so this one stays put and continues by itself
          // once the confirmation is done. It has no handle back to this one.
          window.open(
            started.ssoURL,
            'boxel-secure-sso',
            'popup,width=520,height=720',
          );
          waiting.hidden = false;
          ssoButton.textContent = 'Open the confirmation again';
          poll();
        },
      },
      'Continue with Google',
    );
    if (parts.length > 0) {
      parts.push(h('p', { class: 'secure-divider' }, 'or'));
    }
    parts.push(ssoButton, waiting);
  }

  root.replaceChildren(
    page(
      'Confirm it’s you',
      h(
        'p',
        {},
        'Signing in as ',
        h('strong', { 'data-test-secure-user': true }, started.user),
        client === 'cli' ? ' for the Boxel CLI.' : '.',
      ),
      ...parts,
      error,
      h(
        'button',
        {
          type: 'button',
          class: 'secure-link',
          'data-test-secure-restart': true,
          onclick() {
            finished = true;
            onRestart();
          },
        },
        'Use a different account',
      ),
    ),
  );
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
