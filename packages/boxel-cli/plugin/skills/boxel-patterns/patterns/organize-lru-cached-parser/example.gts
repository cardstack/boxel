// 🧩 PATTERN: LRU cache for expensive pure parsers
//
// JavaScript's Map preserves insertion order. delete + set moves keys to the
// "most recent" end on access; delete-first evicts the oldest.

export class LruCache<K, V> {
  private map = new Map<K, V>();
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    let v = this.map.get(key);
    if (v === undefined) return undefined;
    // 🎯 Move to most-recent position.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      // 🎯 Evict oldest = first key in insertion order.
      this.map.delete(this.map.keys().next().value!);
    }
  }

  has(key: K) {
    return this.map.has(key);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}

// === Usage: CSS color parser with cache ===============================

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const COLOR_CACHE = new LruCache<string, RGBA | null>(100);
const DEFAULT_RGBA: RGBA = { r: 0, g: 0, b: 0, a: 1 };

export function parseCssColorSafe(input: string): RGBA {
  let cached = COLOR_CACHE.get(input);
  if (cached !== undefined) return cached ?? DEFAULT_RGBA;

  let result =
    tryHex(input) ??
    tryRgb(input) ??
    tryHsl(input) ??
    tryNamed(input) ??
    tryViaBrowser(input); // canvas fallback

  COLOR_CACHE.set(input, result);
  return result ?? DEFAULT_RGBA;
}

// ⚠️ Pseudocode — real parsers in the catalog-realm.
function tryHex(s: string): RGBA | null {
  void s;
  return null;
}
function tryRgb(s: string): RGBA | null {
  void s;
  return null;
}
function tryHsl(s: string): RGBA | null {
  void s;
  return null;
}
function tryNamed(s: string): RGBA | null {
  void s;
  return null;
}
function tryViaBrowser(s: string): RGBA | null {
  void s;
  return null;
}
