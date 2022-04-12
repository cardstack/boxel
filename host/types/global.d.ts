import { TemplateFactory } from 'htmlbars-inline-precompile';
import Helper from '@glint/environment-ember-loose/ember-component/helper';
import '@glint/environment-ember-loose/registry';
import GlimmerComponent from '@glimmer/component';

// Types for compiled templates
declare module 'runtime-spike/templates/*' {
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare global {
  function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

declare module '@ember/component' {
  export function setComponentTemplate(
    template: string,
    Component: typeof GlimmerComponent
  ): void;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'page-title': new () => Helper<{
      PositionalArgs: [string];
      Return: void;
    }>;
  }
}
