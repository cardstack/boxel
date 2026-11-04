import requireScopedStyle from './lib/require-scoped-style.mjs';
import noNestedScopedStyle from './lib/no-nested-scoped-style.mjs';
import noDataTestSelector from './lib/no-data-test-selector.mjs';
import noUnusedBlockParamsExceptUnderscore from './lib/no-unused-block-params-except-underscore.mjs';

export default {
  name: '@cardstack/template-lint',

  rules: {
    'require-scoped-style': requireScopedStyle,
    'no-nested-scoped-style': noNestedScopedStyle,
    'no-data-test-selector': noDataTestSelector,
    'no-unused-block-params-except-underscore':
      noUnusedBlockParamsExceptUnderscore,
  },

  configurations: {
    recommended: {
      extends: 'recommended',
      rules: {
        'require-scoped-style': true,
        'no-nested-scoped-style': true,
        'no-data-test-selector': true,

        // Replace core `no-unused-block-params` with an underscore-aware
        // variant so `|_i|`-style intentionally-unused params are allowed,
        // matching the `^_` convention we already use in TS/JS lint.
        'no-unused-block-params': false,
        'no-unused-block-params-except-underscore': true,

        // Only a <details> element's <summary> is its control, so controls in
        // the disclosure's open panel are not nested in it. Upstream counts
        // <details> itself as an interactive parent and reports them.
        // Ignoring <details> leaves the <summary> as the interactive parent,
        // so a control inside the <summary> is still reported, as is any
        // control nested in another interactive element. Two cases go
        // unreported: a <details> element itself inside another control (a
        // <summary> in it is still reported there), and a <summary> that is
        // not the first child of its <details>.
        'no-nested-interactive': { ignoredTags: ['details'] },

        'require-button-type': false,
        'no-negated-condition': false,

        // https://github.com/ember-template-lint/ember-template-lint/issues/2785
        'no-implicit-this': false,

        // We need this to be able to use <style scoped> tags in our components for scoped CSS
        // These are the defaults without `style`
        // https://github.com/ember-template-lint/ember-template-lint/blob/e1d3fd25fc1b8b250edd9bce11500f78721759c0/lib/rules/no-forbidden-elements.js#L9
        'no-forbidden-elements': ['meta', 'html', 'script'],
      },
      overrides: [
        {
          // Tests legitimately select on `data-test-*` (e.g. `find-all
          // '[data-test-foo]'`) — that's what the attribute is for — so the
          // guard against using it as a functional selector only applies to
          // non-test templates. Covers both `tests/` dirs and co-located
          // `*-test.*` / `*.test.*` files.
          files: [
            '**/tests/**',
            '**/*-test.{gjs,gts,hbs,js,ts}',
            '**/*.test.{gjs,gts,hbs,js,ts}',
          ],
          rules: {
            'no-data-test-selector': false,
          },
        },
      ],
    },
  },
};
