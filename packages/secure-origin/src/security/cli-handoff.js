/* eslint-env browser */
// Handing a sign-in to the CLI waiting on a loopback port. The CLI names its
// listener with the `port` and `state` query parameters; this module decides
// whether those name a listener this page may hand a sign-in to, and hands it
// over. Everything else about the CLI's sign-in is presentation.
//
// The CLI signs in here for one of two things:
//
// - `boxel keys sign-in` (the `cli-sign-in` page) wants a secure session,
//   which it uses to change the user's keys.
// - `boxel profile add` (the `cli-auth` page) wants a Matrix device of its
//   own. It gets a single-use Matrix login token, which it redeems for one. A
//   CLI that says so (`session=secure`) also gets a secure session in the
//   same hand-off, so a new profile can manage keys without signing in again.
//
// `boxel keys connect` also waits here, for the end of a sign-in at a service
// through OAuth: the `connected` page hands it the service's one-use code and
// the sign-in's `state`, or why there is none, and the CLI finishes the
// sign-in with its own secure session. No session leaves this window for it.

const LOOPBACK_CALLBACK_PATH = '/callback';
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const LOOPBACK_CALLBACK = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/callback$/;

// The parameters a page of the shell names a profile sign-in with, beside
// `port` and `state`: `cli=profile`, and `session=secure` when the CLI takes
// a secure session too.
export const PROFILE_PARAM = 'cli';
export const PROFILE_VALUE = 'profile';
export const SECURE_SESSION_PARAM = 'session';
export const SECURE_SESSION_VALUE = 'secure';

/**
 * The CLI's listener and the state it expects back. `profile` is set for a
 * profile sign-in, which hands over a login token, with the secure session
 * too when `profile.secureSession` is true; without it, the CLI is handed a
 * secure session alone.
 * @typedef {{ url: string, state: string, profile?: { secureSession: boolean } }} CliCallback
 */

// The CLI waiting for a sign-in: the loopback port it listens on and the
// state value it expects back. Anything else is refused, so a page can only
// ever hand a sign-in to a listener on this machine. `profile` is true on the
// `cli-auth` page, which is a profile sign-in whatever else its address says;
// every other page reads it from `cli=profile`.
export function cliCallback(
  params,
  { profile = params.get(PROFILE_PARAM) === PROFILE_VALUE } = {},
) {
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
    ...(profile
      ? {
          profile: {
            secureSession:
              params.get(SECURE_SESSION_PARAM) === SECURE_SESSION_VALUE,
          },
        }
      : {}),
  };
}

/**
 * What a hand-off carries: a secure session, a login token, or both; or the
 * end of an OAuth sign-in the CLI started.
 * @typedef {{ code: string, state: string } | { error: string }} OAuthOutcome
 * @typedef {{ session?: import('./session.js').Session, loginToken?: string, oauth?: OAuthOutcome }} Handoff
 */

// What the CLI's listener is sent: the state it expects back, the login
// token for a profile sign-in, the secure session when the CLI takes one, and
// for an OAuth sign-in its code and state or the reason it ended without one.
/**
 * @param {CliCallback} callback
 * @param {Handoff} handoff
 */
export function handoffFields(callback, { session, loginToken, oauth }) {
  return [
    ['state', callback.state],
    ...(oauth
      ? 'error' in oauth
        ? [['oauth_error', oauth.error]]
        : [
            ['oauth_code', oauth.code],
            ['oauth_state', oauth.state],
          ]
      : []),
    ...(loginToken ? [['login_token', loginToken]] : []),
    ...(session
      ? [
          ['secure_session', session.token],
          ['user_id', session.user],
          ['expires_at', session.expiresAt],
        ]
      : []),
  ];
}

// Hands a sign-in to the CLI by posting it to the CLI's loopback listener, as
// a top-level navigation, so it leaves this window only for this machine. A
// navigation, not a `fetch`, is not subject to the private-network preflight
// a cross-origin request to a loopback address would need, and it keeps the
// session out of a URL. The target is checked here, where the sign-in
// leaves, whatever it came from: a callback read back from storage after a
// Google sign-in is held to the same loopback address and state as one
// `cliCallback` read from the page's URL, and anything else is refused.
//
// `handoff` is `{ session }` for `boxel keys sign-in`, and `{ loginToken,
// session? }` for a profile sign-in. A profile sign-in without a secure
// session is the one every `boxel` that opens `cli-auth` accepts, including
// those from before secure sessions: a navigation to the listener with the
// login token and state in its query, as Synapse's own single sign-on returns
// to it.
/**
 * @param {CliCallback} callback
 * @param {Handoff} handoff
 * @param {{ doc?: Document, navigate?: (url: string) => void }} [options]
 */
export function handToCli(
  callback,
  handoff,
  { doc = document, navigate = (url) => window.location.replace(url) } = {},
) {
  if (!isCliCallback(callback)) {
    throw new Error('The CLI sign-in names no listener on this machine.');
  }
  if (handoff.loginToken && !handoff.session) {
    let url = new URL(callback.url);
    url.searchParams.set('state', callback.state);
    url.searchParams.set('loginToken', handoff.loginToken);
    navigate(url.href);
    return undefined;
  }
  let form = doc.createElement('form');
  form.method = 'POST';
  form.action = callback.url;
  form.hidden = true;
  form.setAttribute('data-test-secure-cli-handoff', '');
  for (let [name, value] of handoffFields(callback, handoff)) {
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

// Hands a profile sign-in (`boxel profile add`) to the CLI: a single-use
// Matrix login token minted with the secure session just signed in, and that
// session too when the CLI takes one. A session the CLI won't hold is ended
// here, before the window leaves for the listener, and so is the session when
// no token could be minted for it: nothing else keeps it, so it would
// otherwise run out its week unused. `mintLoginToken` and `endSession` make
// the realm-server requests (`loginToken` and `endSession` in session.js).
/**
 * @param {CliCallback} callback A profile sign-in's (`callback.profile` set).
 * @param {import('./session.js').Session} session
 * @param {{
 *   mintLoginToken: (session: import('./session.js').Session) => Promise<string>,
 *   endSession: (session: import('./session.js').Session) => Promise<void>,
 *   doc?: Document,
 *   navigate?: (url: string) => void,
 * }} requests
 */
export async function handProfileSignIn(
  callback,
  session,
  { mintLoginToken, endSession, doc, navigate },
) {
  let loginToken;
  try {
    loginToken = await mintLoginToken(session);
  } catch (e) {
    await endSession(session).catch(() => {});
    throw e;
  }
  if (callback.profile?.secureSession) {
    return handToCli(callback, { loginToken, session }, { doc, navigate });
  }
  await endSession(session).catch(() => {});
  return handToCli(callback, { loginToken }, { doc, navigate });
}

// Whether `callback` is a loopback listener and state `cliCallback` could
// have returned.
export function isCliCallback(callback) {
  let port = Number(
    LOOPBACK_CALLBACK.exec(String(callback?.url ?? ''))?.[1] ?? NaN,
  );
  let { profile } = callback ?? {};
  return (
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    typeof callback.state === 'string' &&
    STATE.test(callback.state) &&
    (profile === undefined || typeof profile?.secureSession === 'boolean')
  );
}
