## Pitfalls

### ATX headings must be on one line

`# Heading` requires the `#` and the text on the same line in the emitted string. Prettier will reformat a multi-line template and break this — protect it:

```gts
static markdown = class Markdown extends Component<typeof this> {
  <template>
    {{!-- prettier-ignore --}}
# {{markdownEscape @model.title}}
  </template>
};
```

### Multi-line text needs hard breaks

A single `\n` between lines collapses into a paragraph. For `TextAreaField`-style content, escape each line and join with CommonMark hard breaks (`  \n`):

```gts
get lines() {
  return (this.args.model ?? '')
    .split('\n')
    .map((line) => markdownEscape(line))
    .join('  \n');
}
```

### Fenced code blocks around arbitrary content

Use `fencedCodeBlock(content, lang)` rather than hand-rolling triple backticks — it widens the fence past any run of backticks inside `content` so the block can't be closed prematurely.

### FileDef code blocks: `static markdownLanguage`

Code-file FileDef subclasses (`TsFileDef`, `GtsFileDef`, `JsonFileDef`, `CsvFileDef`, `TextFileDef`) use a `static markdownLanguage` property to label the fence:

```gts
export class TsFileDef extends FileDef {
  static markdownLanguage = 'ts';
  // ...
  static markdown = class Markdown extends Component<typeof TsFileDef> {
    get text() {
      let content = this.args.model?.content;
      if (!content) return '';
      let ctor = this.args.model?.constructor as typeof TsFileDef | undefined;
      return fencedCodeBlock(
        content,
        ctor?.markdownLanguage ?? TsFileDef.markdownLanguage,
      );
    }
    <template>{{this.text}}</template>
  };
}
```

Override `markdownLanguage` in a subclass to change the language tag (e.g. `GtsFileDef` sets `'gts'`).

### Don't wrap in HTML

No `<div>`, no `<style>`, no `<article>` — the markdown format is text-only. The render container already supplies `white-space: pre`. HTML you emit will be captured as literal characters by `textContent` and pollute the output.

### Subclass overrides win

The format resolver uses bracket-notation lookup, so `static markdown` on a subclass overrides the inherited default (or a parent's explicit template) with no further ceremony.
