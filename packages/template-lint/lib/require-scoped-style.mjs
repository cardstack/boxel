import { Rule } from 'ember-template-lint';
import { builders } from 'ember-template-recast';

export default class RequireScopedStyle extends Rule {
  visitor() {
    return {
      ElementNode(node) {
        if (
          node.tag === 'style' &&
          !node.attributes.some((attr) => attr.name === 'scoped')
        ) {
          if (this.mode === 'fix') {
            node.attributes.push(builders.attr('scoped', builders.text('')));
          } else {
            this.log({
              message: 'Style tags must have the "scoped" attribute',
              node,
              isFixable: true,
            });
          }
        }
      },
    };
  }
}
