import { renderComponent } from '@ember/renderer';

import IncompleteCliLink from '../sign-in/incomplete-cli-link.gts';
import ForgotPassword from './forgot-password.gts';
import { cliFrom, signInURL } from '../cli-links.ts';
import { takeResetLink } from './reset-link.ts';
import ResetPassword from './reset-password.gts';

// The shell's `forgot-password` and `reset-password` modes.

export function forgotPasswordMode(root: Element) {
  let params = new URL(window.location.href).searchParams;
  let { cli, invalid } = cliFrom(params);
  if (invalid) {
    renderComponent(IncompleteCliLink, { into: root });
    return;
  }
  renderComponent(ForgotPassword, {
    into: root,
    args: { cli, signInURL: signInURL(cli, params.get('user')) },
  });
}

export function resetPasswordMode(root: Element) {
  renderComponent(ResetPassword, {
    into: root,
    args: { link: takeResetLink() },
  });
}
