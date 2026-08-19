import { Rule } from 'ember-template-lint';

// A drop-in replacement for ember-template-lint's core `no-unused-block-params`
// that honors the leading-underscore convention: a block param named `_` or
// `_foo` is treated as intentionally unused and is NOT reported. This mirrors
// `@typescript-eslint/no-unused-vars` (`argsIgnorePattern: '^_'`), so authors
// can express "this positional param exists only to reach a later one, or to
// iterate a fixed number of times" the same way in templates as in TS.
//
// Example the core rule rejects but this one allows:
//
//   {{#each (array 0 1 2) as |_i|}}
//     <div class="dot"></div>   {{! render 3 dots; index intentionally unused }}
//   {{/each}}
//
// The core rule only ever reports the *trailing* unused block param (see
// Frame#unusedLocals), and this rule preserves that behavior exactly — it just
// suppresses the finding when that trailing param is underscore-prefixed.

export default class NoUnusedBlockParamsExceptUnderscore extends Rule {
  checkUnused(node) {
    let unusedLocal = this.scope.frameHasUnusedBlockParams();
    if (unusedLocal && !unusedLocal.startsWith('_')) {
      this.log({
        message: `'${unusedLocal}' is defined but never used`,
        node,
      });
    }
  }

  visitor() {
    return {
      Block: {
        exit(node) {
          this.checkUnused(node);
        },
      },

      ElementNode: {
        keys: {
          children: {
            exit(node) {
              this.checkUnused(node);
            },
          },
        },
      },

      MustacheStatement(node) {
        if (node.path.original === 'partial') {
          this.scope.usePartial();
        }
      },
    };
  }
}
