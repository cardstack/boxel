# Computed Fields

A card’s fields can link to or contain other cards. A special
In addition to linking to or containing card fields, a card can have a “computed” field. Its value will be determined by the output of the `computeVia` function and update when its constituent fields changes.

```typescript
export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);

  @field fullName = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    }
  });
  …
```

You can also specify the name of the computation function as a string instead of inlining it:

```typescript
@field fullName = contains(StringCard, { computeVia: 'getFullName' });

getFullName() {
  return `${this.firstName} ${this.lastName}`;
}
```

The field can be used in a template like any other:

```handlebars
<template>
  <h1><@fields.fullName /></h1>
</template>
```

When any field consumed by the computed field changes, the value will [rerender](./card-rendering.md#re-rendering-process).

## Async computation

The calculation can be async:

```typescript
@field slowName = contains(StringCard, {
  computeVia: async function () {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return this.firstName;
  }
});
```

The values of async computed fields are available synchronously in other `computedVia` functions.

FIXME: how does that work, how is resolution ordered? And with the `[field] is not ready` error, is there a way to wait for it to be ready if it isn’t?

## Computed `linksTo` and `linksToMany`

While `computeVia` can currently only be applied to `contains`/`containsMany` fields, there’s a plan to let it work for `linksTo` and `linksToMany` in the future.
