/* eslint-env browser */
// The protocol of the credential fields the app frames: the inputs of its
// change-password and confirm-your-password forms. Card code runs in the app page, so a password
// typed into that page could be read by any card on it. Typed here, on the
// secure origin, it can't.
//
// This module decides what each form holds, what the app hears of it and
// which requests a password goes into. It renders nothing: the components in
// `src/credentials/` draw the fields from a `CredentialFrame` and report to it
// what is typed.
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
// The form shown, and the requests it may make, are named by the `form`
// parameter; the app page's origin by `origin`. The app passes both in the
// URL's fragment, which is never sent to the server, so no filter in front of
// it sees an app origin such as `http://localhost:4200`, which a WAF rule
// refuses in a query string. A page that is not on the user's own machine
// may pass them in the query as well, or in the query alone, so the query is
// read when the fragment names no form.

import { isListedOrigin } from './app-origins.js';
import { redactResponse } from './redact.js';
import { changePassword, readConfig as readRealmServer } from './session.js';

const MATRIX_CLIENT_PREFIX = '_matrix/client/v3/';
export const MIN_PASSWORD_LENGTH = 8;
// A response is checked for the passwords typed here before it goes to the
// app, so a server that echoed one back couldn't hand it over. A username is
// no secret, and appears in a response as a matter of course. Passwords
// shorter than this are too likely to occur in a response by chance to be
// worth looking for.
const MIN_REDACTED_LENGTH = 4;

// The forms the frame shows, by the name the app gives in `form`. Each names
// its fields and the one request it may make. A field's `validate` is `new`
// for a new password and `confirm` for its confirmation; a form that is
// `stateful` shows each field's validation state, as a BoxelInput given
// `@state` does.
export const FORMS = {
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
        // The modal names the field in its prose, not with a label, so the
        // input is named for assistive technology alone.
        accessibleName: 'Password',
        type: 'password',
        autocomplete: 'current-password',
        testId: 'password-field',
      },
    ],
  },
};

// The page's configuration, which the realm server writes into its markup:
// the Matrix server a password is sent to, and the app origins the frame may
// talk to.
export function readConfig(doc = document) {
  let meta = (name) =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? '';
  return {
    matrixURL: new URL(meta('boxel-matrix-url')),
    appOrigins: meta('boxel-app-origins').split(/\s+/).filter(Boolean),
  };
}

// The form the frame shows and the app page's origin, read from the frame's
// URL: from its fragment, or from its query when the fragment names no form.
// `form` is undefined for a name that isn't in `FORMS`.
export function readParams(href) {
  let url = new URL(href);
  let fragmentParams = new URLSearchParams(url.hash.slice(1));
  let params = fragmentParams.has('form') ? fragmentParams : url.searchParams;
  let formName = params.get('form');
  return {
    formName,
    form: Object.hasOwn(FORMS, formName) ? FORMS[formName] : undefined,
    appOrigin: params.get('origin'),
  };
}

// Only an app page on one of the listed origins, framing this one, is ever
// talked to. `frame-ancestors` already refuses any other page; this keeps the
// messages to the same set.
export function mayStart({ form, appOrigin, appOrigins, framed }) {
  return Boolean(
    form && appOrigin && isListedOrigin(appOrigin, appOrigins) && framed,
  );
}

// The frame's side of the conversation with the app page, for one form. It
// holds what is typed into each field, and decides what the app hears of it
// and which requests a password goes into. It draws nothing: the frame's
// components render its fields from it, and report what is typed and left
// through `input`, `blur` and `enter`. Everything it reaches outside itself
// is passed in, so it runs, and is tested, without a page.
//
// - `parent`: the window that framed this one. A message is answered only
//   when that window sent it, from `appOrigin`.
// - `send(message)`: posts a message to `parent`, at `appOrigin`.
// - `applyStyle(message)`: draws the fields in the styles the app sends.
// - `measure()`: the height of the fields, as laid out.
// - `requestSubmit()`: submits the form the fields are in, which lets a
//   password manager see it go.
// - `onChange()`: called whenever what the fields show changes.
// - `rendered()`: resolves once the fields show the last change.
// - `fetch` and `changePassword`: where the Matrix requests go, and the
//   realm server's request that sets a password and ends the account's
//   secure sessions.
export class CredentialFrame {
  /**
   * @param {{
   *   form: any,
   *   appOrigin: string,
   *   matrixURL: URL,
   *   parent: unknown,
   *   send: (message: object) => void,
   *   applyStyle?: (message: any) => void,
   *   measure?: () => number,
   *   requestSubmit?: () => void,
   *   onChange?: () => void,
   *   rendered?: () => Promise<unknown>,
   *   fetch?: (url: URL, init: RequestInit) => Promise<Response>,
   *   changePassword?: (change: Record<string, string>) => Promise<{ ok: boolean, status: number, body: any }>,
   * }} options
   */
  constructor({
    form,
    appOrigin,
    matrixURL,
    parent,
    send,
    applyStyle = () => {},
    measure = () => 0,
    requestSubmit = () => {},
    onChange = () => {},
    rendered = () => Promise.resolve(),
    fetch = globalThis.fetch.bind(globalThis),
    changePassword: changePasswordAt = (change) =>
      changePassword(readRealmServer(), change),
  }) {
    this.form = form;
    this.appOrigin = appOrigin;
    this.matrixURL = matrixURL;
    this.parent = parent;
    this.send = send;
    this.applyStyle = applyStyle;
    this.measure = measure;
    this.requestSubmit = requestSubmit;
    this.onChange = onChange;
    this.rendered = rendered;
    this.fetch = fetch;
    this.changePassword = changePasswordAt;

    // The username a password manager is given for a new password, when the
    // form has a hidden username field.
    this.hiddenUsername = '';
    // Whether the layout follows a narrow space around the fields, as the
    // app's `--credential-layout: narrow` says.
    this.narrow = false;
    // name -> { field, value, error }
    this.fields = new Map(
      form.fields.map((field) => [
        field.name,
        { field, value: '', error: undefined },
      ]),
    );
    // Sent only when it changes, so the app page, and any card in it, can't
    // count keystrokes by it.
    this.lastState = undefined;
    // The app clears an error it shows about the fields when one is typed
    // into. It hears of the first keystroke after the fields were last
    // submitted or marked invalid, and of none after that, for the same
    // reason `state` is only sent on a change.
    this.inputReported = new Set();
    this.lastHeight = -1;
    // Requests are made one at a time, in the order they were asked for, so
    // a form that asks again while one is in flight gets an answer to both.
    this.queue = Promise.resolve();
  }

  value(name) {
    return this.fields.get(name)?.value ?? '';
  }

  error(name) {
    return this.fields.get(name)?.error;
  }

  isComplete() {
    for (let entry of this.fields.values()) {
      if (!entry.value || entry.error) {
        return false;
      }
    }
    return true;
  }

  // Once the fields are drawn in the frame's own stylesheets, the app is
  // told which custom properties to send their values for.
  ready(customProperties) {
    this.send({ type: 'ready', properties: customProperties });
    this.sendState();
  }

  input(name, value) {
    let entry = this.fields.get(name);
    if (!entry) {
      return;
    }
    entry.value = String(value);
    entry.error = undefined;
    if (!this.inputReported.has(name)) {
      this.inputReported.add(name);
      this.send({ type: 'input', field: name });
    }
    this.sendState();
    this.onChange();
  }

  blur(name) {
    this.validate(name);
    this.sendState();
    this.onChange();
  }

  enter() {
    this.send({ type: 'submit-request' });
  }

  setError(name, message) {
    let entry = this.fields.get(name);
    if (entry) {
      entry.error = message || undefined;
    }
  }

  validate(name) {
    let entry = this.fields.get(name);
    if (!entry) {
      return;
    }
    if (entry.field.validate === 'new') {
      if (!entry.value) {
        this.setError(name, 'Password is missing');
      } else if (entry.value.length < MIN_PASSWORD_LENGTH) {
        this.setError(name, 'Password must be at least 8 characters long');
      }
    } else if (entry.field.validate === 'confirm') {
      if (entry.value !== this.value('password')) {
        this.setError(name, 'Passwords do not match');
      }
    }
  }

  sendState() {
    let filled = {};
    for (let [name, entry] of this.fields) {
      filled[name] = Boolean(entry.value);
    }
    let state = { type: 'state', filled, complete: this.isComplete() };
    let serialized = JSON.stringify(state);
    if (serialized !== this.lastState) {
      this.lastState = serialized;
      this.send(state);
    }
  }

  sendSize() {
    // Exact, not rounded: the page lays out around this height, and a
    // fraction of a pixel added here moves everything after the frame.
    let height = this.measure();
    if (height !== this.lastHeight) {
      this.lastHeight = height;
      this.send({ type: 'size', height });
    }
  }

  receive(event) {
    if (event.source !== this.parent || event.origin !== this.appOrigin) {
      return;
    }
    let message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    switch (message.type) {
      case 'style':
        this.narrow =
          String(message.properties?.['--credential-layout'] ?? '').trim() ===
          'narrow';
        this.applyStyle(message);
        this.onChange();
        // Measured once the layout the styles choose is drawn, so the app is
        // never sent the height of a layout part-way through changing.
        this.rendered().then(() => this.sendSize());
        break;
      case 'context': {
        let username = String(message.username ?? '');
        if (this.form.hiddenUsername) {
          this.hiddenUsername = username;
        }
        this.onChange();
        break;
      }
      case 'field-error':
        this.inputReported.delete(String(message.field));
        this.setError(String(message.field), message.message);
        this.sendState();
        this.onChange();
        break;
      // Checks every field as leaving it does, and answers once the app's
      // `state` is up to date. A field the user just left may not have been
      // reported yet when the app goes to act on its last `state`.
      case 'validate':
        for (let [name, entry] of this.fields) {
          if (entry.value && !entry.error) {
            this.validate(name);
          }
        }
        this.sendState();
        this.onChange();
        this.send({
          type: 'validated',
          id: message.id,
          complete: this.isComplete(),
        });
        break;
      case 'submit':
        this.perform(message.id, String(message.operation), message.args);
        break;
    }
  }

  // Resolves once the request is answered, for a caller that waits on it.
  perform(id, operation, args) {
    this.queue = this.queue.then(() => this.performNow(id, operation, args));
    return this.queue;
  }

  async performNow(id, operation, args) {
    this.inputReported.clear();
    if (
      !this.form.operations.includes(operation) ||
      !Object.hasOwn(OPERATIONS, operation) ||
      !this.isComplete()
    ) {
      this.send({
        type: 'result',
        id,
        ok: false,
        status: 0,
        body: { error: 'The form is not ready to submit.' },
      });
      return;
    }
    // Lets a password manager see the form go, as it would for the app's own
    // form; the submit event itself is cancelled by the form.
    this.requestSubmit();
    let result;
    try {
      result = await OPERATIONS[operation].call(this, args ?? {});
    } catch (e) {
      result = { ok: false, status: 0, body: { error: String(e?.message) } };
    }
    this.send({ type: 'result', id, ...this.redact(result) });
  }

  // An interactive-auth dict for the password stage carries the account's
  // current password, which is in a field here, never in the app's dict.
  withPassword(auth) {
    if (auth.type === 'm.login.password') {
      return { ...auth, password: this.value('current') };
    }
    return auth;
  }

  async matrixRequest(path, { body, accessToken }) {
    let headers = { 'Content-Type': 'application/json' };
    if (typeof accessToken === 'string' && accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    let response;
    try {
      response = await this.fetch(
        new URL(`${MATRIX_CLIENT_PREFIX}${path}`, this.matrixURL),
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

  redact(result) {
    let secrets = [...this.fields.values()]
      .filter((entry) => entry.field.type === 'password')
      .map((entry) => entry.value)
      .filter((secret) => secret.length >= MIN_REDACTED_LENGTH);
    return redactResponse(result, secrets);
  }
}

// Each request a form may make, by the name `FORMS` lists it under: its
// Matrix requests, with the passwords filled in from the fields and the parts
// that aren't secret taken from the app. Each is called on the form's
// `CredentialFrame`.
const OPERATIONS = {
  // Made by the realm server, which sets the password on the Matrix server and
  // then ends the account's secure sessions: a session signed in with the old
  // password, perhaps stolen, must not outlive the change. The Matrix server
  // always signs out the account's other devices, which is not the app's to
  // turn off.
  //
  // What the typed password authorizes is decided by the form, never by what
  // the app sends: a change with the app's `accessToken`, and the realm server
  // ends the sessions of the token's account once the Matrix server has
  // checked the current password from the field here.
  async 'set-password'({ accessToken }) {
    if (typeof accessToken !== 'string' || !accessToken) {
      return {
        ok: false,
        status: 0,
        body: { error: 'A password change needs the app’s access token.' },
      };
    }
    return await this.changePassword({
      newPassword: this.value('password'),
      accessToken,
      currentPassword: this.value('current'),
    });
  },

  async 'add-threepid'({ auth, accessToken, clientSecret, sid }) {
    return await this.matrixRequest('account/3pid/add', {
      accessToken,
      body: {
        auth: this.withPassword(plainObject(auth)),
        client_secret: String(clientSecret ?? ''),
        sid: String(sid ?? ''),
      },
    });
  },
};

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
}
