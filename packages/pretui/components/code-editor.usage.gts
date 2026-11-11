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

const LONG_SAMPLE = Array.from(
  { length: 40 },
  (_value, index) =>
    'export const step' + index + ' = { at: ' + index + ', ok: true };',
).join('\n');

class CodeEditorUsage extends Component {
  @tracked language = 'javascript';
  @tracked value = SAMPLES.javascript;
  @tracked readOnly = false;
  @tracked dark = false;
  @tracked lineNumbers = true;
  // The secondary examples keep their own text, so each one can be edited.
  @tracked readOnlyValue = SAMPLES.javascript;
  @tracked darkValue = SAMPLES.typescript;
  @tracked jsonValue = SAMPLES.json;
  @tracked longValue = LONG_SAMPLE;
  @tracked minLines = 3;
  @tracked maxLines = 12;

  languageOptions = LANGUAGES;

  setLanguage = (language: string) => {
    this.language = language;
    this.value = SAMPLES[language] ?? '';
  };
  setValue = (value: string) => (this.value = value);
  setReadOnly = (value: boolean) => (this.readOnly = value);
  setDark = (value: boolean) => (this.dark = value);
  setDarkValue = (value: string) => (this.darkValue = value);
  setJsonValue = (value: string) => (this.jsonValue = value);
  setLongValue = (value: string) => (this.longValue = value);
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
    if (this.dark) bits.push('@dark={{true}}');
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
              @dark={{this.dark}}
              @lineNumbers={{this.lineNumbers}}
              @minLines={{this.minLines}}
              @maxLines={{this.maxLines}}
              @controlId={{controlId}}
              @labelledBy={{labelId}}
              @describedBy={{describedBy}}
              @onInput={{this.setValue}}
            />
          </Field>

          <p class='pretui-codeeditor-cap'>Read-only</p>
          <CodeEditor
            @value={{this.readOnlyValue}}
            @language='javascript'
            @readOnly={{true}}
            @maxLines={{8}}
            @label='Read-only script'
          />
          <p class='pretui-codeeditor-note'>
            A muted surface and no current-line mark, so it doesn't pass for a
            field that takes typing.
          </p>

          <p class='pretui-codeeditor-cap'>Dark, in code mode's colours</p>
          <CodeEditor
            @value={{this.darkValue}}
            @language='typescript'
            @dark={{true}}
            @maxLines={{10}}
            @label='TypeScript in code mode colours'
            @onInput={{this.setDarkValue}}
          />

          <p class='pretui-codeeditor-cap'>JSON</p>
          <CodeEditor
            @value={{this.jsonValue}}
            @language='json'
            @maxLines={{8}}
            @label='JSON'
            @onInput={{this.setJsonValue}}
          />

          <p class='pretui-codeeditor-cap'>An editor past its ceiling</p>
          <CodeEditor
            @value={{this.longValue}}
            @language='typescript'
            @maxLines={{8}}
            @label='A long file'
            @onInput={{this.setLongValue}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @multiline={{true}}
          @monospace={{true}}
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
          @description='javascript, typescript, json or plain, or a file extension: js and gjs are javascript, ts and gts are typescript. A card definition reads as its script. Anything else is plain.'
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
          @name='dark'
          @value={{this.dark}}
          @defaultValue={{false}}
          @description="Code mode's colours: Monaco's dark theme on code mode's editor background, whatever the page's theme. Fixed colours, not tokens, so the editor matches code mode exactly. The read-only CodeBlock shown before the editor loads takes the same colours through its tokens."
          @onInput={{this.setDark}}
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
          @name='pretui-code-string'
          @type='color'
          @defaultValue='var(--chart-1)'
          @description='The hue for string literals, shared with CodeBlock, so code reads the same read or edited.'
        />
        <Css.Basic
          @name='pretui-code-keyword'
          @type='color'
          @defaultValue='var(--chart-4)'
          @description='The hue for keywords.'
        />
        <Css.Basic
          @name='pretui-code-name'
          @type='color'
          @defaultValue='var(--chart-2)'
          @description='The hue for type names, property names and definitions.'
        />
        <Css.Basic
          @name='pretui-code-number'
          @type='color'
          @defaultValue='var(--chart-3)'
          @description='The hue for numbers, booleans and null.'
        />
        <Css.Basic
          @name='pretui-code-comment'
          @type='color'
          @defaultValue='var(--muted-foreground)'
          @description="The hue for comments. Under @dark none of these apply: the editor takes code mode's colours."
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-codeeditor-demo {
        display: grid;
        gap: var(--boxel-sp-xs);
        max-width: 38.75rem;
      }
      .pretui-codeeditor-note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .pretui-codeeditor-cap {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-2xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_CODE_EDITOR: Record<string, unknown> = {
  CodeEditor: CodeEditorUsage,
};
