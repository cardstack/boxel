import { renderComponent } from '@ember/renderer';

import { cliFrom, signInURL } from '../cli-links.ts';
import IncompleteCliLink from '../sign-in/incomplete-cli-link.gts';
import Register from './register.gts';
import VerifyEmail from './verify-email.gts';

// The shell's `register` and `verify-email` modes.

export function registerMode(root: Element) {
  let params = new URL(window.location.href).searchParams;
  let { cli, invalid } = cliFrom(params);
  if (invalid) {
    renderComponent(IncompleteCliLink, { into: root });
    return;
  }
  let username = params.get('user') ?? '';
  renderComponent(Register, {
    into: root,
    args: { cli, username, signInURL: signInURL(cli, username) },
  });
}

export function verifyEmailMode(root: Element) {
  renderComponent(VerifyEmail, { into: root });
}
