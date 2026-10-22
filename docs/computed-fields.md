# Computed Fields

When any field consumed by the computed field changes, the value will [rerender](./card-rendering.md#re-rendering-process).

Computed fields are evaluated on demand when they are accessed. Until the next microtask checkpoint, repeated reads share a single evaluation, so a template that reads a computed in several places runs its `computeVia` once:

- A computed re-evaluates when a tracked input changes. This includes a read right after the write (`card.firstName = 'Ada'` followed by `card.fullName`).
- An input read without tracking, such as the clock or a plain object property, can be served from the first read until the next microtask checkpoint.
- Every reader in that window gets the same value. Copy it before mutating it in place, for example `[...this.args.model.days].sort(...)` rather than `this.args.model.days.sort(...)`.

## Supported Field Types

Computed fields can be applied to `contains`, `containsMany`, `linksTo`, and `linksToMany` field types. In addition to linking to or containing card fields, a card can have a “computed” field. Its value is determined by the output of the `computeVia` function and updates when its constituent fields change.

```typescript
export class Person extends CardDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);

  @field fullName = contains(StringField, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    }
  });
  …
```

The field can be used in a template like any other:

```handlebars
<template>
  <h1><@fields.fullName /></h1>
</template>
```

When any field consumed by the computed field changes, the value will [rerender](./card-rendering.md#re-rendering-process).

Computed fields are eagerly evaluated, they do not need to be consumed for `computeVia` to run.

## Computed `linksTo` and `linksToMany`

While `computeVia` can currently only be applied to `contains`/`containsMany` fields, there’s a plan to let it work for `linksTo` and `linksToMany` in the future.
