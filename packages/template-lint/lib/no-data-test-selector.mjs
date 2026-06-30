import { Rule } from 'ember-template-lint';

// data-test-* is a test-only hook, not a functional selector API. Host app
// builds strip these attributes in production (ember-test-selectors), so a
// selector like exceptSelector='[data-test-foo]' / find-all('[data-test-foo]')
// silently breaks there. Realm cards (compiled by runtime-common) do NOT strip
// them, but coupling styling/behavior to a test hook is still fragile —
// deleting a test selector would silently change production. Either way, use a
// plain data-* attribute for things you actually select on.
const MESSAGE =
  "Don't select on `data-test-*`: it's a test-only attribute (host builds strip it in production; card code keeps it but coupling to a test hook is fragile). Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.";

export default class NoDataTestSelector extends Rule {
  visitor() {
    return {
      // Catches string literals in modifier/helper hash args:
      //   {{onClickOutside this.fn exceptSelector='[data-test-foo]'}}
      //   {{find-all '[data-test-foo]'}}
      StringLiteral(node) {
        if (/\[data-test-/.test(node.value)) {
          this.log({
            message: MESSAGE,
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
            message: MESSAGE,
            node: node.value,
          });
        }
      },

      // Catches CSS selectors in `<style>` blocks:
      //   <style scoped>[data-test-foo] { color: red; }</style>
      // The style element's CSS is a plain TextNode child, not parsed as CSS,
      // so scan its raw text for `[data-test-`.
      ElementNode(node) {
        if (node.tag !== 'style') {
          return;
        }
        for (let child of node.children) {
          if (child.type === 'TextNode' && /\[data-test-/.test(child.chars)) {
            this.log({
              message: MESSAGE,
              node: child,
            });
          }
        }
      },
    };
  }
}
