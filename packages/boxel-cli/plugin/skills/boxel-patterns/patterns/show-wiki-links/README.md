---
validated: source-proven
---

# show-wiki-links — Clickable `[[WikiLink]]` syntax in MarkdownField content

**What this gives you:** A wiki-style article card where `[[Page Name]]` text in markdown becomes clickable navigation to another Boxel card.

**When to use:** Knowledge bases, documentation realms, product specs, RPG/worldbuilding notes, research notebooks, internal docs, and any card family where article content should link to sibling cards without manually embedding cards.

**The insight:** Render markdown normally with `<@fields.content />`, then attach an `ember-modifier` to the rendered article. The modifier post-processes safe rendered HTML, replacing `[[Name]]` markers with anchors. A single delegated click handler on the article resolves the anchor against `relatedPages = linksToMany(() => WikiPage)` and calls `viewCard`.

**Recipe shape:**

```ts
const processWikiLinks = modifier((element: HTMLElement) => {
  element.innerHTML = element.innerHTML.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, name) =>
      `<a class="wiki-link" data-wiki-slug="${slugify(name)}">${name}</a>`,
  );
});

export class WikiPage extends CardDef {
  @field content = contains(MarkdownField);
  @field relatedPages = linksToMany(() => WikiPage);
}
```

**Gotchas:**

- Use `linksToMany(() => WikiPage)` for the self-reference. The arrow is required for the same circular-definition reason as recursive FieldDefs.
- Escape text and attribute values before writing your own `innerHTML` replacement, even if MarkdownField output was sanitized.
- The modifier should only create anchors. Navigation belongs in the click handler where `this.args.viewCard(...)` is available.
- The simple version only links pages that are present in `relatedPages`. A slug URL fallback is possible, but it is realm-layout-specific and should be added deliberately.

**Source:** `realms-staging.stack.cards/ctse/correct-cuckoo/wiki.gts:116-200` and `:677-889`, `BSL-STUDY.md:1882-1885`.

**See also:** `show-runtime-markdown-html`, `organize-recursive-fielddef`, `automate-toc`.
