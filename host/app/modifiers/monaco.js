import { modifier } from 'ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';

export default modifier(
  function monacoModifier(element /*, positional, named*/) {
    monaco.editor.create(element, {
      value: '',
      language: 'javascript',
    });
  },
  { eager: false }
);
