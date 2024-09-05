import requireScopedStyle from './lib/require-scoped-style.mjs';

export default {
  name: '@cardstack/template-lint',

  rules: {
    'require-scoped-style': requireScopedStyle,
  },

  configurations: {
    recommended: {
      rules: {
        'require-scoped-style': true,
      },
    },
  },
};
