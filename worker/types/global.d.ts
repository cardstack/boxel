declare module 'ember-source/dist/ember-template-compiler' {
  export function precompile(): unknown;
  export const _GlimmerSyntax: {
    getTemplateLocals(template: string): string[];
  };
}

declare module 'ember-template-imports/src/babel-plugin' {
  import { PluginItem } from '@babel/core';
  const plugin: PluginItem;
  export default plugin;
}
