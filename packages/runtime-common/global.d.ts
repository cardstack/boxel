declare module 'ember-source/dist/ember-template-compiler' {
  export function precompile(
    templateString: string,
    options: Record<string, unknown>,
  ): string;
  export const _GlimmerSyntax: {
    getTemplateLocals: (template: string) => string[];
  };
}

declare module '@babel/plugin-transform-typescript' {
  import type * as Babel from '@babel/core';
  export default function makePlugin(babel: typeof Babel): Babel.PluginObj;
}

declare module 'marked-gfm-heading-id' {
  import type { MarkedExtension } from 'marked';
  export function gfmHeadingId(options?: {
    prefix?: string;
  }): MarkedExtension;
  export interface HeadingData {
    level: number;
    text: string;
    id: string;
  }
  export function getHeadingList(): HeadingData[];
  export function resetHeadings(): void;
}
