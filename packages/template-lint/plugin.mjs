import requireScopedStyle from './lib/require-scoped-style.mjs';

export default {
  name: '@cardstack/template-lint',

  rules: {
    'require-scoped-style': requireScopedStyle,
  },

  configurations: {
    recommended: {
      extends: 'recommended',
      rules: {
        'require-scoped-style': true,

        'require-button-type': false,
        'no-negated-condition': false,

        // https://github.com/ember-template-lint/ember-template-lint/issues/2785
        'no-implicit-this': false,

        // We need this to be able to use <style scoped> tags in our components for scoped CSS
        // These are the defaults without `style`
        // https://github.com/ember-template-lint/ember-template-lint/blob/e1d3fd25fc1b8b250edd9bce11500f78721759c0/lib/rules/no-forbidden-elements.js#L9
        'no-forbidden-elements': ['meta', 'html', 'script'],
      },
    },
  },
};
