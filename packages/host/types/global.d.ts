import { TemplateFactory } from 'htmlbars-inline-precompile';
import Helper from '@ember/component/helper';
import '@glint/environment-ember-loose/registry';
import '@glint/environment-ember-loose/native-integration';
import { ComponentLike } from '@glint/template';
import 'ember-freestyle/glint';

// Types for compiled templates
declare module '@cardstack/host/templates/*' {
  const tmpl: TemplateFactory;
  export default tmpl;
}

declare global {
  function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  interface Window {
    test__refreshOverlayedButtons: () => void;
  }
}

declare module '@ember/component' {
  export function setComponentTemplate(
    template: string,
    Component: ComponentLike,
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
    'on-key': new () => Helper<{
      Args: {
        Positional: [keyCombo: string, callback: () => void];
      };
      Return: void;
    }>;
  }
}

// runtime-common has its own global type declaration that we need to
// incorporate
import '../../runtime-common/global';
