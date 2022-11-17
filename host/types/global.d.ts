import { TemplateFactory } from 'htmlbars-inline-precompile';
import Helper from '@ember/component/helper';
import '@glint/environment-ember-loose/registry';
import '@glint/environment-ember-loose/native-integration';
import { ComponentLike } from '@glint/template';

// Types for compiled templates
declare module '@cardstack/host/templates/*' {
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare global {
  function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

declare module '@ember/component' {
  export function setComponentTemplate(
    template: string,
    Component: ComponentLike
  ): void;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'page-title': new () => Helper<{
      Args: {
        Positional: [string];
      };
      Return: void;
    }>;
  }
}

// runtime-common has its own global type declaration that we need to
// incorporate
import '../../runtime-common/global';
