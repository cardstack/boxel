declare module 'ember-source/dist/ember-template-compiler' {
  export function precompile(
    templateString: string,
    options: Record<string, unknown>,
  ): string;
  export const _GlimmerSyntax: {
    getTemplateLocals: (template: string) => string[];
  };
}

declare module '@cardstack/ember-template-imports/src/babel-plugin' {
  import * as Babel from '@babel/core';
  export default function makePlugin(babel: typeof Babel): Babel.PluginObj;
}

declare module '@babel/plugin-proposal-decorators' {
  import * as Babel from '@babel/core';
  export default function makePlugin(babel: typeof Babel): Babel.PluginObj;
}

declare module '@babel/plugin-proposal-class-properties' {
  import * as Babel from '@babel/core';
  export default function makePlugin(babel: typeof Babel): Babel.PluginObj;
}

declare module '@babel/plugin-transform-typescript' {
  import * as Babel from '@babel/core';
  export default function makePlugin(babel: typeof Babel): Babel.PluginObj;
}
