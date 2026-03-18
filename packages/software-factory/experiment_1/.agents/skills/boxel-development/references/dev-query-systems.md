## Query Essentials

**The 'on' Rule (MEMORIZE THIS!):**
```ts
// ❌ WRONG - Missing 'on'
{ range: { price: { lte: 100 } } }

// ✅ CORRECT - Include 'on' for filters
{
  on: { module: new URL('./product', import.meta.url).href, name: 'Product' },
  range: { price: { lte: 100 } }
}
```

**⚠️ CRITICAL Path Rule:**
- **In .gts files (queries):** Use `./` - you're in the same directory as the module
- **In JSON files (`adoptsFrom`):** Use `../` - instances live in folders, need to navigate up
- `./` means "same directory" when used with `import.meta.url`

**Filter types needing 'on':**
- `eq`, `contains`, `range` (except after type filter)
- Sort on type-specific fields

**Filter composition types:**
- `any`: allows an "OR" union of other filters
- `every`: allows an "AND" union of other filters
- `not`: allow negating another filter

**Basic query pattern:**
```ts
const query = {
  filter: {
    every: [
      { type: { module: new URL('./product', import.meta.url).href, name: 'Product' } },
      { on: { module: new URL('./product', import.meta.url).href, name: 'Product' }, eq: { status: 'active' } }
    ]
  }
};
```

**Defining query-backed fields:**
```ts
@field shirts = linksToMany(Shirt, {
  query: {
    filter: {
      // implicit clause merged during execution: on: { module: Shirt.module, name: 'Shirt' }
      eq: { size: '$this.profile.shirtSize' },
    },
    realm: '$thisRealm',
    sort: [
      {
        by: 'updatedAt',
        direction: 'desc',
      },
    ],
    page: { size: 12 },
  },
});

@field profile = linksTo(Profile, {
  query: {
    filter: {
      eq: { primary: true },
    },
    // `linksTo` takes the first matching card (post-sort) or null when no results.
  },
});
```

**When to use what to query cards:**
- Efficient display-only → `PrerenderedCardSearch`
- Need data manipulation → `getCards`
- Treat query result as a field → query-backed fields
```