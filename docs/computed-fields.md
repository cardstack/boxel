# Computed Fields

In addition to linking to or containing card fields, a card can have a “computed” field. Its value will be determined by the output of the `computeVia` function and update when its constituent fields changes.

```typescript
export class Person extends CardDef {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);

  @field fullName = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    }
  });
  …
```

You can also specify the name of the computation function on the class as a string instead of inlining it:

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

Computed fields are eagerly evaluated, they do not need to be consumed for `computeVia` to run.

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

The values of async computed fields are available synchronously in other `computedVia` functions. Since async field values are not guaranteed to be present, you can use card API [`getIfReady`](https://github.com/cardstack/boxel/blob/307d78676ebdb93cee75d61b8812914013a094a7/packages/base/card-api.gts#L2112) avoid errors about the field not being ready:

```javascript
await getIfReady(this, 'fullName');
// 'Carl Stack'
await getIfReady(this, 'fullName');
// {type: 'not-ready', fieldName: 'fullName', instance: …}
```

## Computed `linksTo` and `linksToMany`

While `computeVia` can currently only be applied to `contains`/`containsMany` fields, there’s a plan to let it work for `linksTo` and `linksToMany` in the future.
