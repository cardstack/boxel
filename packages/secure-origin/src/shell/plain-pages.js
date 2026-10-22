/* eslint-env browser */
// The pages a sign-in ends on, drawn with `dom.js` for the modes that are
// still plain modules (registration and password reset). The sign-in modes
// draw the same pages as components in `sign-in/`.

import { handToCli as postToCli } from '../security/cli-handoff.js';
import { h, renderPage, title } from './dom.js';

// A page that only says something: a title, and what follows it.
export function renderMessage(root, heading, ...content) {
  renderPage(
    root,
    h(
      'section',
      { class: 'message', 'data-test-secure-sign-in': true },
      title({}, heading),
      ...content,
    ),
  );
}

export function renderIncompleteCliLink(root) {
  renderMessage(
    root,
    'This sign-in link is not complete',
    h(
      'p',
      { class: 'info' },
      'Run the command in your terminal again to get a new link.',
    ),
  );
}

export function renderSignedIn(root) {
  renderMessage(
    root,
    'You’re signed in to Boxel',
    h(
      'p',
      { class: 'info', 'data-test-secure-signed-in': true },
      'You can close this window.',
    ),
  );
}

// Says the page is returning to the terminal, and hands the session to the
// CLI's listener (see `cli-handoff.js`).
export function handToCli(root, callback, session) {
  renderMessage(
    root,
    'Returning to your terminal…',
    h('p', { class: 'info' }, 'One moment.'),
  );
  postToCli(callback, session);
}
