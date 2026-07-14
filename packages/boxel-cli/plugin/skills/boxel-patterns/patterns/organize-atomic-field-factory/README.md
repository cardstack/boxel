---
validated: source-proven
---

# organize-atomic-field-factory — Factory returning a StringField subclass with options + view

**What this gives you:** A function `createOptionSelectField({ options, view })` that returns a `class extends StringField` you can directly use as a field type. No repeated BoxelSelect boilerplate, no shared base class, no hand-rolled enum field per use site.

**When to use:** You have many enum-ish fields (`Status`, `Priority`, `Department`) that differ only in their option lists and presentation (dropdown vs radio). Each is a one-liner using the factory.

**The insight:** `class extends StringField` works inside a function body. Return it. The closure captures `options` and `view`, the returned class is itself a valid field type. This is _much_ cleaner than a shared `OptionField` base that subclasses extend — there's no inheritance to maintain.

**Recipe shape:**

```ts
const StatusField = createOptionSelectField({
  options: ['todo', 'doing', 'done'],
  view: 'boxel-select',
});
const PriorityField = createOptionSelectField({
  options: ['P0', 'P1', 'P2'],
  view: 'radio',
});
```

Each returned class has `displayName`, an `edit` component that renders `BoxelSelect` or radio buttons based on `view`, and serializes as a plain string.

**Gotchas:**

- The returned class is a _new class every call_. Don't `===`-compare classes across modules.
- Set `displayName` from a factory arg so the inspector shows something meaningful.
- For dynamic options (e.g. from a Query), use the enumeration skill instead — see `boxel/references/enumerations.md`.

**Source:** catalog-realm `utils/create-option-select.gts:15-97`.

**See also:** `organize-variant-field-dispatcher` (for when variants differ in more than option list), `boxel/references/enumerations.md` (for `enumField` with rich/dynamic options).
