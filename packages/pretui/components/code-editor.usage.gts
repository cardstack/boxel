// Pretui — CodeEditor usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CodeEditor } from './code-editor';
import { Field } from './field';

const LANGUAGES = ['javascript', 'typescript', 'json', 'plain'];

/** Built by joining lines so no backtick-and-dollar template literal ever
 * appears in this module — one of those inside a `<template>` takes down the
 * parse for the whole realm. */
const SAMPLES: Record<string, string> = {
  javascript: [
    '// Counts the cards in this realm by type.',
    'const { cards } = await realm.cards.search({});',
    'const counts = new Map();',
    'for (const card of cards) {',
    "  const key = card.type.module + '#' + card.type.name;",
    '  counts.set(key, (counts.get(key) ?? 0) + 1);',
    '}',
    "console.log('types', counts.size);",
  ].join('\n'),
  typescript: [
    'interface Reading {',
    '  meter: string;',
    '  value: number;',
    '}',
    '',
    'export function total(readings: Reading[]): number {',
    '  return readings.reduce((sum, r) => sum + r.value, 0);',
    '}',
  ].join('\n'),
  json: [
    '{',
    '  "name": "@cardstack/pretui",',
    '  "sideEffects": false,',
    '  "lines": 1234',
    '}',
  ].join('\n'),
  plain: [
    'Plain text keeps its lines',
    'and its indentation,',
    '  untouched.',
  ].join('\n'),
};

class CodeEditorUsage extends Component {
  @tracked language = 'javascript';
  @tracked value = SAMPLES.javascript;
  @tracked readOnly = false;
  @tracked lineNumbers = true;
  @tracked minLines = 3;
  @tracked maxLines = 12;

  languageOptions = LANGUAGES;

  setLanguage = (language: string) => {
    this.language = language;
    this.value = SAMPLES[language] ?? '';
  };
  setValue = (value: string) => (this.value = value);
  setReadOnly = (value: boolean) => (this.readOnly = value);
  setLineNumbers = (value: boolean) => (this.lineNumbers = value);
  setMinLines = (value: number) => (this.minLines = value);
  setMaxLines = (value: number) => (this.maxLines = value);

  get lineCount(): string {
    let n = this.value.split('\n').length;
    return n === 1 ? '1 line' : n + ' lines';
  }

  get usage() {
    let bits = [
      '@value={{this.source}}',
      `@language='${this.language}'`,
      '@controlId={{controlId}}',
      '@labelledBy={{labelId}}',
      '@describedBy={{describedBy}}',
    ];
    if (this.readOnly) bits.push('@readOnly={{true}}');
    if (!this.lineNumbers) bits.push('@lineNumbers={{false}}');
    bits.push(`@maxLines={{${this.maxLines}}}`);
    bits.push('@onInput={{this.setSource}}');
    return `<Field @label='Script' @labelTag='span' as |controlId describedBy labelId|>\n  <CodeEditor ${bits.join(' ')} />\n</Field>`;
  }

  <template>
    <FreestyleUsage
      @name='CodeEditor'
      @description='Source code edited in CodeMirror, which the host loads on demand. Before it loads, and where it never does (a prerender), the same code shows read-only through CodeBlock.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-codeeditor-demo'>
          <Field
            @label='Script'
            @labelTag='span'
            @hint={{this.lineCount}}
            as |controlId describedBy labelId|
          >
            <CodeEditor
              @value={{this.value}}
              @language={{this.language}}
              @readOnly={{this.readOnly}}
              @lineNumbers={{this.lineNumbers}}
              @minLines={{this.minLines}}
              @maxLines={{this.maxLines}}
              @controlId={{controlId}}
              @labelledBy={{labelId}}
              @describedBy={{describedBy}}
              @onInput={{this.setValue}}
            />
          </Field>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @description='The source text. Passing back what onInput reported is an echo and leaves the document and caret alone; any other value replaces the document in the same editor.'
          @onInput={{this.setValue}}
        />
        <Args.Action
          @name='onInput'
          @description='Receives the whole text after every edit.'
        />
        <Args.String
          @name='language'
          @value={{this.language}}
          @options={{this.languageOptions}}
          @defaultValue='plain'
          @description='javascript, typescript, json or plain. Anything else is plain.'
          @onInput={{this.setLanguage}}
        />
        <Args.Bool
          @name='readOnly'
          @value={{this.readOnly}}
          @defaultValue={{false}}
          @description='The code can be read, selected and copied, but not changed. Announced through aria-readonly.'
          @onInput={{this.setReadOnly}}
        />
        <Args.Bool
          @name='lineNumbers'
          @value={{this.lineNumbers}}
          @defaultValue={{true}}
          @description='The line-number gutter.'
          @onInput={{this.setLineNumbers}}
        />
        <Args.Number
          @name='minLines'
          @value={{this.minLines}}
          @defaultValue={{3}}
          @min={{1}}
          @max={{40}}
          @description='Height floor, in lines.'
          @onInput={{this.setMinLines}}
        />
        <Args.Number
          @name='maxLines'
          @value={{this.maxLines}}
          @defaultValue={{24}}
          @min={{1}}
          @max={{200}}
          @description='Height ceiling, in lines. Past it the editor scrolls.'
          @onInput={{this.setMaxLines}}
        />
        <Args.Base
          @name='controlId'
          @description="An id for CodeMirror's editable element, so other elements can point at it. Supplied by the wrapping Field's yielded controlId."
        />
        <Args.Base
          @name='labelledBy'
          @description="The id of the element that names the editor, set as aria-labelledby. A label's for can't name CodeMirror's contenteditable, so wrap the editor in a Field with labelTag='span' and pass its yielded labelId."
        />
        <Args.Base
          @name='describedBy'
          @description="The id(s) of elements that describe the editor, set as aria-describedby: the Field's yielded message-line id, so its hint and errors are read with the editor."
        />
        <Args.Base
          @name='label'
          @typeLabel='String'
          @description='The accessible name, when no element on the page names the editor.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-code-size'
          @type='length'
          @defaultValue='var(--boxel-font-size-xs)'
          @description='Monospace size, shared with CodeBlock. The height floor and ceiling are computed from it and the leading.'
        />
        <Css.Basic
          @name='pretui-code-leading'
          @type='number'
          @defaultValue='1.6'
          @description='Line height, shared with CodeBlock.'
        />
        <Css.Basic
          @name='pretui-code-keyword'
          @type='color'
          @defaultValue='var(--chart-4)'
          @description='The hue for keywords. The string, number, comment and name hues are CodeBlock’s too, so code reads the same read or edited.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-codeeditor-demo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 620px;
      }
    </style>
  </template>
}

export const DEMOS_CODE_EDITOR: Record<string, unknown> = {
  CodeEditor: CodeEditorUsage,
};
