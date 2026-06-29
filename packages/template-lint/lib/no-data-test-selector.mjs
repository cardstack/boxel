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
      // The style element's CSS is not parsed as CSS, so scan its raw text for
      // `[data-test-`. Concatenate the static text across all children first,
      // rather than testing each child alone: that way a selector split by a
      // comment or `{{! }}` between two TextNodes — or assembled inside a
      // ConcatStatement — is still caught. A fully dynamic body (e.g.
      // `{{this.css}}`) contributes no static text and can't be inspected here.
      ElementNode(node) {
        if (node.tag !== 'style') {
          return;
        }
        if (/\[data-test-/.test(collectStaticText(node.children))) {
          this.log({
            message: MESSAGE,
            node,
          });
        }
      },
    };
  }
}

// Gather the static (statically-known) text of a list of template nodes,
// descending into ConcatStatement parts. Dynamic nodes (MustacheStatement,
// etc.) contribute nothing since their value isn't known at lint time.
function collectStaticText(nodes) {
  let text = '';
  for (let child of nodes) {
    if (child.type === 'TextNode') {
      text += child.chars;
    } else if (child.type === 'ConcatStatement') {
      text += collectStaticText(child.parts);
    }
  }
  return text;
}
