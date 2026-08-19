---
validated: source-proven
---

# organize-recursive-fielddef — Nested FieldDef trees with lazy self-reference

**What this gives you:** Threaded comments, nested categories, org trees, outlines, and file trees where each node owns children of the same FieldDef type.

**When to use:** A field needs repeatable children that have the exact same schema as the parent node. Common triggers: "comment replies", "subtasks", "folder tree", "outline sections", "nested checklist", "category hierarchy".

**The insight:** Self-reference must be lazy. Use `containsMany(() => CommentThread)`, not `containsMany(CommentThread)`, inside the class body. The arrow delays resolution until after the class exists, avoiding the circular definition trap.

**Recipe shape:**

```ts
export class CommentThread extends FieldDef {
  @field body = contains(TextAreaField);
  @field replies = containsMany(() => CommentThread);
}
```

**Gotchas:**
- Use the lazy arrow only where the class references itself inside its own definition. A parent CardDef that appears after the FieldDef can use `containsMany(CommentThread)`.
- Include a depth or collapsed-state guard in the rendering component for very deep trees. Recursion is powerful, but unbounded rendering is not.
- Render the plural field with `<@fields.replies @format='embedded' />` so Boxel owns persistence and child rendering.
- If you style the nested plural wrapper, remember the delegated-render wrapper trap: linksToMany and containsMany have different wrapper classes. For pure containsMany, `.containsMany-field` is usually enough.

**Source:** `realms-staging.stack.cards/awalker34/magma-moors/story.gts:93-122`, `BSL-STUDY.md:633-635`.

**See also:** `polymorphic-field-subclass`, `containsmany-sorted-render`, `boxel-ui-guidelines/references/delegated-render-control.md`.
