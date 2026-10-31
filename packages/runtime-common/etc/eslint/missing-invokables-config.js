/* eslint-disable no-undef */
'use strict';

const BOXEL_UI_HELPERS = '@cardstack/boxel-ui/helpers';
const PRETUI_HELPERS = '@cardstack/pretui/helpers';

// The truth and math helpers Pret UI publishes with boxel-ui's signatures.
const LOGIC_HELPERS = [
  'add',
  'and',
  'bool',
  'divide',
  'eq',
  'gt',
  'gte',
  'lt',
  'lte',
  'multiply',
  'not',
  'or',
  'subtract',
];

const COMMON_INVOKABLES = {
  array: ['array', '@ember/helper'],
  concat: ['concat', '@ember/helper'],
  enumOptions: ['enumOptions', '@cardstack/base/enum'],
  enumValues: ['enumValues', '@cardstack/base/enum'],
  fn: ['fn', '@ember/helper'],
  formatDateTime: ['formatDateTime', BOXEL_UI_HELPERS],
  get: ['get', '@ember/helper'],
  hash: ['hash', '@ember/helper'],
  on: ['on', '@ember/modifier'],
  substring: ['substring', BOXEL_UI_HELPERS],
};

function logicHelpersFrom(moduleName) {
  return Object.fromEntries(
    LOGIC_HELPERS.map((name) => [name, [name, moduleName]]),
  );
}

module.exports = {
  // Host and card code, which the realm lint engine lints through host's
  // config: the logic helpers come from Pret UI (ADR 009 §1.3).
  invokables: { ...COMMON_INVOKABLES, ...logicHelpersFrom(PRETUI_HELPERS) },
  // boxel-ui and boxel-icons can't import Pret UI, which builds on them, so
  // their autofix keeps to boxel-ui's own helpers.
  boxelUiInvokables: {
    ...COMMON_INVOKABLES,
    ...logicHelpersFrom(BOXEL_UI_HELPERS),
  },
};
