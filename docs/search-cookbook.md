# Search cookbook

What people ask for, and the query that answers it. Many requests don't map to an obvious operator: "hidden gem" is a blend with an inverted signal, "cheap for its kind" is a rerank against a comparison set, "dupes of this" is a one-card `let` binding. Find the phrase, then adapt the type and field names to your cards.

Every query here is in the V2 grammar described in [search.md](search.md), with `productRef` standing for a product card type with the usual shop fields (`productType`, `priceMin`, `rating`, `reviewCount`, `unitsSold30d`, `imageEmbedding`, …). Each one is checked against the query grammar, and all but the four marked as needing an embedding or a saved list ran against a real catalog and found results.

## Find a pattern

| When someone says                                                            | Pattern                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| "no leather", "not black", "anything but", "except"                          | [Without something](#without-something)                                      |
| "black or white", "chair or bench", "either"                                 | [Either of two](#either-of-two)                                              |
| "new this year", "just in", "recently added", "new this month"               | [New lately](#new-lately)                                                    |
| "almost sold out", "low stock", "last few"                                   | [Almost gone](#almost-gone)                                                  |
| "no color listed", "without a price", "incomplete"                           | [Missing information](#missing-information)                                  |
| "from my wishlist", "from my saved", "in my list"                            | [From my saved list](#from-my-saved-list)                                    |
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

**Watch out:** A product with no material at all is kept; add `{ exists: "material" }` if the field must be known.

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
      { linkedFrom: { card: 'Wishlist/mine', field: 'items' } },
      { range: { priceMin: { lte: 100 } } },
    ],
  },
};
```

`linkedFrom` keeps the cards another card links to, so the list stays the source of truth.

**Watch out:** Under a realm policy, `linkedFrom` cannot sit inside a binding or a comparison filter.

_Needs a value computed first (an embedding, a saved list, or several realms), so it is checked against the grammar only._

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
  filter: { typeahead: 'otto', typos: true },
  page: { size: 8 },
};
```

`typeahead` matches word prefixes in titles and alternative names, in any order, without stemming. Use `matches` with `prefix: true` to search whole pages.

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

`pattern` is a glob over a whole value, ignoring case; `regex` is the full form.

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

Price ranks lowest first (`direction: "asc"`), rating highest first; the blend balances them. For a stricter trade-off, use the value formula below.

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

## Ranking by a formula

When the idea is a ratio or a curve, write it as a spreadsheet formula. It runs in SQL over every match when Postgres can compute it.

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
        { formula: 'rating / LN(priceMin + 1)', weight: 1.5 },
      ],
    },
  ],
};
```

Rating over the log of the price: a $20 lamp is not judged 10× better than a $200 one. Inside a blend the formula is one more signal.

### Loved, not hyped

**Say:** "quietly loved", "people save it", "cult favorite"

```js
const query = {
  type: productRef,
  filter: { matches: 'throw pillow' },
  sort: [{ formula: 'IFERROR(wishlistCount / unitsSold30d, wishlistCount)' }],
};
```

Saves per sale. `IFERROR` covers products with no sales, which would divide by zero.

### Selling fast for its age

**Say:** "selling fast", "flying off the shelves"

```js
const query = {
  type: productRef,
  filter: { matches: 'kitchen' },
  sort: [{ formula: 'unitsSold30d / MAX(DAYS(NOW(), publishedAt), 7)' }],
};
```

Sales per day since launch, with a 7-day floor so a product listed this morning does not win on one sale.

### Safe bet

**Say:** "safe bet", "reliable", "can't go wrong"

```js
const query = {
  type: productRef,
  filter: { every: [{ eq: { productType: 'CHAIR' } }, { matches: 'office' }] },
  sort: [{ formula: 'rating * LOG10(reviewCount + 1) - returnRate * 20' }],
};
```

A good rating backed by many reviews, minus a penalty for returns.

### Fair rating with few reviews

**Say:** "rating you can trust", "adjusted rating"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'BOOT' } },
  sort: [{ formula: '(rating * reviewCount + 4 * 20) / (reviewCount + 20)' }],
};
```

A Bayesian average: 20 imaginary 4-star reviews pull a 5.0 from two reviews below a 4.8 from two thousand.

### Around a price

**Say:** "about $40", "around forty dollars", "gift budget"

```js
const query = {
  type: productRef,
  filter: { matches: 'gift' },
  sort: [{ formula: 'EXP(-POWER((priceMin - 40) / 15, 2))' }],
};
```

A bell curve centered on the budget: $40 scores 1, $25 or $55 about 0.37. Better than a hard range when the budget is soft.

### Fresh first, gently

**Say:** "recent but good", "not stale"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'HANDBAG' } },
  sort: [{ formula: 'rating * EXP(-DAYS(NOW(), publishedAt) / 30)' }],
};
```

Rating decayed by age with a 30-day time constant: recency matters without burying great older products outright.

### People actually buy it

**Say:** "converts", "people buy after looking", "not just browsed"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'CELLULAR_PHONE_CASE' } },
  sort: [{ formula: 'IFERROR(addToCarts30d / views30d, 0) * 100' }],
};
```

Add-to-cart rate per view.

### Picking up

**Say:** "trending up", "gaining", "momentum"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'GROCERY' } },
  sort: [{ formula: 'IFERROR((unitsSold7d * 30 / 7) / unitsSold30d, 0)' }],
};
```

Last week's pace against the month's: above 1 means sales are speeding up.

## "For its kind"

A `rerank` with a comparison set measures each result against similar products: the median of its kind, its percentile, its z-score.

### Cheap for its kind

**Say:** "cheap for what it is", "below the usual price", "cheaper than most"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'HOME' } },
  rerank: {
    expr: '1 - priceMin / stats.priceMin.median',
    top: 200,
    compare: { by: 'productType' },
  },
};
```

The comparison set is every match of the same product type; `stats.priceMin.median` is that kind's median price.

### Top-rated for its kind

**Say:** "best rated of its kind", "top of its category"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'FURNITURE' } },
  rerank: {
    expr: 'PERCENTRANK_INC(peers.rating, rating)',
    top: 200,
    compare: { by: 'productType' },
  },
};
```

`peers.rating` is the kind's ratings as a list, so any Excel function can place the product among them.

### Each brand's best seller

**Say:** "the brand's best seller", "their most popular"

```js
const query = {
  type: productRef,
  filter: { matches: 'kitchen' },
  rerank: {
    expr: 'PERCENTRANK_INC(peers.unitsSold30d, unitsSold30d)',
    top: 200,
    compare: { by: 'brand.name' },
  },
};
```

Comparing by brand instead of by type ranks each product within its own brand.

### Stands out

**Say:** "standout", "exceptional", "unusually good"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'CHAIR' } },
  rerank: {
    expr: '(rating - stats.rating.avg) / stats.rating.stdev',
    top: 200,
    compare: { by: 'productType' },
  },
};
```

A z-score: how many standard deviations above its kind's average rating.

### Better value than most

**Say:** "better value than most", "good for the money compared to others"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'RUG' } },
  rerank: {
    expr: 'PERCENTRANK_INC(peers.rating, rating) - PERCENTRANK_INC(peers.priceMin, priceMin)',
    top: 200,
    compare: { by: 'productType' },
  },
};
```

Where it ranks on rating minus where it ranks on price, both within its kind.

### Underpriced for its rating

**Say:** "should cost more", "underpriced", "a steal"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'LAMP' } },
  rerank: {
    expr: 'LET(fit, LINEST(peers.priceMin, peers.rating), INDEX(fit, 1) * rating + INDEX(fit, 2) - priceMin)',
    top: 200,
    compare: { by: 'productType' },
  },
};
```

Fits price against rating across the kind, then ranks by how far below the fitted line each product sits.

**Watch out:** Check `RSQ(peers.priceMin, peers.rating)` first; where rating does not explain price, the line means nothing.

## Meaning and look

Vector signals: what a product is like, or looks like. A `let` binding with `one: true` reads another card's vector, so "more like this" needs no client-side lookup.

### More like this one

**Say:** "more like this", "similar", "like that one"

```js
const query = {
  type: productRef,
  let: {
    seed: {
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
          near: { $let: 'seed', path: 'imageEmbedding' },
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
    avoid: {
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
          near: { $let: 'avoid', path: 'imageEmbedding' },
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
    near: { embedding: { to: '<embedding of the text>', minSimilarity: 0.35 } },
  },
  sort: [
    {
      relevance: { meaning: 1.5, quality: 0.5 },
      near: '<embedding of the text>',
    },
  ],
};
```

Embed the shopper's words, keep what is close enough, and rank by meaning with quality as a tiebreak.

**Watch out:** Embed a description of the products that solve it ("couch cover, pet barrier, dog bed"), not the complaint itself.

_Needs a value computed first (an embedding, a saved list, or several realms), so it is checked against the grammar only._

### A mood or occasion

**Say:** "housewarming gift", "calm bedroom", "cozy"

```js
const query = {
  type: productRef,
  filter: { range: { priceMin: { lte: 50 } } },
  sort: [
    {
      relevance: { meaning: 1.5, quality: 0.5 },
      near: '<embedding of the text>',
    },
  ],
};
```

No threshold: everything under budget stays, ranked by closeness to the mood.

_Needs a value computed first (an embedding, a saved list, or several realms), so it is checked against the grammar only._

## Dupes and twins

The look of one product, cheaper, from another brand.

### Dupes of a product

**Say:** "dupe", "looks like but cheaper", "designer look for less"

```js
const query = {
  type: productRef,
  let: {
    orig: {
      from: { type: productRef, filter: { eq: { itemId: 'B07P8SV57Z' } } },
      one: true,
    },
  },
  filter: {
    every: [
      {
        near: {
          imageEmbedding: {
            to: { $let: 'orig', path: 'imageEmbedding' },
            minSimilarity: 0.6,
          },
        },
      },
      { eq: { productType: { $let: 'orig', path: 'productType' } } },
      { range: { priceMin: { lt: { $let: 'orig', path: 'priceMin' } } } },
      {
        any: [
          { missing: 'brand.name' },
          {
            not: { eq: { 'brand.name': { $let: 'orig', path: 'brand.name' } } },
          },
        ],
      },
    ],
  },
  sort: [
    { by: 'imageEmbedding', near: { $let: 'orig', path: 'imageEmbedding' } },
  ],
  collapse: 'brand.name',
  rerank: { expr: 'ROUND(orig.priceMin - priceMin, 2)', top: 200 },
};
```

Same look, same kind, cheaper, another brand; one per brand; `rerank` shows the saving. Raise `minSimilarity` to 0.8 for a near twin.

### Cheaper than its look-alikes

**Say:** "same thing but cheaper", "cheaper twin"

```js
const query = {
  type: productRef,
  filter: { eq: { productType: 'LAMP' } },
  rerank: {
    expr: '1 - priceMin / stats.priceMin.median',
    top: 200,
    compare: { near: 'imageEmbedding', k: 20, minSimilarity: 0.75 },
  },
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
  type: productRef,
  filter: { matches: 'lamp' },
  sort: [{ by: 'priceMin' }],
  federation: { results: 'merged' },
};
```

Over several realms, `merged` gives one list in the query's sort; the default `byRealm` keeps each realm's rows as a section.

**Watch out:** Send it to `_federated-search` with `realms`; blend and text scores compare only approximately across realms.

_Needs a value computed first (an embedding, a saved list, or several realms), so it is checked against the grammar only._

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

**Watch out:** `order: "measure"` puts the highest first; read the list from the end for the cheapest.

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

## Adding a pattern

The patterns are generated from a case file that is also an eval: each entry carries the phrases, the query and the explanation, and the eval checks the query against the grammar and runs it. Add a pattern there rather than editing this page by hand.
