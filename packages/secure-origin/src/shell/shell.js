/* eslint-env browser */
// The only script the secure origin's shell serves. It loads no card, realm or
// host app code. A mode takes only plain values from its own URL, such as a
// username to fill in, and never hands anything to the page that opened it.
//
// Each mode the page can present is one entry in `modes`, keyed by the `mode`
// query parameter and given the page's root element to render into. A request
// naming no known mode leaves the page empty. The address Google returns to
// after a sign-in is a mode of its own.
import '../styles/layers.css';
import { renderComponent } from '@ember/renderer';

import CliAuthPage from './sign-in/cli-auth-page.gts';
import CliSignInPage from './sign-in/cli-sign-in-page.gts';
import GoogleCallback from './sign-in/google-callback.gts';
import SignInPage from './sign-in/sign-in-page.gts';
import SignOutPage from './sign-in/sign-out-page.gts';
import { registerMode, verifyEmailMode } from './register/modes.ts';
import {
  forgotPasswordMode,
  resetPasswordMode,
} from './password-reset/modes.ts';
import { isGoogleCallback } from './urls.js';

// A mode drawn by a component.
function component(page) {
  return (root) => renderComponent(page, { into: root });
}

const modes = {
  'sign-in': component(SignInPage),
  'cli-sign-in': component(CliSignInPage),
  'cli-auth': component(CliAuthPage),
  'sign-out': component(SignOutPage),
  register: registerMode,
  'verify-email': verifyEmailMode,
  'forgot-password': forgotPasswordMode,
  'reset-password': resetPasswordMode,
};

let root = document.getElementById('secure-shell');
let mode = new URL(window.location.href).searchParams.get('mode');
if (root && isGoogleCallback()) {
  component(GoogleCallback)(root);
} else if (root && mode && Object.hasOwn(modes, mode)) {
  modes[mode](root);
}
