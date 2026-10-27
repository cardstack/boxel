import type { CliCallback } from '../../security/cli-handoff.js';
import { cliFrom } from '../cli-links.ts';
import { cliParams, pageURL } from '../urls.js';

// The link a password reset email carries, and reading it where it lands.
//
// The validation session's client secret, which with the session id is what
// lets a new password be set, travels in the link's fragment, never its query
// string: a fragment never leaves the browser, while a load balancer's access
// log records every query string. The Matrix server adds the session id to the
// end of the link, so it lands in the fragment too.
//
// The link also carries the email address the reset was asked for, so that
// once the new password is set the page can name the account to the realm
// server, which ends every secure session it has, and the CLI listener the
// reset began from, if any, so that signing in afterwards hands it the
// session.

// Where the reset link lands: `reset-password`, with the client secret, the
// email address and the CLI's listener in the fragment. The Matrix server
// adds the session id with `&sid=` to a link that has a query string and
// with `?sid=` to one that hasn't, so the link carries an empty query (`?`)
// to make it `&sid=`, one more fragment parameter.
export function resetLink(
  clientSecret: string,
  email: string,
  cli?: CliCallback,
): string {
  let fragment = new URLSearchParams({ clientSecret, email });
  for (let [name, value] of Object.entries(cliParams(cli))) {
    if (value) {
      fragment.set(name, String(value));
    }
  }
  return new URL(`${pageURL('reset-password')}?#${fragment}`, location.href)
    .href;
}

export interface ResetLink {
  clientSecret: string;
  sid: string;
  email: string;
  cli?: CliCallback;
}

// Reads the reset link from the page's address, and takes it out of the
// address bar and the history: the secret has done its job once it is read.
export function takeResetLink(): ResetLink {
  // A link sent without its empty query has the session id after a `?` in
  // the fragment; every `?` in a value is percent-encoded, so a literal one
  // only ever separates the Matrix server's addition.
  let fragment = new URLSearchParams(
    location.hash.replace(/^#/, '').replace('?', '&'),
  );
  history.replaceState(null, '', pageURL('reset-password'));
  return {
    clientSecret: fragment.get('clientSecret') ?? '',
    sid: fragment.get('sid') ?? '',
    email: fragment.get('email') ?? '',
    cli: cliFrom(fragment).cli,
  };
}
