import { modifier } from '@glint/environment-ember-loose/ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';

export default modifier(function monacoModifier(element) {
  monaco.editor.create(element as HTMLElement, {
    value: '',
    language: 'javascript',
  });
});
