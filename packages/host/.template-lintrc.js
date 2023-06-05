'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    'require-button-type': false,
    'no-negated-condition': false,

    // https://github.com/ember-template-lint/ember-template-lint/issues/2785
    'no-implicit-this': false,
  },
};
