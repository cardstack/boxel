import { Rule } from 'ember-template-lint';

export default class RequireScopedStyle extends Rule {
  visitor() {
    return {
      ElementNode(node) {
        if (
          node.tag === 'style' &&
          !node.attributes.some((attr) => attr.name === 'scoped')
        ) {
          this.log({
            message: 'Style tags must have the "scoped" attribute',
            node,
          });
        }
      },
    };
  }
}
