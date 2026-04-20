import { Rule } from 'ember-template-lint';

// data-test-* attributes are stripped from production builds by ember-test-selectors.
// Using them as CSS selectors (e.g. exceptSelector='[data-test-foo]', querySelector('[data-test-foo]'))
// works in tests but silently breaks in production.
export default class NoDataTestSelector extends Rule {
  visitor() {
    return {
      // Catches string literals in modifier/helper hash args:
      //   {{onClickOutside this.fn exceptSelector='[data-test-foo]'}}
      //   {{find-all '[data-test-foo]'}}
      StringLiteral(node) {
        if (/\[data-test-/.test(node.value)) {
          this.log({
            message:
              '`data-test-*` attributes are stripped in production builds. Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.',
            node,
          });
        }
      },

      // Catches string values in HTML attributes:
      //   <div data-selector='[data-test-foo]'>
      AttrNode(node) {
        if (
          node.value?.type === 'TextNode' &&
          /\[data-test-/.test(node.value.chars)
        ) {
          this.log({
            message:
              '`data-test-*` attributes are stripped in production builds. Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.',
            node: node.value,
          });
        }
      },
    };
  }
}
