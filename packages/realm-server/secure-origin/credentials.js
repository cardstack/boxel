/* eslint-env browser */
// The credential fields the app frames: the inputs of its sign-in,
// registration, password-reset, change-password and confirm-your-password
// forms. Card code runs in the app page, so a password typed into that page
// could be read by any card on it. Typed here, on the secure origin, it can't.
//
// What a password is sent to, and what goes back:
//
// - A password is only ever sent to the Matrix server named in this page's
//   own markup, which the realm server writes from its configuration, and,
//   once a password is changed, the new one to the realm server named there
//   too, which ends the account's secure sessions. Nothing the app sends can
//   change where either goes.
// - The app sends the parts of a request that aren't secret (a username, an
//   interactive-auth dict, its own access token), asks for the request to be
//   made, and gets back the Matrix server's response. It learns whether each
//   field is filled in, never what is in it.
// - Every message is exchanged with the app page that framed this one alone:
//   one of the origins the realm server lists in this page's markup, and only
//   the window that is this frame's parent.
//
// The form shown, and the requests it may make, are named by the `form` query
// parameter; the app page's origin by `origin`.

import { isListedOrigin } from './app-origins.js';
import { redactResponse } from './redact.js';

const MATRIX_CLIENT_PREFIX = '_matrix/client/v3/';
const MIN_PASSWORD_LENGTH = 8;
// A response is checked for the passwords typed here before it goes to the
// app, so a server that echoed one back couldn't hand it over. A username is
// no secret, and appears in a response as a matter of course. Passwords
// shorter than this are too likely to occur in a response by chance to be
// worth looking for.
const MIN_REDACTED_LENGTH = 4;

const SVG_NS = 'http://www.w3.org/2000/svg';

const FORMS = {
  login: {
    layout: 'auth',
    operations: ['login'],
    fields: [
      {
        name: 'username',
        label: 'Email Address or Username',
        type: 'text',
        id: 'boxel-login-username',
        inputName: 'username',
        autocomplete: 'username',
        placeholder: 'Your email address',
        testId: 'username-field',
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        id: 'boxel-login-password',
        inputName: 'password',
        autocomplete: 'current-password',
        placeholder: 'Your password',
        testId: 'password-field',
      },
    ],
  },
  'cli-login': {
    layout: 'auth',
    operations: ['cli-login'],
    fields: [
      {
        name: 'username',
        label: 'Email Address or Username',
        type: 'text',
        id: 'boxel-cli-auth-username',
        inputName: 'username',
        autocomplete: 'username',
        testId: 'cli-auth-username',
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        id: 'boxel-cli-auth-password',
        inputName: 'password',
        autocomplete: 'current-password',
        testId: 'cli-auth-password',
      },
    ],
  },
  register: {
    layout: 'auth',
    // Its fields show a validation state, as a BoxelInput given `@state` does.
    stateful: true,
    operations: ['register'],
    hiddenUsername: true,
    fields: [
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        id: 'boxel-register-password',
        inputName: 'password',
        autocomplete: 'new-password',
        placeholder: 'Your password',
        testId: 'password-field',
        validate: 'new',
        validHint: { text: 'password is valid', testId: 'password-valid' },
      },
      {
        name: 'confirm',
        label: 'Confirm Password',
        type: 'password',
        id: 'boxel-register-confirm-password',
        inputName: 'confirm-password',
        autocomplete: 'new-password',
        placeholder: 'Re-enter your password',
        testId: 'confirm-password-field',
        validate: 'confirm',
        validHint: { text: 'passwords match', testId: 'passwords-match' },
      },
    ],
  },
  reset: {
    layout: 'auth',
    // Its fields show a validation state, as a BoxelInput given `@state` does.
    stateful: true,
    operations: ['set-password'],
    fields: [
      {
        name: 'password',
        label: 'Enter New Password',
        type: 'password',
        inputName: 'password',
        autocomplete: 'new-password',
        testId: 'password-field',
        validate: 'new',
      },
      {
        name: 'confirm',
        label: 'Re-Enter New Password',
        type: 'password',
        inputName: 'confirm-password',
        autocomplete: 'new-password',
        testId: 'confirm-password-field',
        validate: 'confirm',
      },
    ],
  },
  'change-password': {
    layout: 'settings',
    // Its fields show a validation state, as a BoxelInput given `@state` does.
    stateful: true,
    operations: ['set-password'],
    hiddenUsername: true,
    fields: [
      {
        name: 'current',
        label: 'Current Password',
        type: 'password',
        autocomplete: 'current-password',
        testId: 'current-password-field',
      },
      {
        name: 'password',
        label: 'New Password',
        type: 'password',
        autocomplete: 'new-password',
        testId: 'new-password-field',
        validate: 'new',
      },
      {
        name: 'confirm',
        label: 'Confirm New Password',
        type: 'password',
        autocomplete: 'new-password',
        testId: 'confirm-password-field',
        validate: 'confirm',
      },
    ],
  },
  'confirm-password': {
    layout: 'modal',
    // Its fields show a validation state, as a BoxelInput given `@state` does.
    stateful: true,
    operations: ['add-threepid'],
    fields: [
      {
        name: 'current',
        type: 'password',
        autocomplete: 'current-password',
        testId: 'password-field',
      },
    ],
  },
};

function readConfig() {
  let meta = (name) =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
    '';
  return {
    matrixURL: new URL(meta('boxel-matrix-url')),
    realmServerURL: new URL(meta('boxel-realm-server-url')),
    appOrigins: meta('boxel-app-origins').split(/\s+/).filter(Boolean),
  };
}

let config = readConfig();
let params = new URL(window.location.href).searchParams;
let formName = params.get('form');
let form = Object.hasOwn(FORMS, formName) ? FORMS[formName] : undefined;
let appOrigin = params.get('origin');

// Only an app page on one of the listed origins, framing this one, is ever
// talked to. `frame-ancestors` already refuses any other page; this keeps the
// messages to the same set.
if (
  form &&
  appOrigin &&
  isListedOrigin(appOrigin, config.appOrigins) &&
  window.parent !== window
) {
  start(form);
}

function start(form) {
  let root = document.documentElement;
  let formElement = document.getElementById('credential-fields');
  document.body.classList.add(`layout-${form.layout}`);

  // name -> { field, input, content, errorElement, iconElement, hintElement,
  // error }
  let fields = new Map();
  let hiddenUsername;
  if (form.hiddenUsername) {
    // Gives a password manager the account a new password belongs to.
    hiddenUsername = document.createElement('input');
    hiddenUsername.type = 'text';
    hiddenUsername.name = 'username';
    hiddenUsername.autocomplete = 'username';
    hiddenUsername.hidden = true;
    hiddenUsername.tabIndex = -1;
    formElement.append(hiddenUsername);
  }
  for (let field of form.fields) {
    fields.set(field.name, renderField(formElement, form, field));
  }

  function send(message) {
    window.parent.postMessage(message, appOrigin);
  }

  function value(name) {
    return fields.get(name)?.input.value ?? '';
  }

  function isComplete() {
    for (let entry of fields.values()) {
      if (!entry.input.value || entry.error) {
        return false;
      }
    }
    return true;
  }

  // Sent only when it changes, so the app page, and any card in it, can't
  // count keystrokes by it.
  let lastState;
  function sendState() {
    let filled = {};
    for (let [name, entry] of fields) {
      filled[name] = Boolean(entry.input.value);
    }
    let state = { type: 'state', filled, complete: isComplete() };
    let serialized = JSON.stringify(state);
    if (serialized !== lastState) {
      lastState = serialized;
      send(state);
    }
    refreshHints();
  }

  // The app clears an error it shows about the fields when one is typed
  // into. It hears of the first keystroke after the fields were last
  // submitted or marked invalid, and of none after that, for the same reason
  // `state` is only sent on a change.
  let inputReported = new Set();

  // Shown the way a BoxelInput shows `@state='invalid'` with an
  // `@errorMessage`: the input marked invalid, the icon and the message added
  // beside it, all removed again once the error clears.
  function setError(name, message) {
    let entry = fields.get(name);
    if (!entry) {
      return;
    }
    entry.error = message || undefined;
    let { input } = entry;
    entry.errorElement?.remove();
    entry.errorElement = undefined;
    entry.iconElement?.remove();
    entry.iconElement = undefined;
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
    input.classList.toggle('invalid', Boolean(entry.error));
    if (form.stateful) {
      input.setAttribute(
        'data-test-boxel-input-validation-state',
        entry.error ? 'invalid' : 'initial',
      );
    }
    if (!entry.error) {
      return;
    }
    input.setAttribute('aria-invalid', 'true');
    entry.iconElement = document.createElement('div');
    entry.iconElement.className = 'validation-icon-container';
    entry.iconElement.append(failureIcon());
    entry.errorElement = document.createElement('div');
    entry.errorElement.className = 'error-message';
    entry.errorElement.id = `error-message-${name}`;
    entry.errorElement.setAttribute('aria-live', 'polite');
    entry.errorElement.setAttribute('data-test-boxel-input-error-message', '');
    entry.errorElement.textContent = entry.error;
    input.setAttribute('aria-errormessage', entry.errorElement.id);
    input.after(entry.iconElement, entry.errorElement);
  }

  function validate(name) {
    let entry = fields.get(name);
    if (entry.field.validate === 'new') {
      let password = entry.input.value;
      if (!password) {
        setError(name, 'Password is missing');
      } else if (password.length < MIN_PASSWORD_LENGTH) {
        setError(name, 'Password must be at least 8 characters long');
      }
    } else if (entry.field.validate === 'confirm') {
      if (entry.input.value !== value('password')) {
        setError(name, 'Passwords do not match');
      }
    }
  }

  function refreshHints() {
    for (let [name, entry] of fields) {
      let hint = entry.field.validHint;
      if (!hint) {
        continue;
      }
      let input = entry.input.value;
      let shown =
        Boolean(input) &&
        !entry.error &&
        (entry.field.validate === 'new'
          ? input.length >= MIN_PASSWORD_LENGTH
          : name === 'confirm' && input === value('password'));
      if (shown && !entry.hintElement) {
        entry.hintElement = document.createElement('p');
        entry.hintElement.className = 'validation-hint';
        entry.hintElement.setAttribute(`data-test-${hint.testId}`, '');
        entry.hintElement.append(checkMarkIcon(), hint.text);
        entry.content.append(entry.hintElement);
      } else if (!shown && entry.hintElement) {
        entry.hintElement.remove();
        entry.hintElement = undefined;
      }
    }
  }

  for (let [name, entry] of fields) {
    entry.input.addEventListener('input', () => {
      setError(name, undefined);
      if (!inputReported.has(name)) {
        inputReported.add(name);
        send({ type: 'input', field: name });
      }
      sendState();
    });
    entry.input.addEventListener('blur', () => {
      validate(name);
      sendState();
    });
    entry.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        send({ type: 'submit-request' });
      }
    });
  }
  formElement.addEventListener('submit', (event) => event.preventDefault());

  // The page resolves the custom properties these fields' styles use, and
  // the text styles they inherit, where the frame sits, and sends them.
  let inheritedProperties = [
    'color',
    'color-scheme',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'letter-spacing',
    'line-height',
    'text-rendering',
    '-webkit-font-smoothing',
  ];
  let customProperties = ['--credential-layout'];

  function applyStyle({ properties, inherited, backdrop, offset, width }) {
    for (let name of customProperties) {
      let resolved = properties?.[name];
      if (typeof resolved === 'string' && resolved.trim() !== '') {
        root.style.setProperty(name, resolved);
      } else {
        root.style.removeProperty(name);
      }
    }
    for (let name of inheritedProperties) {
      let resolved = inherited?.[name];
      if (typeof resolved === 'string' && resolved !== '') {
        (name === 'color-scheme' ? root : document.body).style.setProperty(
          name,
          resolved,
        );
      }
    }
    // The solid colour behind the frame in the page, when there is one, so
    // text here is drawn on an opaque background as the page's own is.
    if (typeof backdrop === 'string' && CSS.supports('color', backdrop)) {
      root.style.backgroundColor = backdrop;
    } else {
      root.style.removeProperty('background-color');
    }
    // The page puts the frame on the whole pixel at or before where the
    // fields it stands in for start, which may be part of the way into one.
    // Moving the content forward by that part, at the width the fields have
    // in the page, puts every edge and glyph on the pixel the page would have
    // drawn it on.
    let exactWidth = Number(width);
    if (Number.isFinite(exactWidth) && exactWidth > 0) {
      document.body.style.width = `${exactWidth}px`;
    } else {
      document.body.style.removeProperty('width');
    }
    for (let [axis, side] of [
      ['x', 'left'],
      ['y', 'top'],
    ]) {
      let shift = Number(offset?.[axis]);
      if (Number.isFinite(shift) && Math.abs(shift) < 1) {
        document.body.style.setProperty(side, `${shift}px`);
      } else {
        document.body.style.removeProperty(side);
      }
    }
    document.body.classList.toggle(
      'narrow',
      (properties?.['--credential-layout'] ?? '').trim() === 'narrow',
    );
    root.classList.add('styled');
  }

  let lastHeight = -1;
  function sendSize() {
    // Exact, not rounded: the page lays out around this height, and a
    // fraction of a pixel added here moves everything after the frame.
    let height = formElement.getBoundingClientRect().height;
    if (height !== lastHeight) {
      lastHeight = height;
      send({ type: 'size', height });
    }
  }
  new ResizeObserver(sendSize).observe(formElement);

  // Requests are made one at a time, in the order they were asked for, so a
  // form that asks again while one is in flight gets an answer to both.
  let queue = Promise.resolve();
  function perform(id, operation, args) {
    queue = queue.then(() => performNow(id, operation, args));
  }

  async function performNow(id, operation, args) {
    inputReported.clear();
    if (!form.operations.includes(operation) || !isComplete()) {
      send({
        type: 'result',
        id,
        ok: false,
        status: 0,
        body: { error: 'The form is not ready to submit.' },
      });
      return;
    }
    // Lets a password manager see the form go, as it would for the app's own
    // form; the submit event itself is cancelled above.
    formElement.requestSubmit();
    let result;
    try {
      result = await OPERATIONS[operation](args ?? {});
    } catch (e) {
      result = { ok: false, status: 0, body: { error: String(e?.message) } };
    }
    send({ type: 'result', id, ...redact(result) });
  }

  // Each operation makes its Matrix requests with the passwords filled in
  // from the fields and the parts that aren't secret taken from the app.
  const OPERATIONS = {
    async login() {
      return await passwordLogin();
    },

    async 'cli-login'() {
      return await passwordLogin();
    },

    async register({ username, auth }) {
      return await matrixRequest('register', {
        body: {
          username: String(username ?? ''),
          password: value('password'),
          auth: plainObject(auth),
        },
      });
    },

    // Always signs out the account's other sessions, which is not the app's
    // to turn off: a session stolen before the change must not outlive it.
    // The Matrix server signs out the account's devices; its secure sessions
    // are ended at the realm server, for the account the app names in
    // `account` (its Matrix id, or the email address a reset was sent to).
    async 'set-password'({ auth, accessToken, account }) {
      let result = await matrixRequest('account/password', {
        accessToken,
        body: {
          auth: withPassword(plainObject(auth)),
          new_password: value('password'),
          logout_devices: true,
        },
      });
      if (result.ok && typeof account === 'string' && account) {
        await endSessionsForNewPassword(account);
      }
      return result;
    },

    async 'add-threepid'({ auth, accessToken, clientSecret, sid }) {
      return await matrixRequest('account/3pid/add', {
        accessToken,
        body: {
          auth: withPassword(plainObject(auth)),
          client_secret: String(clientSecret ?? ''),
          sid: String(sid ?? ''),
        },
      });
    },
  };

  // Signs in with the username field as a Matrix username, then, if that
  // fails, as an email address. When neither signs in, the username
  // attempt's response is returned.
  async function passwordLogin() {
    let password = value('password');
    let username = value('username');
    let byUsername = await matrixRequest('login', {
      body: {
        identifier: { type: 'm.id.user', user: username },
        password,
        type: 'm.login.password',
      },
    });
    if (byUsername.ok) {
      return byUsername;
    }
    let byEmail = await matrixRequest('login', {
      body: {
        identifier: {
          type: 'm.id.thirdparty',
          medium: 'email',
          address: username,
        },
        password,
        type: 'm.login.password',
      },
    });
    return byEmail.ok ? byEmail : byUsername;
  }

  // Asks the realm server to end every secure session of the account whose
  // password was just changed, proving it with the new password. The password
  // is changed whatever the answer, so a failure is not the app's to see; a
  // session the realm server couldn't end runs out within its week. The app
  // can name any account, but only the new password, which it never sees,
  // gets a session ended.
  async function endSessionsForNewPassword(account) {
    try {
      await fetch(
        new URL('_secure-sessions/password-change', config.realmServerURL),
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json',
          },
          body: JSON.stringify({
            data: {
              type: 'password-change',
              attributes: { username: account, password: value('password') },
            },
          }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      );
    } catch {
      // See above: the password is changed either way.
    }
  }

  // An interactive-auth dict for the password stage carries the account's
  // current password, which is in a field here, never in the app's dict.
  function withPassword(auth) {
    if (auth.type === 'm.login.password') {
      return { ...auth, password: value('current') };
    }
    return auth;
  }

  async function matrixRequest(path, { body, accessToken }) {
    let headers = { 'Content-Type': 'application/json' };
    if (typeof accessToken === 'string' && accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    let response;
    try {
      response = await fetch(
        new URL(`${MATRIX_CLIENT_PREFIX}${path}`, config.matrixURL),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      );
    } catch (e) {
      return { ok: false, status: 0, body: { error: String(e?.message) } };
    }
    let json = {};
    try {
      json = await response.json();
    } catch {
      // A response that isn't JSON is reported by its status alone.
    }
    return { ok: response.ok, status: response.status, body: json };
  }

  function redact(result) {
    let secrets = [...fields.values()]
      .filter((entry) => entry.field.type === 'password')
      .map((entry) => entry.input.value)
      .filter((secret) => secret.length >= MIN_REDACTED_LENGTH);
    return redactResponse(result, secrets);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== appOrigin) {
      return;
    }
    let message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    switch (message.type) {
      case 'style':
        applyStyle(message);
        sendSize();
        break;
      case 'context': {
        let username = String(message.username ?? '');
        if (hiddenUsername) {
          hiddenUsername.value = username;
        }
        // A username the page already knows fills the username field in,
        // and stays editable.
        let usernameField = fields.get('username');
        if (usernameField && !usernameField.input.value && username) {
          usernameField.input.value = username;
          sendState();
        }
        break;
      }
      case 'field-error':
        inputReported.delete(String(message.field));
        setError(String(message.field), message.message);
        sendState();
        break;
      // Checks every field as leaving it does, and answers once the app's
      // `state` is up to date. A field the user just left may not have been
      // reported yet when the app goes to act on its last `state`.
      case 'validate':
        for (let [name, entry] of fields) {
          if (entry.input.value && !entry.error) {
            validate(name);
          }
        }
        sendState();
        send({ type: 'validated', id: message.id, complete: isComplete() });
        break;
      case 'submit':
        perform(message.id, String(message.operation), message.args);
        break;
    }
  });

  whenStyled().then(() => {
    customProperties.push(...collectCustomProperties());
    send({ type: 'ready', properties: customProperties });
    sendState();
  });
}

function whenStyled() {
  let link = document.querySelector('link[rel="stylesheet"]');
  if (!link || link.sheet) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  });
}

function renderField(formElement, form, field) {
  let vertical = form.layout !== 'settings';
  let wrapper = document.createElement('label');
  wrapper.className = `boxel-field ${vertical ? 'vertical' : 'horizontal'}`;
  wrapper.setAttribute('data-test-boxel-field', '');

  let labelContainer = document.createElement('div');
  labelContainer.className = 'label-container';
  if (field.label) {
    let label = document.createElement('div');
    label.className = 'boxel-label label';
    label.setAttribute('data-test-boxel-field-label', '');
    label.textContent = field.label;
    labelContainer.append(label);
  }

  let content = document.createElement('div');
  content.className = 'content';

  let container = document.createElement('div');
  container.className = 'input-container';

  let input = document.createElement('input');
  input.className = 'boxel-input';
  input.type = field.type;
  if (field.inputName) {
    input.name = field.inputName;
  }
  input.autocomplete = field.autocomplete;
  if (field.id) {
    input.id = field.id;
  }
  if (field.placeholder) {
    input.placeholder = field.placeholder;
  }
  input.setAttribute('data-test-boxel-input', '');
  if (field.id) {
    input.setAttribute('data-test-boxel-input-id', field.id);
  }
  if (form.stateful) {
    input.setAttribute('data-test-boxel-input-validation-state', 'initial');
  }
  input.setAttribute(`data-test-${field.testId}`, '');

  container.append(input);
  content.append(container);

  wrapper.append(labelContainer, content);
  formElement.append(wrapper);
  return {
    field,
    input,
    content,
    errorElement: undefined,
    iconElement: undefined,
    hintElement: undefined,
    error: undefined,
  };
}

// The custom properties the stylesheet uses, so the page can be asked for
// exactly those.
function collectCustomProperties() {
  let names = new Set();
  let pattern = /var\(\s*(--[\w-]+)/g;
  for (let sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (let rule of rules) {
      for (let match of rule.cssText.matchAll(pattern)) {
        names.add(match[1]);
      }
    }
  }
  // Defined by the stylesheet itself, from the page's values.
  for (let local of ['--icon-size', '--icon-space', '--_icon-full-length']) {
    names.delete(local);
  }
  return [...names];
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
}

function svgElement(name, attributes) {
  let element = document.createElementNS(SVG_NS, name);
  for (let [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

// boxel-ui's FailureBordered icon.
function failureIcon() {
  let svg = svgElement('svg', {
    width: '24',
    height: '24',
    viewBox: '0 0 24 24',
    role: 'presentation',
    class: 'validation-icon-invalid',
  });
  let group = svgElement('g', { fill: 'none' });
  group.append(
    svgElement('circle', {
      cx: '12',
      cy: '12',
      r: '10',
      fill: 'var(--icon-background-color, var(--destructive, red))',
    }),
    svgElement('path', {
      fill: 'var(--icon-foreground-color, #f5f5f5)',
      d: 'M13.143 12.757h-2.32l-.486-6.855h3.29zM10.3 16.01a1.6 1.6 0 0 1 .427-1.207 1.74 1.74 0 0 1 1.246-.41 1.7 1.7 0 0 1 1.222.419c.304.322.461.756.432 1.198a1.6 1.6 0 0 1-.437 1.182c-.33.303-.77.46-1.217.433a1.7 1.7 0 0 1-1.237-.423 1.58 1.58 0 0 1-.436-1.192',
    }),
  );
  svg.append(group);
  return svg;
}

// boxel-ui's CheckMark icon.
function checkMarkIcon() {
  let svg = svgElement('svg', {
    viewBox: '5 6 10.73 8',
    class: 'validation-hint-icon',
  });
  svg.append(
    svgElement('path', {
      fill: 'none',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': '2',
      d: 'm14.727 7-6 6L6 10.273',
    }),
  );
  return svg;
}
