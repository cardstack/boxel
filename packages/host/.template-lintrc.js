'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    'require-button-type': false,
    'no-negated-condition': false,
    'no-pointer-down-event-binding': false,

    // https://github.com/ember-template-lint/ember-template-lint/issues/2785
    'no-implicit-this': false,

    // We need this to be able to use <style> tags in our components for scoped CSS
    'no-forbidden-elements': ['meta', 'html', 'script'],
  },
};
