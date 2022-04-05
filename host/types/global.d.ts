import { TemplateFactory } from 'htmlbars-inline-precompile';
import Helper from '@glint/environment-ember-loose/ember-component/helper';
import '@glint/environment-ember-loose/registry';

// Types for compiled templates
declare module 'runtime-spike/templates/*' {
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare global {
  function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'page-title': new () => Helper<{
      PositionalArgs: [string];
      Return: string;
    }>;
  }
}
