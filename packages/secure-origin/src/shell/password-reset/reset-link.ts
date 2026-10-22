import { type CliCallback, cliFrom } from '../cli-links.ts';
import { cliParams, modeURL } from '../urls.js';

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
// email address and the CLI's listener in the fragment.
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
  return new URL(`${modeURL('reset-password')}#${fragment}`, location.href)
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
  let fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  history.replaceState(null, '', modeURL('reset-password'));
  return {
    clientSecret: fragment.get('clientSecret') ?? '',
    sid: fragment.get('sid') ?? '',
    email: fragment.get('email') ?? '',
    cli: cliFrom(fragment).cli,
  };
}
