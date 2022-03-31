import { modifier } from 'ember-modifier';
import '@cardstack/requirejs-monaco-ember-polyfill';
import * as monaco from 'monaco-editor';

export default modifier(
  function monacoModifier(element /*, positional, named*/) {
    monaco.editor.create(element, {
      value: ['function x() {', '\tconsole.log("Hello world!");', '}'].join(
        '\n'
      ),
      language: 'javascript',
    });
  },
  { eager: false }
);
