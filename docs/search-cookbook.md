# Search cookbook

What people ask for, and the query that answers it. Many requests don't map to an obvious operator: "hidden gem" is a blend with an inverted signal, "cheap for its kind" is an expression sort entry against a comparison set, "dupes of this" is a one-card `let` binding. Find the phrase, then adapt the type and field names to your cards. Each member is defined once, in [Search](search.md); this page only shows them combined.

Every query is in the newer spelling, with `productRef` standing for the product card type's code ref: `{ module: '@cardstack/catalog/product', name: 'Product' }` (a registered prefix) or the module's URL, never a bare name or a relative module ([ADR 002](adr/002-keep-identifiers-canonical-resolve-at-network-boundary.md)). The examples assume a product type with the usual shop fields (`productType`, `priceMin`, `rating`, `reviewCount`, `unitsSold30d`, `imageEmbedding`, …), and `textVector` stands for an embedding of the shopper's words that the caller computed, as a list of numbers. Each query passes the grammar check (`assertQuery` in `@cardstack/runtime-common`).

## Find a pattern

| When someone says                                                            | Pattern                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| "no leather", "not black", "anything but", "except"                          | [Without something](#without-something)                                      |
| "black or white", "chair or bench", "either"                                 | [Either of two](#either-of-two)                                              |
| "new this year", "just in", "recently added", "new this month"               | [New lately](#new-lately)                                                    |
| "almost sold out", "low stock", "last few"                                   | [Almost gone](#almost-gone)                                                  |
| "no color listed", "without a price", "incomplete"                           | [Missing information](#missing-information)                                  |
| "from my wishlist", "from my saved", "in my list"                            | [From my saved list](#from-my-saved-list)                                    |
| "floor lamps", "in this category", "nothing in this category"                | [A category, then its neighbors](#a-category-then-its-neighbors)             |
| "reclinr", "cushon covr", "any typo"                                         | [Misspelled](#misspelled)                                                    |
| "search box", "autocomplete", "type-ahead"                                   | [As they type](#as-they-type)                                                |
| "coffee table but not glass", "iphone 11 but not pro"                        | [An exact phrase, minus a word](#an-exact-phrase-minus-a-word)               |
| "oak in the name", "title says"                                              | [In the title only](#in-the-title-only)                                      |
| "removable covers", "mentions in the bullet points"                          | [In the details](#in-the-details)                                            |
| "model AMG105", "SKU starting with", "part number"                           | [A model number](#a-model-number)                                            |
| "best match", "most relevant"                                                | [Words, ranked by how well they match](#words-ranked-by-how-well-they-match) |
| "crowd favorite", "everyone loves", "popular and good"                       | [Crowd favorite](#crowd-favorite)                                            |
| "hidden gem", "underrated", "not mainstream", "sleeper hit"                  | [Hidden gem](#hidden-gem)                                                    |
| "new and popular", "up and coming"                                           | [New and rising](#new-and-rising)                                            |
| "cheap but good", "value", "bang for the buck"                               | [Cheap but good](#cheap-but-good)                                            |
| "just the best", "the one to buy", "top pick"                                | [Just the best one](#just-the-best-one)                                      |
| "trust reviews", "well reviewed", "not just popular"                         | [Trust the reviews](#trust-the-reviews)                                      |
| "brass preferred", "ideally", "bonus if"                                     | [Prefer one thing, drop nothing](#prefer-one-thing-drop-nothing)             |
| "staff pick", "featured", "recommended by the shop"                          | [Staff picks first](#staff-picks-first)                                      |
| "best value", "worth the price"                                              | [Value for money](#value-for-money)                                          |
| "quietly loved", "people save it", "cult favorite"                           | [Loved, not hyped](#loved-not-hyped)                                         |
| "selling fast", "flying off the shelves"                                     | [Selling fast for its age](#selling-fast-for-its-age)                        |
| "safe bet", "reliable", "can't go wrong"                                     | [Safe bet](#safe-bet)                                                        |
| "rating you can trust", "adjusted rating"                                    | [Fair rating with few reviews](#fair-rating-with-few-reviews)                |
| "about $40", "around forty dollars", "gift budget"                           | [Around a price](#around-a-price)                                            |
| "recent but good", "not stale"                                               | [Fresh first, gently](#fresh-first-gently)                                   |
| "converts", "people buy after looking", "not just browsed"                   | [People actually buy it](#people-actually-buy-it)                            |
| "trending up", "gaining", "momentum"                                         | [Picking up](#picking-up)                                                    |
| "cheap for what it is", "below the usual price", "cheaper than most"         | [Cheap for its kind](#cheap-for-its-kind)                                    |
| "best rated of its kind", "top of its category"                              | [Top-rated for its kind](#top-rated-for-its-kind)                            |
| "the brand's best seller", "their most popular"                              | [Each brand's best seller](#each-brands-best-seller)                         |
| "standout", "exceptional", "unusually good"                                  | [Stands out](#stands-out)                                                    |
| "better value than most", "good for the money compared to others"            | [Better value than most](#better-value-than-most)                            |
| "should cost more", "underpriced", "a steal"                                 | [Underpriced for its rating](#underpriced-for-its-rating)                    |
| "more like this", "similar", "like that one"                                 | [More like this one](#more-like-this-one)                                    |
| "not like this", "less of these", "different from"                           | [Less like that one](#less-like-that-one)                                    |
| "something so my dog stops", "a problem, not a product", "for a dark corner" | [Describe it, don't name it](#describe-it-dont-name-it)                      |
| "housewarming gift", "calm bedroom", "cozy"                                  | [A mood or occasion](#a-mood-or-occasion)                                    |
| "dupe", "looks like but cheaper", "designer look for less"                   | [Dupes of a product](#dupes-of-a-product)                                    |
| "same thing but cheaper", "cheaper twin"                                     | [Cheaper than its look-alikes](#cheaper-than-its-look-alikes)                |
| "one bed, one lamp, one rug", "a bundle", "one per kind"                     | [One of each](#one-of-each)                                                  |
| "different brands", "not all the same brand"                                 | [Variety of brands](#variety-of-brands)                                      |
| "everywhere", "all my workspaces", "across realms"                           | [Across my workspaces](#across-my-workspaces)                                |
| "cheapest brand", "average price by brand"                                   | [Which brand is cheapest on average](#which-brand-is-cheapest-on-average)    |
| "how much do they cost", "price range", "what's typical"                     | [Price range](#price-range)                                                  |
| "export", "spreadsheet", "all the prices"                                    | [A table to analyze](#a-table-to-analyze)                                    |

## Narrowing

Most requests start as filters. These are the ones people phrase in ways that hide the operator.

### Without something

**Say:** "no leather", "not black", "anything but", "except"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'CHAIR' } },
      { not: { in: { material: ['Leather', 'Faux Leather'] } } },
    ],
  },
};
```

`not` around an `in` excludes every spelling of the thing at once.

**Watch out:** A product with no material at all is left out too: a missing value matches neither `in` nor its `not`. To keep those, write `{ any: [{ missing: 'material' }, { not: { in: { material: ['Leather', 'Faux Leather'] } } }] }`.

### Either of two

**Say:** "black or white", "chair or bench", "either"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'PLANTER' } },
      { in: { color: ['Black', 'White'] } },
    ],
  },
};
```

`in` is the short form of an `any` of `eq`s on one field.

### New lately

**Say:** "new this year", "just in", "recently added", "new this month"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'LAMP' } },
      { range: { publishedAt: { gte: 'now-1y/d' } } },
    ],
  },
  sort: [{ by: 'publishedAt', direction: 'desc' }],
};
```

A relative date (`now-1y/d`, `now-30d/d`, `now/M`) stays current in a saved search; `/d` rounds to the start of the day so the result is stable within a day.

### Almost gone

**Say:** "almost sold out", "low stock", "last few"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { inStock: true } },
      { range: { totalInventory: { lte: 10 } } },
    ],
  },
};
```

In stock and a small inventory; `inStock` alone keeps the products that just ran out out of the list.

### Missing information

**Say:** "no color listed", "without a price", "incomplete"

```js
const query = {
  type: productRef,
  filter: { every: [{ eq: { productType: 'RUG' } }, { missing: 'color' }] },
};
```

`missing` keeps the cards with no value at a path; `exists` is its opposite.

### From my saved list

**Say:** "from my wishlist", "from my saved", "in my list"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      {
        linkedFrom: {
          card: 'https://my.realm/Wishlist/mine',
          field: 'items',
        },
      },
      { range: { priceMin: { lte: 100 } } },
    ],
  },
};
```

`linkedFrom` keeps the cards another card links to, so the list stays the source of truth. `card` is the list card's absolute URL, in the realm being searched.

**Watch out:** Under a realm policy, `linkedFrom` cannot sit inside a binding or a comparison filter.

_Needs a value computed first (an embedding, a saved list, or several realms) before it runs._

### A category, then its neighbors

**Say:** "floor lamps", "in this category", "nothing in this category"

```js
const query = {
  type: productRef,
  filter: { matches: 'lamp' },
  sort: [
    {
      blend: [
        {
          boost: {
            every: [
              { eq: { 'category.name': 'Floor Lamps' } },
              { matches: 'lamp', scope: 'title' },
            ],
          },
          weight: 10,
        },
        {
          boost: {
            in: { 'category.name': ['Table Lamps', 'Desk Lamps', 'Lamps'] },
          },
          weight: 5,
        },
        { by: 'textRelevance' },
        { by: 'rating', weight: 0.5 },
      ],
    },
  ],
};
```

Tiers, not a hard filter: every good match in the chosen category comes first, then its siblings, then everything else by relevance, so the page is never empty. A boost adds `weight / (k + 1)`, so a tier's weight must exceed the sum of every weight below it (10 > 5 + 1 + 0.5). Matching the category by name rather than by full path also catches the same category in a parallel branch of the tree.

**Watch out:** Require a strong match for the top tier (here, the word in the title), or one weak match in the chosen category outranks excellent ones next door. The sibling names come from the chosen category's parent, which the UI already holds.

## Words

Text matching, beyond typing the words in.

### Misspelled

**Say:** "reclinr", "cushon covr", "any typo"

```js
const query = { type: productRef, filter: { matches: 'reclinr', typos: true } };
```

`typos: true` also matches the closest words the realm's fields hold.

**Watch out:** Exact matching is the default; turn typos on where the UI asks for it.

### As they type

**Say:** "search box", "autocomplete", "type-ahead"

```js
const query = {
  type: productRef,
  filter: { matches: 'otto', prefix: true, scope: 'title', typos: true },
  page: { size: 8 },
};
```

`prefix: true` with `scope: 'title'` matches word prefixes in titles and alternative names, in any order, without stemming, and ranks the closest title first. Leave out `scope` to search whole pages, where only the last word is unfinished.

### An exact phrase, minus a word

**Say:** "coffee table but not glass", "iphone 11 but not pro"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'CELLULAR_PHONE_CASE' } },
      { matches: '"iphone 11" -pro -max' },
    ],
  },
};
```

`matches` takes web search syntax: quotes for a phrase, `-` to exclude, `or` for either.

### In the title only

**Say:** "oak in the name", "title says"

```js
const query = { type: productRef, filter: { matches: 'oak', scope: 'title' } };
```

`scope: "title"` searches the title, name and alias roles only.

### In the details

**Say:** "removable covers", "mentions in the bullet points"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'SOFA' } },
      { matches: 'removable', fields: ['bullets'] },
    ],
  },
};
```

`fields` limits the words to those fields. For long text stored as a `PassageField` list, `within` searches the passages and reports which matched.

### A model number

**Say:** "model AMG105", "SKU starting with", "part number"

```js
const query = {
  type: productRef,
  filter: { pattern: { modelNumber: 'AMG105*' } },
};
```

`pattern` is a glob over a whole value, ignoring case; `regex` is the full form. `*` stays within a `/`: for a model number like `FL-922/BLU`, write `FL-922**`.

### Find source files by path

**Say:** "the components", "every card module in this folder", "the docs pages", "files named like"

```js
const gtsFileDef = {
  module: '@cardstack/base/gts-file-def',
  name: 'GtsFileDef',
};
const query = {
  type: gtsFileDef,
  filter: { pattern: { url: '**/components/*.gts' } },
};
```

A file's `url` and `name` are searched by glob on every file type: `*` and `?` stay within one folder, `**` crosses folders, ignoring case. `**/components/*.gts` is the modules directly in a `components` folder, `**/components/**.gts` everything under it, and `{ pattern: { name: '*-card.gts' } }` matches the name alone. Use `TsFileDef`, `JsonFileDef`, `TextFileDef` or `MarkdownDef` (`**/docs/**.md`) for one kind, or `FileDef` (`@cardstack/base/card-api`) for every kind. To find a word inside the files, use `matches`.

### Words, ranked by how well they match

**Say:** "best match", "most relevant"

```js
const query = {
  type: productRef,
  filter: { matches: 'brass lamp' },
  sort: [{ by: 'textRelevance' }],
};
```

A `textRelevance` sort ranks by the words; it needs a positive `matches` term to score.

## Ranking by taste

A `blend` fuses several signals by rank (RRF), so signals on different scales combine without tuning. A negative weight inverts a signal; `k` sets how sharply the top beats the rest.

### Crowd favorite

**Say:** "crowd favorite", "everyone loves", "popular and good"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'SOFA' } },
  sort: [{ blend: [{ by: 'unitsSold30d', weight: 1.5 }, { by: 'rating' }] }],
};
```

Sales and rating each rank the products; the blend rewards being high on both.

### Hidden gem

**Say:** "hidden gem", "underrated", "not mainstream", "sleeper hit"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'LAMP' } },
      { range: { reviewCount: { gte: 5 } } },
    ],
  },
  sort: [
    {
      blend: [
        { by: 'rating', weight: 1.5 },
        { by: 'unitsSold30d', weight: -1 },
      ],
    },
  ],
};
```

A negative weight inverts sales, so well-rated products few people bought rise. The review floor keeps out products with one lucky rating.

### New and rising

**Say:** "new and popular", "up and coming"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'HANDBAG' } },
  sort: [{ blend: [{ by: 'publishedAt' }, { by: 'unitsSold30d' }] }],
};
```

Recency and sales at equal weight: new things that are already selling.

### Cheap but good

**Say:** "cheap but good", "value", "bang for the buck"

```js
const query = {
  type: productRef,
  filter: {
    every: [
      { eq: { productType: 'SANDAL' } },
      { range: { reviewCount: { gte: 10 } } },
    ],
  },
  sort: [{ blend: [{ by: 'rating' }, { by: 'priceMin', direction: 'asc' }] }],
};
```

Price ranks lowest first (`direction: "asc"`), rating highest first; the blend balances them. For a stricter trade-off, use the value expression below.

### Just the best one

**Say:** "just the best", "the one to buy", "top pick"

```js
const query = {
  type: productRef,
  filter: { every: [{ eq: { productType: 'LAMP' } }, { matches: 'desk' }] },
  sort: [
    {
      blend: [
        { by: 'textRelevance', weight: 1.4 },
        { by: 'rating', weight: 0.6 },
      ],
      k: 5,
    },
  ],
  page: { size: 5 },
};
```

A small `k` makes rank 1 count far more than rank 5, so one clear winner leads. A large `k` (120) flattens the top for a balanced list.

### Trust the reviews

**Say:** "trust reviews", "well reviewed", "not just popular"

```js
const query = {
  type: productRef,
  filter: {
    every: [{ eq: { productType: 'VITAMIN' } }, { matches: '"vitamin d"' }],
  },
  sort: [{ relevance: { text: 1, quality: 1.5, popularity: 0 } }],
};
```

`relevance` blends the words with the signals the type declares; naming weights re-tunes them, and 0 drops one.

### Prefer one thing, drop nothing

**Say:** "brass preferred", "ideally", "bonus if"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'PLANTER' } },
  sort: [
    {
      blend: [
        { by: 'rating' },
        { boost: { eq: { material: 'Brass' } }, weight: 1.5 },
      ],
    },
  ],
};
```

A `boost` lifts the matches by `weight / (k + 1)` without hiding the rest. A negative weight lifts everything else instead.

### Staff picks first

**Say:** "staff pick", "featured", "recommended by the shop"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'PLANTER' } },
  sort: [
    { by: 'merchPriority', direction: 'desc' },
    { by: 'rating', direction: 'desc' },
  ],
};
```

Plain sorts apply in order: the shop's priority, then rating to break ties.

## Ranking by an expression

When the idea is a ratio or a curve, write it as a spreadsheet expression. It runs in SQL over every match when Postgres can compute it.

### Value for money

**Say:** "best value", "worth the price"

```js
const query = {
  type: productRef,
  filter: { every: [{ eq: { productType: 'LAMP' } }, { matches: 'desk' }] },
  sort: [
    {
      blend: [
        { by: 'textRelevance', weight: 0.6 },
        { expression: 'rating / LN(priceMin + 1)', weight: 1.5 },
      ],
    },
  ],
};
```

Rating over the log of the price: a $20 lamp is not judged 10× better than a $200 one. Inside a blend the expression is one more signal.

### Loved, not hyped

**Say:** "quietly loved", "people save it", "cult favorite"

```js
const query = {
  type: productRef,
  filter: { matches: 'throw pillow' },
  sort: [
    { expression: 'IFERROR(wishlistCount / unitsSold30d, wishlistCount)' },
  ],
};
```

Saves per sale. `IFERROR` covers products with no sales, which would divide by zero.

### Selling fast for its age

**Say:** "selling fast", "flying off the shelves"

```js
const query = {
  type: productRef,
  filter: { matches: 'kitchen' },
  sort: [{ expression: 'unitsSold30d / MAX(DAYS(NOW(), publishedAt), 7)' }],
};
```

Sales per day since launch, with a 7-day floor so a product listed this morning does not win on one sale.

### Safe bet

**Say:** "safe bet", "reliable", "can't go wrong"

```js
const query = {
  type: productRef,
  filter: { every: [{ eq: { productType: 'CHAIR' } }, { matches: 'office' }] },
  sort: [{ expression: 'rating * LOG10(reviewCount + 1) - returnRate * 20' }],
};
```

A good rating backed by many reviews, minus a penalty for returns.

### Fair rating with few reviews

**Say:** "rating you can trust", "adjusted rating"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'BOOT' } },
  sort: [
    { expression: '(rating * reviewCount + 4 * 20) / (reviewCount + 20)' },
  ],
};
```

A Bayesian average: 20 imaginary 4-star reviews pull a 5.0 from two reviews below a 4.8 from two thousand.

### Around a price

**Say:** "about $40", "around forty dollars", "gift budget"

```js
const query = {
  type: productRef,
  filter: { matches: 'gift' },
  sort: [{ expression: 'EXP(-POWER((priceMin - 40) / 15, 2))' }],
};
```

A bell curve centered on the budget: $40 scores 1, $25 or $55 about 0.37. Better than a hard range when the budget is soft.

### Fresh first, gently

**Say:** "recent but good", "not stale"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'HANDBAG' } },
  sort: [{ expression: 'rating * EXP(-DAYS(NOW(), publishedAt) / 30)' }],
};
```

Rating decayed by age with a 30-day time constant: recency matters without burying great older products outright.

### People actually buy it

**Say:** "converts", "people buy after looking", "not just browsed"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'CELLULAR_PHONE_CASE' } },
  sort: [{ expression: 'IFERROR(addToCarts30d / views30d, 0) * 100' }],
};
```

Add-to-cart rate per view.

### Picking up

**Say:** "trending up", "gaining", "momentum"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'GROCERY' } },
  sort: [{ expression: 'IFERROR((unitsSold7d * 30 / 7) / unitsSold30d, 0)' }],
};
```

Last week's pace against the month's: above 1 means sales are speeding up.

## "For its kind"

An expression sort entry with `top` and a comparison set (`compare`) re-orders the top results by how each measures against similar products: the median of its kind, its percentile, its z-score. The entries after it (none here: card URL order) choose which rows are the top.

### Cheap for its kind

**Say:** "cheap for what it is", "below the usual price", "cheaper than most"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'HOME' } },
  sort: [
    {
      expression: '1 - priceMin / stats.priceMin.median',
      top: 200,
      compare: { by: 'productType' },
    },
  ],
};
```

The comparison set is every match of the same product type; `stats.priceMin.median` is that kind's median price.

### Top-rated for its kind

**Say:** "best rated of its kind", "top of its category"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'FURNITURE' } },
  sort: [
    {
      expression: 'PERCENTRANK_INC(peers.rating, rating)',
      top: 200,
      compare: { by: 'productType' },
    },
  ],
};
```

`peers.rating` is the kind's ratings as a list, which `PERCENTRANK_INC`, `COUNTIF`, `MEDIAN` and the other list functions read.

### Each brand's best seller

**Say:** "the brand's best seller", "their most popular"

```js
const query = {
  type: productRef,
  filter: { matches: 'kitchen' },
  sort: [
    {
      expression: 'PERCENTRANK_INC(peers.unitsSold30d, unitsSold30d)',
      top: 200,
      compare: { by: 'brand.name' },
    },
  ],
};
```

Comparing by brand instead of by type ranks each product within its own brand.

### Stands out

**Say:** "standout", "exceptional", "unusually good"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'CHAIR' } },
  sort: [
    {
      expression: '(rating - stats.rating.avg) / stats.rating.stdev',
      top: 200,
      compare: { by: 'productType' },
    },
  ],
};
```

A z-score: how many standard deviations above its kind's average rating.

### Better value than most

**Say:** "better value than most", "good for the money compared to others"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'RUG' } },
  sort: [
    {
      expression:
        'PERCENTRANK_INC(peers.rating, rating) - PERCENTRANK_INC(peers.priceMin, priceMin)',
      top: 200,
      compare: { by: 'productType' },
    },
  ],
};
```

Where it ranks on rating minus where it ranks on price, both within its kind.

### Underpriced for its rating

**Say:** "should cost more", "underpriced", "a steal"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'LAMP' } },
  sort: [
    {
      expression:
        'rating / stats.rating.avg - priceMin / stats.priceMin.median',
      top: 200,
      compare: { by: 'productType' },
    },
  ],
};
```

How far its rating sits above its kind's average, less how far its price sits above its kind's median.

**Watch out:** A fitted line (`LINEST`, `RSQ`) is outside what a query expression can compute in SQL and is refused (`expression-unsupported`); compute such a fit into a field when the card is indexed if you need it.

## Meaning and look

Vector signals: what a product is like, or looks like. A `let` binding with `one: true` reads another card's vector, so "more like this" needs no client-side lookup.

### More like this one

**Say:** "more like this", "similar", "like that one"

```js
const query = {
  type: productRef,
  let: {
    $seed: {
      from: { type: productRef, filter: { eq: { itemId: 'B073F7GFKB' } } },
      one: true,
    },
  },
  filter: { eq: { productType: 'RUG' } },
  sort: [
    {
      blend: [
        {
          by: 'imageEmbedding',
          near: '$seed.imageEmbedding',
          weight: 1.5,
        },
        { by: 'rating', weight: 0.5 },
      ],
    },
  ],
};
```

A one-card binding reads the product's image vector on the server; the blend keeps quality in play.

### Less like that one

**Say:** "not like this", "less of these", "different from"

```js
const query = {
  type: productRef,
  let: {
    $avoid: {
      from: { type: productRef, filter: { eq: { itemId: 'B07CF7B5S2' } } },
      one: true,
    },
  },
  filter: { eq: { productType: 'PLANTER' } },
  sort: [
    {
      blend: [
        {
          by: 'imageEmbedding',
          near: '$avoid.imageEmbedding',
          weight: -1,
        },
        { by: 'rating', weight: 0.6 },
      ],
    },
  ],
};
```

A negative weight on similarity favors the least alike. Pair one positive and one negative seed for "like A, not B".

### Describe it, don't name it

**Say:** "something so my dog stops", "a problem, not a product", "for a dark corner"

```js
const query = {
  type: productRef,
  filter: {
    near: { embedding: { to: textVector, minSimilarity: 0.35 } },
  },
  sort: [
    {
      relevance: { meaning: 1.5, quality: 0.5 },
      near: textVector,
    },
  ],
};
```

Embed the shopper's words, keep what is close enough, and rank by meaning with quality as a tiebreak.

**Watch out:** Embed a description of the products that solve it ("couch cover, pet barrier, dog bed"), not the complaint itself.

_Needs a value computed first (an embedding, a saved list, or several realms) before it runs._

### A mood or occasion

**Say:** "housewarming gift", "calm bedroom", "cozy"

```js
const query = {
  type: productRef,
  filter: { range: { priceMin: { lte: 50 } } },
  sort: [
    {
      relevance: { meaning: 1.5, quality: 0.5 },
      near: textVector,
    },
  ],
};
```

No threshold: everything under budget stays, ranked by closeness to the mood.

_Needs a value computed first (an embedding, a saved list, or several realms) before it runs._

## Dupes and twins

The look of one product, cheaper, from another brand.

### Dupes of a product

**Say:** "dupe", "looks like but cheaper", "designer look for less"

```js
const query = {
  type: productRef,
  let: {
    $orig: {
      from: { type: productRef, filter: { eq: { itemId: 'B07P8SV57Z' } } },
      one: true,
    },
  },
  filter: {
    every: [
      {
        near: {
          imageEmbedding: {
            to: '$orig.imageEmbedding',
            minSimilarity: 0.6,
          },
        },
      },
      { eq: { productType: '$orig.productType' } },
      { range: { priceMin: { lt: '$orig.priceMin' } } },
      {
        any: [
          { missing: 'brand.name' },
          {
            not: { eq: { 'brand.name': '$orig.brand.name' } },
          },
        ],
      },
    ],
  },
  sort: [
    { expression: 'ROUND($orig.priceMin - priceMin, 2)', top: 200 },
    { by: 'imageEmbedding', near: '$orig.imageEmbedding' },
  ],
  collapse: 'brand.name',
};
```

Same look, same kind, cheaper, another brand; one per brand; the 200 closest re-ordered by the saving. Raise `minSimilarity` to 0.8 for a near twin.

### Cheaper than its look-alikes

**Say:** "same thing but cheaper", "cheaper twin"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'LAMP' } },
  sort: [
    {
      expression: '1 - priceMin / stats.priceMin.median',
      top: 200,
      compare: { near: 'imageEmbedding', k: 20, minSimilarity: 0.75 },
    },
  ],
};
```

The comparison set is each product's 20 nearest look-alikes rather than its whole category.

**Watch out:** The vector field must declare `search: { neighbors: true }`.

## Shaping the page

Variety, bundles and collections.

### One of each

**Say:** "one bed, one lamp, one rug", "a bundle", "one per kind"

```js
const query = {
  type: productRef,
  filter: { in: { productType: ['BED', 'LAMP', 'RUG'] } },
  sort: [
    { by: 'rating', direction: 'desc' },
    { by: 'reviewCount', direction: 'desc' },
  ],
  collapse: 'productType',
};
```

`collapse` keeps the best card of each group by the query's own sort.

### Variety of brands

**Say:** "different brands", "not all the same brand"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'RUG' } },
  sort: [{ by: 'rating', direction: 'desc' }],
  collapse: { by: 'brand.name', keep: 2 },
};
```

At most two per brand. Each result carries `meta._collapseSize` for "and 12 more".

**Watch out:** Facets still count every match, before the collapse.

### Across my workspaces

**Say:** "everywhere", "all my workspaces", "across realms"

```js
const query = {
  realms: [catalogRealm, myRealm],
  federation: { results: 'merged' },
  type: productRef,
  filter: { matches: 'lamp' },
  sort: [{ by: 'priceMin' }],
};
```

Over several realms, `merged` gives one list in the query's sort; the default `byRealm` keeps each realm's rows as a section.

**Watch out:** Send it to `_federated-search`; `realms` names realms on that server. Blend and text scores compare only approximately across realms.

_Needs a value computed first (an embedding, a saved list, or several realms) before it runs._

## Answering with numbers

Questions whose answer is a count or a statistic, not a list.

### Which brand is cheapest on average

**Say:** "cheapest brand", "average price by brand"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'FLAT_SHEET' } },
  facets: [
    { by: 'brand.name', measure: { avg: 'priceMin' }, order: 'measure' },
  ],
  page: { size: 0 },
};
```

A facet with a measure answers per value; `page.size: 0` skips the list.

**Declare:** both fields are facets. `Brand` declares `name = contains(StringField, { search: { facet: true } })`, the product's `brand = linksTo(() => Brand, { searchable: true })` carries it, and `priceMin = contains(NumberField, { search: { facet: true } })`. An undeclared field is refused with `needs-declaration`.

**Watch out:** `order: "measure"` puts the highest first, so the cheapest brand is last. Raise `size` (up to 1,000) past the number of brands, or the cheapest may be cut off.

### Facet by something inside a linked file: the wrapper card declares it

**Say:** "photos by camera", "count the documents by title"

A file's fields are not facets of the card that links it, and a FileDef declares no facets: the card that links the file declares what it counts by, in a computed field of its own.

```ts
export class Photo extends CardDef {
  @field image = linksTo(ImageDef, { search: { facet: true } });
  @field cameraModel = contains(StringField, {
    computeVia: function (this: Photo) {
      return this.image?.exif?.cameraModel;
    },
    search: { facet: true },
  });
}

const query = {
  type: photoRef,
  facets: [{ by: 'cameraModel' }, { by: 'image' }],
  page: { size: 0 },
};
```

The computed value is in the card's search doc when it is indexed (the render loads the linked file), and editing the file reindexes the cards that read it. `image` counts the linked files by id.

**Watch out:** `{ by: 'image.exif.cameraModel' }` is refused with `needs-declaration`, and the message spells out the computed field to add.

### Price range

**Say:** "how much do they cost", "price range", "what's typical"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'TABLE' } },
  facets: [
    { by: 'priceMin', stats: true },
    {
      by: 'priceMin',
      ranges: [{ to: 100 }, { from: 100, to: 300 }, { from: 300 }],
    },
  ],
  page: { size: 0 },
};
```

`stats` gives min, max and average; `ranges` gives counts per bucket for a price slider.

**Declare:** `priceMin = contains(NumberField, { search: { facet: true } })`.

### A table to analyze

**Say:** "export", "spreadsheet", "all the prices"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'LAMP' } },
  select: ['itemId', 'title', 'priceMin', 'rating', { brand: 'brand.name' }],
  page: { size: 500 },
};
```

`select` answers with columns read from the index, nothing rendered: fast enough to load thousands of rows.

## Activity logs

Queries over a log's lines (`from: { log }`, [Searching a log](search.md#searching-a-log-from--log-)), and card queries that read one. `postRef` stands for a post card type with a `uri` field; the log's lines are `record`ed as `{ what: { action, post } }`. The tests in `packages/realm-server/tests/log-query-sources-integration-test.ts` and `log-policy-http-test.ts` run each of these.

### Likes per post

**Say:** "how many likes", "most liked", "likes per post"

```js
const query = {
  from: { log: 'Feed/reactions.jsonl' },
  filter: { eq: { 'what.action': 'like' } },
  group: { by: 'what.post', aggregates: { likes: { count: true } } },
  sort: [{ by: 'likes', direction: 'desc' }],
};
```

One row per post, `{ group: { 'what.post': … }, likes }`, most liked first; ties by post.

**Watch out:** a count shown on a card belongs on the card, kept there by whatever writes the log; a query answers it for one request.

### Skip what I've seen, in one request

**Say:** "new to me", "hide what I've seen", "not seen yet"

```js
const query = {
  type: postRef,
  let: {
    $seen: {
      from: {
        log: 'Feed/me.history.jsonl',
        filter: { eq: { 'what.action': 'seen' } },
      },
      select: 'what.post',
    },
  },
  filter: { not: { in: { uri: '$seen' } } },
};
```

The binding reads the distinct posts the reader's log says they saw, in the card query's snapshot, and the card query keeps the rest.

**Watch out:** a binding holds at most as many values as any list binding, the most recently seen first; past that, `meta.warnings` says it was cut.

### Attendance per day, across classes

**Say:** "who came", "attendance by day", "check-ins per class"

```js
const query = {
  from: { logs: { under: 'Classes/' } },
  filter: { eq: { 'what.present': true } },
  group: {
    by: ['file', 'what.day'],
    aggregates: { present: { count: true }, people: { distinct: 'actor' } },
  },
};
```

Every log in the folder, read as one set; `file` names which class each row counts.

### My own lines of a shared log

**Say:** "my check-ins", "what I logged", "my history" (in a realm I can't read)

```js
const query = {
  from: { log: 'Classes/maths.jsonl' },
  sort: [{ by: 'at', direction: 'desc' }],
  page: { size: 50 },
};
```

The query is the same as the owner's. Under a realm policy with a log-line grant (`query` on `JSONLFile`, `where: '.actor == actor()'`), the answer holds only the caller's lines, and its totals and facets count only those; `meta.policyScopedLogs` says so.

## Adding a pattern

Each pattern pairs what people say with the query and a line on why it is written that way. To add one, write it in the same shape, check its query with `assertQuery` from `@cardstack/runtime-common`, and run it against a realm. A rule a pattern relies on belongs in [Search](search.md), not here.
