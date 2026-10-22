import { renderComponent } from '@ember/renderer';

import { cliCallback } from '../../security/cli-handoff.js';
import IncompleteCliLink from '../sign-in/incomplete-cli-link.gts';
import { cliParams, modeURL } from '../urls.js';
import Register from './register.gts';
import VerifyEmail from './verify-email.gts';

// The shell's `register` and `verify-email` modes.

export function registerMode(root: Element) {
  let params = new URL(window.location.href).searchParams;
  let cli;
  if (params.has('port') || params.has('state')) {
    cli = cliCallback(params);
    if (!cli) {
      renderComponent(IncompleteCliLink, { into: root });
      return;
    }
  }
  let username = params.get('user') ?? '';
  renderComponent(Register, {
    into: root,
    args: {
      cli,
      username,
      signInURL: cli
        ? modeURL('cli-sign-in', cliParams(cli, username))
        : modeURL('sign-in'),
    },
  });
}

export function verifyEmailMode(root: Element) {
  renderComponent(VerifyEmail, { into: root });
}
