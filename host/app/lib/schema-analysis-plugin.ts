import type * as Babel from '@babel/core';
import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';

export function schemaAnalysisPlugin(_babel: typeof Babel) {
  // let t = babel.types;
  return {
    visitor: {
      ExportDeclaration(node: NodePath<t.ExportDeclaration>) {
        console.log('saw a node', node);
      },
    },
  };
}
