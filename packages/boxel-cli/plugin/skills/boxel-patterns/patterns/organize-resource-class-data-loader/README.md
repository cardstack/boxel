---
validated: source-proven
---

# organize-resource-class-data-loader — Resource class with boxed constructor

**What this gives you:** An `ember-resources` Resource subclass that loads data reactively *and* safely exposes a class constructor to templates without Glimmer auto-binding it.

**When to use:** A card needs reactive data — fetched from another card, derived from a CodeRef, computed from external state. You want it to refresh when inputs change and rerender on completion.

**The insight (the hard-won part):** When you put a class *constructor* into a template via `{{...}}`, Glimmer auto-binds `this` — which breaks `instanceof` checks and breaks `getFields` introspection on CardDef subclasses. The fix is to wrap the constructor in a plain object: `{ ctor, fields }`. Templates can read `boxedClass.ctor` without triggering the bind. This is not in any official doc; it's surfaced once you hit the bug.

**Recipe shape:**

1. Define your resource class: `class GetFieldsResource extends Resource<Args>`.
2. In its `modify(positional, named)`, load and store `{ ctor: SomeClass, fields: [...] }` — never bare `ctor`.
3. Wrap usage in a `resource()` helper for templates.
4. Templates access `result.ctor` and `result.fields` — Glimmer can't auto-bind into the object.

**Gotchas:**
- Bare constructors in templates LOOK fine until you try `instanceof` or `Object.getPrototypeOf`. Always box.
- The resource's `modify` is sync; do async work in a tracked promise and re-set state when it resolves.
- Use `import.meta.url` for relative CodeRefs (same `@ts-expect-error` workaround as `command-with-skill-card-ref`).

**Source:** catalog-realm `resources/get-fields-resource.gts:27-50` (the boxed class), `:67-94` (getClass / codeRefWithAbsoluteURL / getFields).

**See also:** `command-with-skill-card-ref`, `automate-linked-to-me-lookup` (a simpler resource pattern).
