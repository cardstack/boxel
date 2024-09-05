'use strict';

module.exports = {
  extends: ['recommended', '@cardstack/template-lint:recommended'],
  plugins: ['../../template-lint/plugin'],
  rules: {
    'no-pointer-down-event-binding': false,
    'no-positive-tabindex': false,
  },
};
