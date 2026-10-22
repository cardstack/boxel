/* eslint-env browser */
// Handing a session to the CLI waiting on a loopback port. The CLI names its
// listener with the `port` and `state` query parameters; this module decides
// whether those name a listener this page may hand a session to, and hands it
// over. Everything else about the CLI's sign-in is presentation.

const LOOPBACK_CALLBACK_PATH = '/callback';
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const LOOPBACK_CALLBACK = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/callback$/;

/** @typedef {{ url: string, state: string }} CliCallback */

// The CLI waiting for a session: the loopback port it listens on and the
// state value it expects back. Anything else is refused, so a page can only
// ever hand a session to a listener on this machine.
export function cliCallback(params) {
  let port = Number(params.get('port'));
  let state = params.get('state') ?? '';
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !STATE.test(state)
  ) {
    return undefined;
  }
  return {
    url: `http://127.0.0.1:${port}${LOOPBACK_CALLBACK_PATH}`,
    state,
  };
}

// What the CLI's listener is sent: the state it expects back, and the
// session.
export function handoffFields(callback, session) {
  return [
    ['state', callback.state],
    ['secure_session', session.token],
    ['user_id', session.user],
    ['expires_at', session.expiresAt],
  ];
}

// Hands a session to the CLI by posting it to the CLI's loopback listener, as
// a top-level navigation, so it leaves this window only for this machine. A
// navigation, not a `fetch`, is not subject to the private-network preflight
// a cross-origin request to a loopback address would need, and it keeps the
// session out of a URL. The target is checked here, where the session
// leaves, whatever it came from: a callback read back from storage after a
// Google sign-in is held to the same loopback address and state as one
// `cliCallback` read from the page's URL, and anything else is refused.
export function handToCli(callback, session, doc = document) {
  if (!isCliCallback(callback)) {
    throw new Error('The CLI sign-in names no listener on this machine.');
  }
  let form = doc.createElement('form');
  form.method = 'POST';
  form.action = callback.url;
  form.hidden = true;
  form.setAttribute('data-test-secure-cli-handoff', '');
  for (let [name, value] of handoffFields(callback, session)) {
    let input = doc.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  doc.body.append(form);
  form.submit();
  return form;
}

// Whether `callback` is a loopback listener and state `cliCallback` could
// have returned.
export function isCliCallback(callback) {
  let port = Number(
    LOOPBACK_CALLBACK.exec(String(callback?.url ?? ''))?.[1] ?? NaN,
  );
  return (
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    typeof callback.state === 'string' &&
    STATE.test(callback.state)
  );
}
