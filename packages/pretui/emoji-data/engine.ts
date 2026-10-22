/**
 * Emoji search / skin-tone / support-level engine.
 *
 * This is a PORT, not a vendored bundle. The algorithms below are derived from
 * emoji-picker-element (https://github.com/nolanlawson/emoji-picker-element),
 * Copyright 2020 Nolan Lawson, licensed Apache-2.0
 * (SPDX-License-Identifier: Apache-2.0 — see LICENSE in this directory).
 * Ported from the local checkout at commit 5d1c8bf (v1.29.1-4-g5d1c8bf).
 *
 * Each ported function names its upstream source file. What changed, and why,
 * is recorded in this directory's README.md — the short version is that
 * upstream stores the dataset in IndexedDB because it fetches that dataset over
 * the network at runtime. Neither is available to us: IndexedDB does not exist
 * during realm indexing, and a runtime CDN fetch inside a realm module is a
 * supply-chain and offline defect. With the data local, an in-memory index is
 * strictly simpler AND faster than the IndexedDB round trip it replaces.
 *
 * NOTHING in this module touches the DOM at module scope. `detectSupportLevel`
 * is the only browser-only export and it must be called from a modifier.
 */

// TYPE-ONLY. A value import here would drag 330 KB of emoji into the static
// module graph and undo the laziness that `EmojiIndex.load` exists to provide.
// `import type` is erased at compile time, so this line costs nothing.
import type { PackedEmoji } from './data';

/** One emoji, in the shape the UI consumes. */
export interface Emoji {
  /** The emoji itself, with no skin tone applied. */
  unicode: string;
  /** The CLDR annotation, e.g. "grinning face". This is the accessible name. */
  annotation: string;
  /** Emojibase group id, 0-9. */
  group: number;
  /** Sort key within a group; also the search-result order. */
  order: number;
  /** Emoji version this codepoint was introduced in. */
  version: number;
  /** Skin-tone variants by tone 1-5, present only for emoji that have them. */
  skins?: Record<number, string>;
}

export interface EmojiGroup {
  id: number;
  /** Stable machine key, used for test selectors and caller overrides. */
  key: string;
  /** A representative emoji for the category tab. */
  sample: string;
  /** Human label — the accessible name of the category tab. */
  label: string;
}

/**
 * Category list and order.
 * Ported from src/picker/groups.js. Group 2 ("component") is intentionally
 * absent upstream and here: it holds skin-tone modifiers, which are not
 * pickable on their own.
 */
export const EMOJI_GROUPS: readonly EmojiGroup[] = Object.freeze([
  { id: 0, key: 'smileys-emotion', sample: '\u{1F600}', label: 'Smileys and emoticons' },
  { id: 1, key: 'people-body', sample: '\u{1F44B}', label: 'People and body' },
  { id: 3, key: 'animals-nature', sample: '\u{1F431}', label: 'Animals and nature' },
  { id: 4, key: 'food-drink', sample: '\u{1F34E}', label: 'Food and drink' },
  { id: 5, key: 'travel-places', sample: '\u{1F3E0}\u{FE0F}', label: 'Travel and places' },
  { id: 6, key: 'activities', sample: '\u26BD', label: 'Activities' },
  { id: 7, key: 'objects', sample: '\u{1F4DD}', label: 'Objects' },
  { id: 8, key: 'symbols', sample: '\u26D4\u{FE0F}', label: 'Symbols' },
  { id: 9, key: 'flags', sample: '\u{1F3C1}', label: 'Flags' },
]);

/** Human labels for the six skin tones, index 0 = no tone applied. */
export const SKIN_TONE_LABELS: readonly string[] = Object.freeze([
  'Default',
  'Light',
  'Medium-light',
  'Medium',
  'Medium-dark',
  'Dark',
]);

/** The emoji whose skin-tone variants are shown in the tone chooser. */
export const SKIN_TONE_SAMPLE = '\u{1F590}\u{FE0F}';

/** Shortest query we will search on. Ported from src/shared/constants.js. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * Emojibase group 2, "component": the five skin-tone modifiers and the hair
 * components. Upstream excludes it from the category nav but leaves its nine
 * entries in the database, so they can still come back from a search — and
 * inserting a bare skin-tone modifier into a message is never what anyone
 * meant. They are dropped from the index entirely here.
 */
const COMPONENT_GROUP = 2;

/**
 * Emoticons that a plain `\W+` split would mangle.
 * Ported verbatim from src/database/utils/extractTokens.js.
 */
const IRREGULAR_EMOTICONS = new Set([
  ':D', 'XD', ":'D", 'O:)', ':X', ':P', ';P', 'XP', ':L', ':Z', ':j', '8D',
  'XO', '8)', ':B', ':O', ':S', ":'o", 'Dx', 'X(', 'D:', ':C', '>0)', ':3',
  '</3', '<3', '\\M/', ':E', '8#',
]);

/**
 * Split a string into search tokens.
 * Ported verbatim from src/database/utils/extractTokens.js — this must stay
 * byte-identical in behaviour to the function that produced the `t` arrays in
 * data.ts, or queries stop matching the index.
 */
export function extractTokens(str: string): string[] {
  return str
    .split(/[\s_]+/)
    .map((word) => {
      if (!word.match(/\w/) || IRREGULAR_EMOTICONS.has(word)) {
        // Pure emoticons like :) or :-) are left as-is.
        return word.toLowerCase();
      }
      return word
        .replace(/[)(:,]/g, '')
        .replace(/\u2019/g, "'")
        .toLowerCase();
    })
    .filter(Boolean);
}

/**
 * Lowercase and drop tokens below the minimum length.
 * Ported verbatim from src/database/utils/normalizeTokens.js.
 */
export function normalizeTokens(tokens: string[]): string[] {
  return tokens
    .filter(Boolean)
    .map((_) => _.toLowerCase())
    .filter((_) => _.length >= MIN_SEARCH_LENGTH);
}

const VARIATION_SELECTOR = '\uFE0F';
const SKINTONE_MODIFIER = '\uD83C';
const ZWJ = '\u200D';
const LIGHT_SKIN_TONE = 0x1f3fb;
const LIGHT_SKIN_TONE_MODIFIER = 0xdffb;

/**
 * Apply a skin tone to an emoji that has no data-provided variant.
 * Ported verbatim from src/picker/utils/applySkinTone.js, including its
 * acknowledged naivety: it is only used for the tone chooser's own swatches,
 * where the input is a single known emoji. Real emoji get their variants from
 * the dataset's `skins`, which is authoritative.
 */
export function applySkinTone(str: string, skinTone: number): string {
  if (skinTone === 0) {
    return str;
  }
  const zwjIndex = str.indexOf(ZWJ);
  if (zwjIndex !== -1) {
    return (
      str.substring(0, zwjIndex) +
      String.fromCodePoint(LIGHT_SKIN_TONE + skinTone - 1) +
      str.substring(zwjIndex)
    );
  }
  let base = str;
  if (base.endsWith(VARIATION_SELECTOR)) {
    base = base.substring(0, base.length - 1);
  }
  return base + SKINTONE_MODIFIER + String.fromCodePoint(LIGHT_SKIN_TONE_MODIFIER + skinTone - 1);
}

/**
 * Resolve the unicode to render for an emoji at a given tone. Prefers the
 * dataset's own variant (correct for multi-person and ZWJ emoji, which
 * `applySkinTone` cannot handle) and falls back to nothing — an emoji with no
 * variant for this tone simply renders untoned, which is what upstream does.
 */
export function toneOf(emoji: Emoji, skinTone: number): string {
  if (!skinTone || !emoji.skins) {
    return emoji.unicode;
  }
  return emoji.skins[skinTone] || emoji.unicode;
}

/**
 * One representative emoji per emoji version, newest first.
 * Ported verbatim from bin/versionsAndTestEmoji.js, including its reasoning:
 * versions 12.1/13.1/15.1 hold only compound emoji built from earlier ones, so
 * a colour test cannot distinguish them — upstream filters those with a glyph
 * width test instead. See the README for why we do not.
 */
const VERSION_TEST_EMOJI: ReadonlyArray<readonly [string, number]> = Object.freeze([
  ['\u{1FAEA}', 17],
  ['\u{1FAE9}', 16],
  ['\u{1FAE8}', 15.1],
  ['\u{1FAE0}', 14],
  ['\u{1F972}', 13.1],
  ['\u{1F97B}', 12.1],
  ['\u{1F970}', 11],
  ['\u{1F929}', 5],
  ['\u{1F471}\u200D\u2640\u{FE0F}', 4],
  ['\u{1F923}', 3],
  ['\u{1F441}\u{FE0F}\u200D\u{1F5E8}\u{FE0F}', 2],
  ['\u{1F600}', 1],
  ['\u{1F610}\u{FE0F}', 0.7],
  ['\u{1F603}', 0.6],
]);

/** The font stack that actually carries colour emoji, ported from src/picker/constants.js. */
export const EMOJI_FONT_FAMILY =
  '"Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol",' +
  '"Noto Color Emoji","EmojiOne Color","Android Emoji",sans-serif';

/**
 * Render one emoji to a 1x1 canvas in two colours and check it came out the
 * same non-black colour both times — i.e. the font drew a colour glyph rather
 * than a tofu box or a monochrome fallback.
 * Ported from src/picker/utils/testColorEmojiSupported.js.
 * BROWSER ONLY.
 */
function colorEmojiSupported(text: string): boolean {
  const feature = (color: string): Uint8ClampedArray | undefined => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return undefined;
    }
    ctx.textBaseline = 'top';
    ctx.font = `100px ${EMOJI_FONT_FAMILY}`;
    ctx.fillStyle = color;
    ctx.scale(0.01, 0.01);
    ctx.fillText(text, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data;
  };

  const a = feature('#000');
  const b = feature('#fff');
  if (!a || !b) {
    return false;
  }
  const aStr = [...a].join(',');
  const bStr = [...b].join(',');
  // RGBA. Unsupported is usually 0,0,0,0 — but Chrome on macOS gives 0,0,0,61,
  // so test the prefix rather than the whole tuple.
  return aStr === bStr && !aStr.startsWith('0,0,0,');
}

/**
 * Highest emoji version this browser's font can actually draw.
 * Ported from src/picker/utils/determineEmojiSupportLevel.js.
 *
 * BROWSER ONLY — call this from a modifier, never a getter. Upstream defers it
 * behind `requestIdleCallback` to stay off the critical path while IndexedDB
 * populates; we have no IndexedDB to wait for and the whole check is fourteen
 * 1x1 canvas draws, so it runs synchronously and no timer is involved.
 *
 * Returns the newest known version on any failure, because showing a few grey
 * boxes beats hiding most of the dataset from someone whose browser blocks
 * canvas readback for fingerprinting reasons.
 */
export function detectSupportLevel(): number {
  const newest = VERSION_TEST_EMOJI[0]![1];
  try {
    for (const [emoji, version] of VERSION_TEST_EMOJI) {
      if (colorEmojiSupported(emoji)) {
        return version;
      }
    }
  } catch {
    return newest;
  }
  return newest;
}

/** Lower bound: first index in `sorted` whose value is >= `target`. */
function lowerBound(sorted: string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * In-memory replacement for upstream's IndexedDB object store plus its
 * `tokens`, `group-order` and `skinUnicodes` indexes.
 *
 * Built once per browser session from the local dataset. Construction is a
 * single pass over 1,923 emoji; there is no async work, no storage, and
 * nothing to tear down — which is the whole point of hazard 2 going away.
 */
export class EmojiIndex {
  /** Every emoji, in dataset order. */
  readonly all: readonly Emoji[];
  /** Highest emoji version to show. Anything newer is filtered out. */
  readonly supportLevel: number;

  #byGroup = new Map<number, Emoji[]>();
  #byToken = new Map<string, Emoji[]>();
  #sortedTokens: string[] = [];
  #byUnicode = new Map<string, Emoji>();

  constructor(packed: readonly PackedEmoji[], supportLevel: number) {
    this.supportLevel = supportLevel;

    const all: Emoji[] = [];
    for (const p of packed) {
      if (p.v > supportLevel) {
        continue; // the browser's font cannot draw it — upstream drops these too
      }
      if (p.g === COMPONENT_GROUP) {
        continue; // a modifier, not a pickable emoji
      }
      const emoji: Emoji = {
        unicode: p.u,
        annotation: p.a,
        group: p.g,
        order: p.o,
        version: p.v,
      };
      if (p.s) {
        const skins: Record<number, string> = {};
        for (const [tone, variant] of Object.entries(p.s)) {
          // Variants can carry a NEWER version than their base emoji, so they
          // need the same gate. This is why upstream filters per skin, not per
          // emoji, in summarizeEmojisForUI.js.
          if (variant[1] <= supportLevel) {
            skins[Number(tone)] = variant[0];
          }
        }
        if (Object.keys(skins).length) {
          emoji.skins = skins;
        }
      }
      all.push(emoji);

      this.#byUnicode.set(p.u, emoji);

      let group = this.#byGroup.get(p.g);
      if (!group) {
        this.#byGroup.set(p.g, (group = []));
      }
      group.push(emoji);

      for (const token of p.t) {
        let bucket = this.#byToken.get(token);
        if (!bucket) {
          this.#byToken.set(token, (bucket = []));
        }
        bucket.push(emoji);
      }
    }

    for (const group of this.#byGroup.values()) {
      group.sort((a, b) => a.order - b.order);
    }
    // Sorted token list backs the prefix search that upstream gets from an
    // IDBKeyRange.bound(token, token + '\uffff') on its `tokens` index.
    this.#sortedTokens = [...this.#byToken.keys()].sort();

    this.all = Object.freeze(all);
  }

  /**
   * Load the dataset and build the index.
   *
   * The `import()` is dynamic and is the ONLY reference to `./data` anywhere
   * in the kit — keep it that way or the dataset joins the static graph and
   * the laziness evaporates. (Same rule, same reason, as
   * `loadPasswordEstimator` in password-strength.gts.)
   *
   * There is no network call here and none may be added: the whole point of
   * vendoring the dataset was to remove the runtime CDN fetch that upstream
   * does. `import()` resolves against the realm, and works offline.
   */
  static async load(supportLevel: number): Promise<EmojiIndex> {
    let mod = await import('./data.ts');
    return new EmojiIndex(mod.emojiData(), supportLevel);
  }

  /** All emoji in a category, in dataset order. */
  byGroup(group: number): readonly Emoji[] {
    return this.#byGroup.get(group) || [];
  }

  /** Look up a single emoji by its exact unicode. Used to rehydrate the
   * recently-used list, which persists unicode strings and nothing else. */
  byUnicode(unicode: string): Emoji | undefined {
    return this.#byUnicode.get(unicode);
  }

  /** Every emoji whose token set contains `token` exactly. */
  #exact(token: string): readonly Emoji[] {
    return this.#byToken.get(token) || [];
  }

  /** Every emoji with at least one token starting with `prefix`. */
  #prefix(prefix: string): readonly Emoji[] {
    const start = lowerBound(this.#sortedTokens, prefix);
    const seen = new Set<string>();
    const results: Emoji[] = [];
    for (let i = start; i < this.#sortedTokens.length; i++) {
      const token = this.#sortedTokens[i]!;
      if (!token.startsWith(prefix)) {
        break;
      }
      for (const emoji of this.#byToken.get(token)!) {
        if (!seen.has(emoji.unicode)) {
          seen.add(emoji.unicode);
          results.push(emoji);
        }
      }
    }
    return results;
  }

  /**
   * Search.
   *
   * Ported from src/database/idbInterface.js `getEmojiBySearchQuery`, keeping
   * the ranking decisions that make it good and are easy to get wrong:
   *
   * - the query is tokenized with the SAME function that built the index;
   * - every token but the last must match EXACTLY, so "flag" does not drag in
   *   "flagship" when the user has already moved on to a second word;
   * - the LAST token is a prefix match, so results narrow as you type rather
   *   than vanishing between words;
   * - tokens are ANDed, not ORed — intersection, not union;
   * - results come back in dataset `order`, which is Unicode's own ordering,
   *   so the common emoji in a category surface first.
   *
   * Returns [] for a query with no usable token, which is what keeps a bare
   * "a" from returning the whole dataset.
   */
  search(query: string): readonly Emoji[] {
    const tokens = normalizeTokens(extractTokens(query));
    if (!tokens.length) {
      return [];
    }

    const perToken: readonly Emoji[][] = tokens.map((token, i) =>
      i === tokens.length - 1 ? [...this.#prefix(token)] : [...this.#exact(token)],
    );

    // Intersect, walking the shortest list.
    // Ported from src/database/utils/findCommonMembers.js.
    let shortest = perToken[0]!;
    for (const list of perToken) {
      if (list.length < shortest.length) {
        shortest = list;
      }
    }
    const others = perToken.filter((list) => list !== shortest);
    const otherSets = others.map((list) => new Set(list.map((_) => _.unicode)));

    const results = shortest.filter((emoji) => otherSets.every((set) => set.has(emoji.unicode)));
    return results.sort((a, b) => a.order - b.order);
  }
}
