// Pretui — CodeEditor: source code, edited in CodeMirror.
//
// CodeMirror is not a dependency of this module. The host loads it on demand
// and hands it over through `globalThis.__loadCodeMirror`, as base's markdown
// editor does, so a card that renders a CodeEditor ships no editor code of its
// own. Until CodeMirror arrives, and wherever it doesn't (a prerender, which
// never loads it, or a page with no loader), the code is shown read-only
// through CodeBlock, so the content is never blank.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { isDestroyed, isDestroying } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { modifier } from 'ember-modifier';
import { CodeBlock } from './code-block';
import { keepStyle, type KeptProperty } from '../internal/keep-style';

export type CodeEditorLanguage = 'javascript' | 'typescript' | 'json' | 'plain';

const LANGUAGES: readonly CodeEditorLanguage[] = [
  'javascript',
  'typescript',
  'json',
  'plain',
];

// Other names a caller may pass, often a file's extension. A card definition
// (`gts`, `gjs`) reads as its script language: the class, imports and fields
// highlight, and a `<template>` body gets the script grammar's approximation,
// as CodeBlock gives it.
// A Map, so a name like `constructor` finds nothing on a prototype.
const ALIASES = new Map<string, CodeEditorLanguage>([
  ['js', 'javascript'],
  ['gjs', 'javascript'],
  ['ts', 'typescript'],
  ['gts', 'typescript'],
]);

// CodeBlock's names for the same grammars, for the read-only fallback.
const FALLBACK_LANGUAGE: Record<CodeEditorLanguage, string | undefined> = {
  javascript: 'js',
  typescript: 'ts',
  json: 'json',
  plain: undefined,
};

// CodeMirror's DOM, styled from the theme's tokens. It reaches CodeMirror as
// an `EditorView.theme`, which outranks CodeMirror's own base theme: that one
// is injected unlayered, so rules in this module's cascade layer would lose to
// it. Tokens take CodeBlock's hues and the same ink derivation, so code reads
// the same whether it is being read or edited. The floor and ceiling are line
// COUNTS set on the component root; the line height is already in CSS, so the
// arithmetic stays here.
const ink = (hue: string, mix = '18%') =>
  `color-mix(in oklch, var(--foreground) ${mix}, ${hue})`;

const EDITOR_THEME: Record<string, Record<string, string>> = {
  '&': {
    minHeight:
      'calc(var(--pretui-code-editor-min, 3) * var(--pretui-code-leading, 1.6) * 1em + var(--boxel-sp-xs) * 2)',
    maxHeight:
      'calc(var(--pretui-code-editor-max, 24) * var(--pretui-code-leading, 1.6) * 1em + var(--boxel-sp-xs) * 2)',
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'auto',
  },
  '.cm-content': {
    paddingBlock: 'var(--boxel-sp-xs)',
    caretColor: 'var(--foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 60%, var(--card))',
    color: 'var(--muted-foreground)',
    borderInlineEnd: 'none',
    userSelect: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 6%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'color-mix(in oklch, var(--primary) 22%, transparent)',
    },
  '.cm-cursor, .cm-dropCursor': { borderInlineStartColor: 'var(--foreground)' },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 16%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 40%, transparent)',
  },
  '.tok-comment': {
    color: ink('var(--pretui-code-comment, var(--muted-foreground))', '8%'),
    fontStyle: 'italic',
  },
  '.tok-string, .tok-string2': {
    color: ink('var(--pretui-code-string, var(--chart-1))'),
  },
  '.tok-number, .tok-bool, .tok-atom': {
    color: ink('var(--pretui-code-number, var(--chart-3))'),
  },
  '.tok-keyword': {
    color: ink('var(--pretui-code-keyword, var(--chart-4))'),
    fontWeight: '500',
  },
  '.tok-typeName, .tok-propertyName, .tok-definition': {
    color: ink('var(--pretui-code-name, var(--chart-2))'),
  },
  '.tok-punctuation, .tok-operator': {
    color:
      'color-mix(in oklch, var(--muted-foreground) 70%, var(--foreground))',
  },
};

// Read-only code has no active line to mark, and its gutter sits on the
// muted surface the root gives read-only code.
const READ_ONLY_THEME: Record<string, Record<string, string>> = {
  ...EDITOR_THEME,
  '.cm-gutters': {
    ...EDITOR_THEME['.cm-gutters'],
    backgroundColor: 'transparent',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
};

// `@dark`: the colours of code mode's editor, Monaco's `vs-dark` theme on the
// background code mode gives it. The values are set once, as the
// `--pretui-code-editor-*` properties in the component's stylesheet, and the
// CodeMirror theme reads them, so the editor and its fallback can't drift.
const darkColour = (name: string) => `var(--pretui-code-editor-${name})`;

const DARK_THEME: Record<string, Record<string, string>> = {
  '&': EDITOR_THEME['&'],
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': EDITOR_THEME['.cm-scroller'],
  '.cm-content': {
    paddingBlock: 'var(--boxel-sp-xs)',
    caretColor: darkColour('cursor'),
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: darkColour('line-number'),
    borderInlineEnd: 'none',
    userSelect: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: darkColour('active-line-number'),
  },
  // Monaco marks the current line with a border, not a fill.
  '.cm-activeLine': {
    backgroundColor: 'transparent',
    boxShadow: `inset 0 0 0 2px ${darkColour('active-line-border')}`,
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: darkColour('selection') },
  '.cm-cursor, .cm-dropCursor': { borderInlineStartColor: darkColour('cursor') },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: darkColour('bracket-match'),
    outline: `1px solid ${darkColour('bracket-match-border')}`,
  },
  '.tok-comment': { color: 'var(--pretui-code-comment)' },
  '.tok-string': { color: 'var(--pretui-code-string)' },
  '.tok-number': { color: 'var(--pretui-code-number)' },
  '.tok-keyword, .tok-bool, .tok-atom, .tok-literal': {
    color: 'var(--pretui-code-keyword)',
  },
  '.tok-typeName, .tok-className': { color: 'var(--pretui-code-name)' },
  '.tok-punctuation, .tok-operator': { color: darkColour('delimiter') },
};

const DARK_READ_ONLY_THEME: Record<string, Record<string, string>> = {
  ...DARK_THEME,
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: darkColour('line-number'),
  },
};

function editorTheme(dark: boolean, readOnly: boolean) {
  if (dark) {
    return readOnly ? DARK_READ_ONLY_THEME : DARK_THEME;
  }
  return readOnly ? READ_ONLY_THEME : EDITOR_THEME;
}

const DEFAULT_MIN_LINES = 3;
const DEFAULT_MAX_LINES = 24;

// The parts of the host's CodeMirror context this component reads. Kept
// structural so this module imports nothing from the host.
interface EditorViewLike {
  readonly dom: HTMLElement;
  readonly state: { readonly doc: { toString(): string; length: number } };
  dispatch(spec: {
    changes: { from: number; to: number; insert: string };
    annotations?: unknown;
  }): void;
  destroy(): void;
}

interface CodeMirrorLike {
  EditorView: new (config: {
    state: unknown;
    parent: Element;
  }) => EditorViewLike;
  Transaction: { addToHistory: { of(value: boolean): unknown } };
  createCodeEditorState(options: {
    doc: string;
    language?: CodeEditorLanguage;
    readOnly?: boolean;
    lineNumbers?: boolean;
    controlId?: string;
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    theme?: Record<string, Record<string, string>>;
    dark?: boolean;
    onDocChange?: (text: string) => void;
  }): unknown;
}

export interface CodeEditorSignature {
  Args: {
    /** the source text */
    value?: string;
    /** fires with the whole text after every edit */
    onInput?: (value: string) => void;
    /** 'javascript' | 'typescript' | 'json' | 'plain' (default), or an
     * alias: js, gjs, ts, gts; anything else is plain */
    language?: CodeEditorLanguage | string;
    /** shows the code and lets it be selected, but not changed */
    readOnly?: boolean;
    /** code mode's colours: Monaco's dark theme, whatever the page's theme */
    dark?: boolean;
    /** the line-number gutter (default true) */
    lineNumbers?: boolean;
    /** height floor, in lines (default 3) */
    minLines?: number;
    /** height ceiling, in lines; past it the editor scrolls (default 24) */
    maxLines?: number;
    /** an id for the editable element, so other elements can point at it */
    controlId?: string;
    /** the accessible name, when no element on the page names the editor */
    label?: string;
    /** the id of the element that names the editor: a Field's label, with
     * `@labelTag='span'`, since a `<label for>` can't name CodeMirror's
     * editable element */
    labelledBy?: string;
    /** the id(s) of elements that describe the editor, such as a Field's
     * message line */
    describedBy?: string;
  };
  Element: HTMLDivElement;
}

function lineCount(value: number | undefined, fallback: number): string {
  return String(
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : fallback,
  );
}

export class CodeEditor extends Component<CodeEditorSignature> {
  @tracked private cm: CodeMirrorLike | null = null;
  private view: EditorViewLike | null = null;
  // The editor's configuration when its view was made; a change rebuilds it.
  private viewConfig: string | undefined;
  // The text this editor last reported through @onInput. When the caller
  // passes it back as @value, that is an echo of the user's own typing, not a
  // new value, and the document is left alone.
  private lastReported: string | undefined;
  // True while the component itself replaces the document with an outside
  // @value. That change is not the user's, so it is not reported: reporting
  // it would also write the caller's state in the middle of a render.
  private applyingValue = false;
  // The @value this editor last took in. A different one is a new value from
  // outside; the same one, passed again, is not.
  private seenValue: string | undefined;

  constructor(owner: Owner, args: CodeEditorSignature['Args']) {
    super(owner, args);
    this.loadCodeMirror();
  }

  private async loadCodeMirror() {
    let load = (globalThis as { __loadCodeMirror?: () => Promise<unknown> })
      .__loadCodeMirror;
    // A prerender captures the read-only fallback rather than racing the
    // editor's load.
    if (
      typeof load !== 'function' ||
      (globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext
    ) {
      return;
    }
    try {
      let cm = (await load()) as Partial<CodeMirrorLike> | undefined;
      if (isDestroying(this) || isDestroyed(this)) {
        return;
      }
      if (
        typeof cm?.createCodeEditorState === 'function' &&
        typeof cm.EditorView === 'function' &&
        cm.Transaction
      ) {
        this.cm = cm as CodeMirrorLike;
      }
    } catch {
      // The read-only fallback stays.
    }
  }

  get language(): CodeEditorLanguage {
    let language = this.args.language;
    if (LANGUAGES.includes(language as CodeEditorLanguage)) {
      return language as CodeEditorLanguage;
    }
    return (language && ALIASES.get(language)) || 'plain';
  }

  get fallbackLanguage(): string | undefined {
    return FALLBACK_LANGUAGE[this.language];
  }

  get lineNumbers(): boolean {
    return this.args.lineNumbers ?? true;
  }

  get maxLines(): number {
    return Number(lineCount(this.args.maxLines, DEFAULT_MAX_LINES));
  }

  get keptStyle(): KeptProperty[] {
    return [
      {
        property: '--pretui-code-editor-min',
        value: lineCount(this.args.minLines, DEFAULT_MIN_LINES),
        strength: 'arg',
      },
      {
        property: '--pretui-code-editor-max',
        value: lineCount(this.args.maxLines, DEFAULT_MAX_LINES),
        strength: 'arg',
      },
    ];
  }

  private mountEditor = modifier((element: HTMLElement) => {
    let cm = this.cm;
    if (!cm) {
      return;
    }
    let value = this.args.value ?? '';
    let readOnly = Boolean(this.args.readOnly);
    let dark = Boolean(this.args.dark);
    let config = JSON.stringify([
      this.language,
      readOnly,
      dark,
      this.lineNumbers,
      this.args.controlId ?? '',
      this.args.label ?? '',
      this.args.labelledBy ?? '',
      this.args.describedBy ?? '',
    ]);
    // A value the caller hasn't passed before, and that isn't the caller
    // handing back what was typed, replaces the document.
    let outsideValue =
      value !== this.seenValue && value !== this.lastReported;
    this.seenValue = value;

    let view = this.view;
    if (view && element.contains(view.dom) && this.viewConfig === config) {
      let current = view.state.doc.toString();
      if (outsideValue && value !== current) {
        this.applyingValue = true;
        try {
          // Not the user's edit, so undo doesn't bring back what it replaced.
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
            annotations: cm.Transaction.addToHistory.of(false),
          });
        } finally {
          this.applyingValue = false;
        }
        this.lastReported = value;
      }
      return;
    }

    // A rebuilt view keeps what the user has typed, unless a new value
    // arrived along with the change that rebuilds it.
    let doc = view && !outsideValue ? view.state.doc.toString() : value;
    view?.destroy();
    element.replaceChildren();
    let state = cm.createCodeEditorState({
      doc,
      language: this.language,
      readOnly,
      lineNumbers: this.lineNumbers,
      controlId: this.args.controlId,
      label: this.args.label,
      labelledBy: this.args.labelledBy,
      describedBy: this.args.describedBy,
      theme: editorTheme(dark, readOnly),
      dark,
      onDocChange: (text: string) => {
        if (isDestroying(this) || isDestroyed(this) || this.applyingValue) {
          return;
        }
        this.lastReported = text;
        this.args.onInput?.(text);
      },
    });
    this.view = new cm.EditorView({ state, parent: element });
    this.viewConfig = config;
  });

  willDestroy() {
    super.willDestroy();
    this.view?.destroy();
    this.view = null;
  }

  <template>
    <div
      class='pretui-code-editor'
      data-language={{this.language}}
      data-read-only={{if @readOnly 'true' 'false'}}
      data-dark={{if @dark 'true' 'false'}}
      data-loaded={{if this.cm 'true' 'false'}}
      {{keepStyle this.keptStyle}}
      data-test-pretui-code-editor
      ...attributes
    >
      {{#if this.cm}}
        <div
          class='pretui-code-editor-host'
          {{this.mountEditor}}
          data-test-pretui-code-editor-host
        ></div>
      {{else}}
        <CodeBlock
          class='pretui-code-editor-fallback'
          @code={{@value}}
          @language={{this.fallbackLanguage}}
          @lineNumbers={{this.lineNumbers}}
          @maxLines={{this.maxLines}}
          @noCopy={{true}}
          @label={{@label}}
          @density='compact'
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* The frame matches CodeBlock's: one depth token, no border for
           separation. CodeMirror's own DOM is styled by EDITOR_THEME above. */
        .pretui-code-editor {
          display: grid;
          border-radius: var(--boxel-border-radius);
          background-color: var(--card);
          color: var(--card-foreground);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
          overflow: hidden;
          font-family: var(--font-mono);
          font-size: var(--pretui-code-size, var(--boxel-font-size-xs));
          line-height: var(--pretui-code-leading, 1.6);
          font-variant-numeric: tabular-nums;
        }
        .pretui-code-editor:focus-within {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* Read-only code sits on a muted surface, so it doesn't pass for a
           field that takes typing. */
        .pretui-code-editor[data-read-only='true'] {
          background-color: color-mix(in oklch, var(--muted) 70%, var(--card));
        }
        /* Code mode's colours: Monaco's vs-dark on code mode's editor
           background. These are the only definitions of them; the dark
           CodeMirror theme reads the same properties. */
        .pretui-code-editor[data-dark='true'] {
          --pretui-code-editor-bg: #413e4e;
          --pretui-code-editor-fg: #d4d4d4;
          --pretui-code-editor-line-number: #858585;
          --pretui-code-editor-active-line-number: #c6c6c6;
          --pretui-code-editor-active-line-border: #282828;
          --pretui-code-editor-selection: #264f78;
          --pretui-code-editor-cursor: #aeafad;
          --pretui-code-editor-bracket-match: #0064001a;
          --pretui-code-editor-bracket-match-border: #888888;
          --pretui-code-editor-delimiter: #dcdcdc;
          --pretui-code-comment: #608b4e;
          --pretui-code-string: #ce9178;
          --pretui-code-number: #b5cea8;
          --pretui-code-keyword: #569cd6;
          --pretui-code-name: #3dc9b0;
          background-color: var(--pretui-code-editor-bg);
          color: var(--pretui-code-editor-fg);
          color-scheme: dark;
        }
        .pretui-code-editor[data-dark='true'][data-read-only='true'] {
          --pretui-code-editor-bg: #606060;
        }
        /* The CodeBlock shown before the editor loads reads the theme's
           tokens, so they are pointed at code mode's colours on it alone,
           close to the editor it stands in for. */
        .pretui-code-editor[data-dark='true'] .pretui-code-editor-fallback {
          --card: var(--pretui-code-editor-bg);
          --card-foreground: var(--pretui-code-editor-fg);
          --foreground: var(--pretui-code-editor-fg);
          --muted-foreground: var(--pretui-code-editor-line-number);
        }
        .pretui-code-editor .pretui-code-editor-fallback {
          background-color: transparent;
          box-shadow: none;
          border-radius: 0;
        }
      }
    </style>
  </template>
}
