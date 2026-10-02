# emoji-data/ — the emoji dataset and the ported search engine

This directory is Pretui's vendoring of [emoji-picker-element][epe]. It is
**not** the usual shape: every other vendored directory in this package
(`zxcvbn/`, `sigpad/`) holds an esbuild bundle of somebody else's runtime. This one holds **data plus a port**, and no
upstream executable code at all. The reason is measured, not stylistic, and it
is recorded below because the next person to reach for a Web Component library
needs the number, not the conclusion.

|              |                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------- |
| Upstream     | [emoji-picker-element][epe] by Nolan Lawson                                                   |
| Version      | **1.29.1**                                                                                    |
| Source       | **local checkout** at `~/Projects/emoji-picker-element`, not npm                              |
| Commit       | **`5d1c8bfc21e737c03a3cb14e06b4e472e2275ff1`** (`git describe --tags` → `v1.29.1-4-g5d1c8bf`) |
| Working tree | clean at build time                                                                           |
| Licence      | **Apache-2.0** — `SPDX-License-Identifier: Apache-2.0`                                        |
| Copyright    | Copyright 2020 Nolan Lawson                                                                   |
| NOTICE       | **none exists upstream** — see "Licence and NOTICE"                                           |
| Vendored     | 2026-08-13                                                                                    |

A bundle built from an untagged commit no longer corresponds to a published
release, so **the SHA is what makes this reproducible**, not the version
number. In this instance the two happen to agree — see "The four commits" —
but that is a fact that had to be checked, not assumed.

## Contents

| File           | What it is                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `data.ts`      | The emoji dataset, trimmed and repacked. Vendored data, do not hand-edit.                                                     |
| `engine.ts`    | Search, tokenisation, skin tones and emoji-support detection, **ported** from upstream source. Our code, derived from theirs. |
| `LICENSE`      | Apache-2.0, verbatim from the emoji-picker-element checkout.                                                                  |
| `LICENSE.data` | Apache-2.0, verbatim from the emoji-picker-element-data package.                                                              |
| `LICENSE.emojibase` | MIT, verbatim from the emojibase-data package the dataset is built from.                                            |
| `LICENSE.unicode` | Unicode License V3, for the CLDR annotations in the dataset.                                                          |

The component that consumes them is `../components/emoji-picker.gts`.

## Why this is a port and not a bundle

Three hazards were tested before anything was written. The first is decisive.

### 1. The upstream bundle does not survive the indexer

The realm indexer evaluates modules outside a browser. Media Chrome vendors
cleanly because it ships `utils/server-safe-globals.js`, a deliberate SSR
affordance. **emoji-picker-element ships no such shim.** Built from the
checkout above and evaluated under plain Node:

    $ node --input-type=module -e "await import('./picker.js')"
    ReferenceError: requestAnimationFrame is not defined
        at picker.js:258:13

Shimming globals one at a time until it evaluates enumerates the full set it
touches at **module scope**:

    requestAnimationFrame, Element, HTMLElement, customElements

`customElements.define('emoji-picker', …)` runs at module scope too, so the
import is a side effect by design. A static import of that bundle anywhere in
the realm graph breaks indexing outright.

`database.js` is different and worth recording: it evaluates fine under Node.
The DOM dependency is entirely in the picker's UI layer.

### 2. IndexedDB is opened from the Database constructor

`new Database()` calls `_init()` immediately, which calls `indexedDB.open`.
Under Node the constructor returns and then `ready()` rejects:

    ReferenceError: indexedDB is not defined

IndexedDB does not exist during indexing or prerender, so any use of it would
have had to be deferred into a modifier and torn down there. **It was removed
instead.** Upstream keeps the dataset in IndexedDB _because it fetches that
dataset over the network_ — the database is a cache for a download. With the
data local there is nothing to cache: `engine.ts` builds an in-memory index in
one pass over 1,923 emoji, which is faster than the round trip it replaces and
has no lifecycle to get wrong. Hazard 2 is not mitigated, it is deleted.

### 3. The data was fetched from a CDN at runtime

Upstream's default `dataSource` is
`https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/en/emojibase/data.json`,
with ETag revalidation on every load. That is the same defect being removed
from the QR component: it breaks offline, it is a supply-chain exposure, and it
pins the kit to a third party's uptime. The dataset is now local and **no code
path in this directory or in `emoji-picker.gts` performs a network request.**

### And the theming surface would not have reached Pretui anyway

Even had all three resolved, the picker's controls arrive inside its own shadow
root with **27 documented CSS custom properties and zero slots**. Reachable:
colours, focus outline, emoji size, column count, a few radii. Not reachable:
any font-family for the UI text (so Appendix J's type spec cannot land), any
shadow (so Law 1's hairline-plus-shadow cannot land — upstream separates with
`--border-color`, which Law 1 forbids), per-control radii, spacing, the nav
treatment, or any structural substitution (Law 7 wants slots, and there are
none). It also carries `@media (prefers-color-scheme: dark)` **inside its
shadow root**, which fights ThemeFrame: a Pretui dark frame on a light OS
renders a light picker. Outer-tree declarations do beat `:host` rules, so all
27 could be restated — but restating 27 properties to defeat a dark branch,
around a UI that still could not take our typography or our depth model, is not
a theming surface. It is a fight.

## The four commits

The local checkout is four commits ahead of the `v1.29.1` tag. All four are
dev-dependency bumps and the **entire diff is `pnpm-lock.yaml`** (27 insertions,
28 deletions); `git diff v1.29.1..HEAD -- src/ bin/ config/ package.json
rollup.config.js` is empty. Building both and comparing confirms it:

    picker.js    sha256 2509a2b0…  identical from checkout and from npm 1.29.1
    database.js  sha256 4433d01e…  identical from checkout and from npm 1.29.1

So for this package the checkout carried no fix that npm lacked. That is the
opposite of what was found for Media Chrome, which is exactly why the check is
worth running every time rather than reasoning about it.

## Licence and NOTICE

Both packages are **Apache-2.0**, verified from their own `LICENSE` files
(each ends `Copyright 2020 Nolan Lawson`), copied here verbatim as `LICENSE`
and `LICENSE.data`.

**Neither package ships a `NOTICE` file.** Checked in the local checkout, in
the `emoji-picker-element-1.29.1` tarball and in the
`emoji-picker-element-data-1.8.0` tarball. Apache-2.0 §4(d) therefore imposes
no obligation here; had one existed it would have had to travel with this copy.
§4(a) (carry the licence) and §4(b) (mark modified files as changed) are
satisfied by the two `LICENSE` copies plus the headers of `data.ts` and
`engine.ts`, which name the upstream, the commit, the SPDX id and what was
changed. Apache-2.0 also carries a **patent grant** (§3), which is a reason to
prefer it, not a burden.

Upstream data chain: `emoji-picker-element-data` 1.8.0 (Apache-2.0) is built
from `emojibase-data` 17.0.0 (MIT), whose annotations originate in **Unicode
CLDR** (Unicode License V3). Both notices ship here too: `LICENSE.emojibase`
is verbatim from the `emojibase-data@17.0.0` npm package, and
`LICENSE.unicode` is verbatim from <https://www.unicode.org/license.txt>.

## The dataset

Source file: `emoji-picker-element-data@1.8.0`, `en/emojibase/data.json` —
the English dataset with Emojibase shortcodes. `emoji-picker-element-data` is
already the pre-trimmed distribution, which is why upstream's own
`trimEmojiData.js` is deprecated and is **not** used here; the trimming below
goes further than that tool did.

**1,923 emoji.** Sizes, measured:

|                                                    | raw       | gzip         |
| -------------------------------------------------- | --------- | ------------ |
| upstream `data.json`, as the CDN serves it         | 439,662 B | 72,049 B     |
| trimmed, tokens precomputed (what we ship)         | 267,022 B | **59,224 B** |
| `data.ts` as written, incl. the JS string escaping | 330,040 B | 61,936 B     |

Two denser encodings were built and rejected on measurement: a shared token
dictionary with integer references (252,620 B raw but **70,037 B gzip**) and a
columnar delimiter-packed form (232,621 B raw, 66,486 B gzip). Both shrink the
raw bytes and _inflate_ the compressed bytes, because gzip already exploits the
repetition that the dictionary was replacing — and both cost a decode step. The
simplest encoding is also the smallest on the wire.

**It is loaded lazily.** `EmojiIndex.load()` is the only reference to `./data`
anywhere in the kit and it is a dynamic `import()`, so nothing pays 59 KB until
a picker is actually opened — the same rule, for the same reason, as
`loadPasswordEstimator` in `password-strength.gts`. Keep it that way or the
dataset joins the static graph and the laziness evaporates.

Worth being precise about _why_ it is lazy: not for safety. `data.ts` is pure
JSON and touches no DOM, so it would survive the indexer even as a static
import. Laziness here is purely a payload decision.

### Field shape

Single-letter keys, purely to keep the payload down:

    u  unicode
    a  annotation — the CLDR name, used as the accessible name
    g  group (0-9)
    o  order — sort key within a group, and the search result order
    v  emoji version the codepoint was introduced in
    t  search tokens, precomputed
    s  skin-tone variants keyed by tone 1-5, as [unicode, version]

`t` is produced by upstream's own `extractTokens` + `normalizeTokens` over
shortcodes, tags, annotation and emoticon — the same transform
`transformEmojiData.js` applies before writing to IndexedDB. Those two
functions are ported into `engine.ts` **and must stay behaviourally identical
to the generator**, or queries stop matching the index. If you change one,
regenerate the data.

Group 2 ("component" — skin-tone and hair modifiers, 9 entries) is excluded
from the category list and from search results: they are modifiers, not
pickable emoji. Upstream leaves them searchable.

### Regenerating

Reproduces `data.ts` byte-for-byte from the two inputs above.

```js
// gen.mjs — run with: node gen.mjs
import { readFileSync, writeFileSync } from 'node:fs';

// npm pack emoji-picker-element-data@1.8.0 && tar xzf *.tgz
const raw = JSON.parse(
  readFileSync('./package/en/emojibase/data.json', 'utf8'),
);

// ── verbatim from emoji-picker-element src/database/utils/extractTokens.js
const irregularEmoticons = new Set([
  ':D',
  'XD',
  ":'D",
  'O:)',
  ':X',
  ':P',
  ';P',
  'XP',
  ':L',
  ':Z',
  ':j',
  '8D',
  'XO',
  '8)',
  ':B',
  ':O',
  ':S',
  ":'o",
  'Dx',
  'X(',
  'D:',
  ':C',
  '>0)',
  ':3',
  '</3',
  '<3',
  '\\M/',
  ':E',
  '8#',
]);
const extractTokens = (str) =>
  str
    .split(/[\s_]+/)
    .map((word) => {
      if (!word.match(/\w/) || irregularEmoticons.has(word))
        return word.toLowerCase();
      return word
        .replace(/[)(:,]/g, '')
        .replace(/\u2019/g, "'")
        .toLowerCase();
    })
    .filter(Boolean);
const normalizeTokens = (arr) =>
  arr
    .filter(Boolean)
    .map((_) => _.toLowerCase())
    .filter((_) => _.length >= 2);

const trimmed = raw.map(
  ({
    annotation,
    emoticon,
    group,
    order,
    shortcodes,
    skins,
    tags,
    emoji,
    version,
  }) => {
    const t = [
      ...new Set(
        normalizeTokens([
          ...(shortcodes || []).map(extractTokens).flat(),
          ...(tags || []).map(extractTokens).flat(),
          ...extractTokens(annotation),
          emoticon,
        ]),
      ),
    ].sort();
    const o = { u: emoji, a: annotation, g: group, o: order, v: version, t };
    if (skins) {
      const s = {};
      for (const sk of skins)
        if (typeof sk.tone === 'number') s[sk.tone] = [sk.emoji, sk.version];
      if (Object.keys(s).length) o.s = s;
    }
    return o;
  },
);

// JSON.stringify twice: once for the payload, once to make it a valid,
// fully escaped JS string literal.
writeFileSync(
  './data.ts',
  HEADER +
    '\nconst PACKED =\n  ' +
    JSON.stringify(JSON.stringify(trimmed)) +
    ';\n' +
    FOOTER,
);
```

`HEADER` / `FOOTER` are the doc comment, the `PackedEmoji` interface and the
memoised `emojiData()` accessor — copy them from the top and bottom of the
current `data.ts`.

## What was ported into `engine.ts`, and what changed

| Ported               | From                                                                            | Changed                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractTokens`      | `src/database/utils/extractTokens.js`                                           | nothing — must match the generator                                                                                                                                                           |
| `normalizeTokens`    | `src/database/utils/normalizeTokens.js`                                         | nothing                                                                                                                                                                                      |
| `applySkinTone`      | `src/picker/utils/applySkinTone.js`                                             | nothing                                                                                                                                                                                      |
| search + ranking     | `src/database/idbInterface.js` `getEmojiBySearchQuery`                          | IDB key ranges → a `Map` plus a sorted-token binary search; ranking rules unchanged                                                                                                          |
| result intersection  | `src/database/utils/findCommonMembers.js`                                       | `Set` membership instead of `findIndex`, i.e. O(n) not O(n·m)                                                                                                                                |
| version gating       | `src/picker/utils/summarizeEmojisForUI.js`                                      | unchanged, incl. gating each skin variant separately                                                                                                                                         |
| `detectSupportLevel` | `src/picker/utils/determineEmojiSupportLevel.js` + `testColorEmojiSupported.js` | runs synchronously in a modifier instead of behind `requestIdleCallback`; there is no longer an IndexedDB population to stay off the critical path for, and the realm forbids unowned timers |
| version test table   | `bin/versionsAndTestEmoji.js`                                                   | unchanged                                                                                                                                                                                    |
| category list        | `src/picker/groups.js`                                                          | custom-emoji group dropped; a recents pseudo-group added                                                                                                                                     |

The ranking rules that were kept deliberately, because they are the part that
took real work and are easy to get wrong: every query token but the last must
match **exactly**, the last token is a **prefix** match so results narrow as
you type, tokens are **ANDed**, and results come back in dataset `order`
(Unicode's own ordering) rather than by relevance score.

### Not ported: the ZWJ glyph-width check

Upstream also measures the rendered width of every ZWJ emoji against a baseline
and hides any that come out ≥1.8× too wide — the ones a font draws as two
glyphs ("person with red hair" as a person plus a floating wig). Emoji versions
12.1, 13.1 and 15.1 are compound-only and can be caught **no other way**, since
they pass a colour test.

It is not ported because it is a layout-thrashing measure pass over every
rendered cell, and because a `Range`-based width read per emoji is the kind of
thing that turns a 388-cell category into a jank source. The cheap half — canvas
colour detection of the font's version level — **is** ported, and removes the
bulk of the tofu. The residue is a small number of compound emoji on older
fonts rendering as two glyphs rather than being hidden. Named here rather than
hidden, per Law 7; if it ever matters, the upstream implementation is
`src/picker/utils/checkZwjSupport.js` and it wants an `IntersectionObserver` so
it only measures what is on screen.

## Traps

- **`engine.ts` must never import `./data` for a value.** `import type` only.
  A value import puts 330 KB in the static graph.
- **`detectSupportLevel` is browser-only.** It needs a canvas. Call it from a
  modifier, never from a getter the indexer might evaluate.
- **Do not "fix" the tokeniser without regenerating `data.ts`.** The tokens in
  the dataset were produced by the same code; drift silently breaks search.
- **Do not add a `dataSource` arg.** It would reintroduce the runtime fetch
  that this whole directory exists to remove.

[epe]: https://github.com/nolanlawson/emoji-picker-element
