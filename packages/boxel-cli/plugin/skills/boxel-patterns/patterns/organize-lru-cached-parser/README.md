---
validated: source-proven
---

# organize-lru-cached-parser — LRU cache class for expensive parsers

**What this gives you:** A reusable `LruCache<K, V>` class for memoizing expensive pure functions — CSS color parsing, regex compilation, AST builds, anything where the same input recurs and parsing costs >1ms.

**When to use:** A parser/normalizer is called from a hot path (template, modifier, getter, computed field) and the input is a small string drawn from a bounded set. Color strings, URL parts, format strings, theme tokens.

**The insight:** JavaScript's `Map` preserves insertion order. To implement a true LRU you just `delete` + `set` on access (moves the key to the end) and `delete` the first key when over capacity. No external library, no weird linked-list code. The catalog-realm `ColorCache` uses this pattern with a 100-entry budget and falls back to canvas-based parsing for inputs it doesn't know — the cache is what makes the parse priority chain practical.

**Recipe shape:**

```ts
class LruCache<K, V> {
  constructor(private capacity: number) {}
  private map = new Map<K, V>();

  get(key: K): V | undefined {
    let v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v); // ← move to most-recent end
    return v;
  }

  set(key: K, value: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value!); // evict oldest
    }
  }
}
```

**Gotchas:**

- Only cache _pure_ functions. If your parser reads from `window` or `document` state, results drift.
- Pick capacity based on input cardinality. 100 covers ~all CSS colors a card sees. 1000 if inputs are unbounded but bounded-per-page.
- Don't share an LRU across realms unless you're sure key collisions are impossible.

**Source:** catalog-realm `fields/color-field/util/color-utils.gts:100-140` (ColorCache class), `:155-225` (parseCssColorSafe priority chain that wraps it).

**See also:** `organize-variant-field-dispatcher` (where this cache lives for the color field), `boxel/references/defensive-programming.md`.
