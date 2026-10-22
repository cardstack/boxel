import { type CliCallback, cliCallback } from '../security/cli-handoff.js';
import { cliParams, modeURL } from './urls.js';

// The CLI a page of the shell signs in for, as the `port` and `state` query
// or fragment parameters name it, and the sign-in page that carries it on.

// The CLI the parameters name: none when they name no CLI, and `invalid`
// when they name one incompletely, which a page refuses rather than signing
// in for the window instead.
export function cliFrom(params: URLSearchParams): {
  cli?: CliCallback;
  invalid?: true;
} {
  if (!params.has('port') && !params.has('state')) {
    return {};
  }
  let cli = cliCallback(params);
  return cli ? { cli } : { invalid: true };
}

// Where a page's "sign in" goes: the CLI's sign-in, for the same listener and
// suggested username, or else the window's own.
export function signInURL(cli?: CliCallback, username?: string | null) {
  return cli
    ? modeURL('cli-sign-in', cliParams(cli, username || undefined))
    : modeURL('sign-in');
}
