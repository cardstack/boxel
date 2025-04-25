# Computed Fields

In addition to linking to or containing card fields, a card can have a “computed” field. Its value will be determined by the output of the `computeVia` function and update when its constituent fields changes.

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
