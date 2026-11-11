## What it is

Source code you can edit: a CodeMirror editor with a language mode, line numbers, undo and the editing keys people expect from a code editor. Use it where a card lets someone write a script, a query or a snippet in place. To show code that is read and never edited, use **CodeBlock**. It is lighter, it copies, and it is what a prerender captures of this one anyway. For prose, use **Textarea**.

## The contract

```
@value?       — the source text
@onInput?     — fires with the whole text after every edit
@language?    — 'javascript' | 'typescript' | 'json' | 'plain' (default); anything else is plain
@readOnly?    — the code can be read, selected and copied, but not changed
@dark?        — code mode's colours: Monaco's dark theme, whatever the page's theme
@lineNumbers? — the gutter (default true)
@minLines?    — height floor, in lines (default 3)
@maxLines?    — height ceiling, in lines (default 24); past it the editor scrolls
@controlId?   — an id for the editable element, so other elements can point at it
@label?       — the accessible name, when no element on the page names the editor
@labelledBy?  — the id of the element that names the editor (a Field's label)
@describedBy? — the id(s) of elements that describe it (a Field's message line)
Element: HTMLDivElement
```

**CodeMirror is the host's, not this module's.** The component asks for it through `globalThis.__loadCodeMirror`, the loader the host sets for base's markdown editor, and calls the context's `createCodeEditorState`. A card that renders a CodeEditor ships no editor code, and the editor arrives in its own chunk the first time any page needs one.

**Until it arrives, the code is shown, not hidden.** Before CodeMirror loads, and wherever it doesn't (a prerender, which never loads it, a page with no loader, a host whose context has no code editor), the component renders the same text read-only through **CodeBlock**, with the same language and line numbers. A search result or a printed card shows the code, and the swap to the live editor doesn't move anything.

**An echo of your own typing is not a new value.** The editor reports every change the user makes through `@onInput`, and a caller usually stores it and passes it straight back as `@value`. The component remembers the last text it reported and ignores a `@value` that matches it, so the caller's round trip never resets the document or the caret. Any other `@value`, such as a save from somewhere else, replaces the document in the same editor, and that replacement is not reported back through `@onInput`: it is the caller's change, not the user's.

**Read-only looks read-only.** It sits on a muted surface with no current-line mark, so a reader doesn't take it for a field that takes typing, and it is announced through `aria-readonly`.

**`@dark` is code mode's editor.** It takes the colours code mode's Monaco editor uses, so a card that edits code beside code mode's editor can look like it: Monaco's `vs-dark` token colours, gutter, selection and cursor on the background code mode gives Monaco (`#413e4e`, and `#606060` when read-only). These are fixed colours, not theme tokens, because the point is to match that one editor rather than the page. Lezer's tags map onto Monaco's token kinds: keywords, booleans and `null` are Monaco's keyword blue, type and class names its type teal, and names Monaco leaves uncoloured stay the foreground. One difference remains: Monaco colours JSON keys light blue, while the JavaScript grammar that highlights JSON here sees quoted keys as strings.

**A change of language, read-only, dark, line numbers, id or naming rebuilds the editor, keeping its text.** Those are fixed when CodeMirror makes its state; rebuilding keeps what the user typed rather than reverting to `@value`. A new `@value` that arrives in the same render wins, as it would without the rebuild.

**Undo is the user's own edits.** A `@value` that replaces the document doesn't enter the undo history, so undo never brings back the text a save from elsewhere replaced.

**Tab moves focus.** The editor doesn't take Tab for indentation, so it is never a keyboard trap; indentation comes from Enter, which keeps the current line's indent.

## Prior art

**CodeMirror 6** is the editor. The wrapper's shape follows the kit's other text controls (**Input**, **Textarea**): a value in, the whole value out through `@onInput`, and ids the surrounding **Field** mints.

Where Pretui is better: the echo rule and the read-only fallback. Wrappers commonly reset the caret when the parent passes the typed value back, and commonly render nothing until the editor loads.

Where it is thinner: no autocompletion, linting, folding, search panel or diff view, and three languages. Monaco, in code mode, is the full IDE; this is the editor a card can carry.

## Accessibility

- **The editable element is CodeMirror's content element**, a `contenteditable` with `aria-multiline`. A `<label for>` can't name a `contenteditable`, so inside a **Field** use `@labelTag='span'` and pass the ids it yields: `@labelledBy` (the label's) and `@describedBy` (the message line's), which land on the content element as `aria-labelledby` and `aria-describedby`. The hint and any error are then read with the editor. Without a Field, `@label` is its `aria-label`.

```hbs
<Field
  @label='Script'
  @labelTag='span'
  @hint='Runs on every save'
  as |controlId describedBy labelId|
>
  <CodeEditor
    @value={{this.script}}
    @onInput={{this.setScript}}
    @language='javascript'
    @controlId={{controlId}}
    @labelledBy={{labelId}}
    @describedBy={{describedBy}}
  />
</Field>
```

Clicking a span label doesn't move focus; the editor takes focus from a click on the code or from Tab.

- **Read-only is announced and enforced.** The content element is not editable and carries `aria-readonly`, and the text can still be selected and copied.
- **Tab is never captured**, so a keyboard user always has a way out.
- **The gutter is not editable or selectable**, and the fallback's gutter is `aria-hidden`, as CodeBlock's is.
- **Focus is visible on the whole frame** (`:focus-within`, outlined in `--ring`), since CodeMirror's own focus outline is turned off.

## Theming

`--pretui-code-size` and `--pretui-code-leading` (type metrics, shared with CodeBlock; tabs are two columns wide), `--pretui-shadow-card`, and the syntax channel CodeBlock reads: `--pretui-code-keyword`, `--pretui-code-string`, `--pretui-code-number`, `--pretui-code-comment`, `--pretui-code-name`. Code reads the same whether it is being read or edited.

Under `@dark` none of the syntax tokens apply. The frame sets them, along with `--card`, `--foreground` and `--muted-foreground`, to code mode's colours, so the CodeBlock shown before the editor loads comes out close to the editor. It isn't exact, because CodeBlock blends each hue with the foreground.

The frame sits in `@layer PretComponent`. CodeMirror's own DOM is styled through an `EditorView.theme` the component hands the editor, because CodeMirror injects its base theme as unlayered CSS that a layered rule can't outrank; the theme's values are the same tokens. `--pretui-code-editor-min` and `--pretui-code-editor-max` (line counts) are set from `@minLines` and `@maxLines`.

CodeMirror injects its styles at run time, so this component doesn't run on the secure origin, whose Content Security Policy forbids that.
