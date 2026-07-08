'use strict';

// `no-restricted-syntax` selectors that flag `data-test-*` CSS/DOM selectors
// in app code. `data-test-*` is a test-only hook, not a functional selector
// API: host app builds strip these attributes in production (ember-test-
// selectors), and in realm-card code (compiled by runtime-common, which does
// NOT strip them) coupling styling or behavior to a test hook is fragile —
// deleting a test selector would silently change production. Either way, use a
// plain `data-*` attribute for things you actually select on.
//
// Shared by the root `.eslintrc.js` and by packages whose own config is
// `root: true` (e.g. `packages/host`, `packages/boxel-ui/addon`), which do not
// inherit the root config and so must re-declare these selectors themselves.
const DATA_TEST_MESSAGE =
  "Don't select on `data-test-*`: it's a test-only attribute (host builds strip it in production; card code keeps it but coupling to a test hook is fragile). Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.";

const DATA_TEST_SELECTORS = [
  {
    selector: 'Literal[value=/\\[data-test-/]',
    message: DATA_TEST_MESSAGE,
  },
  {
    selector: 'TemplateElement[value.raw=/\\[data-test-/]',
    message: DATA_TEST_MESSAGE,
  },
];

module.exports = { DATA_TEST_SELECTORS };
