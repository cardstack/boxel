/* eslint-env browser */
// Handing a session to the CLI waiting on a loopback port. The CLI names its
// listener with the `port` and `state` query parameters; this module decides
// whether those name a listener this page may hand a session to, and hands it
// over. Everything else about the CLI's sign-in is presentation.

const LOOPBACK_CALLBACK_PATH = '/callback';

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
    !/^[A-Za-z0-9_-]{16,128}$/.test(state)
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
// session out of a URL. `callback` is only ever one `cliCallback` returned.
export function handToCli(callback, session, doc = document) {
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
