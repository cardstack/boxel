# zxcvbn/ — password strength estimation, vendored

`index.js` is [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn) — the modern
modular rewrite of Dropbox's zxcvbn — bundled to a single self-contained ES
module. Licence **MIT** (SPDX **`MIT`**), verified from the upstream
`LICENSE.txt` in the checkout below, copied here as `LICENSE`.

## Provenance — where these exact bytes came from

|                                  |                                                      |
| -------------------------------- | ---------------------------------------------------- |
| **Source**                       | the **local `zxcvbn-ts` monorepo checkout**, not npm |
| **Commit**                       | `642ef8f0c40d8267e9fc2d4de29ab2691e87a10e`           |
| **Working tree**                 | clean at build time (`git status --porcelain` empty) |
| **`git describe --tags --long`** | `@zxcvbn-ts/core@4.2.0-0-g642ef8f`                   |
| **Vendored**                     | 2026-08-13                                           |
| **SPDX**                         | `MIT`                                                |

The `-0-` in the describe output means HEAD **is** the tagged commit, so this
bundle does correspond to a published release rather than to an untagged
working state. That is the good case. The tradeoff to know for next time: a
bundle built from an _untagged_ commit no longer matches any release, and then
the SHA is the only thing that makes it reproducible — which is why the SHA is
recorded here regardless.

It is a monorepo with independently versioned packages, so there is no single
"zxcvbn-ts version". Per package, read from each `package.json` in that
checkout:

| package                      | version   | role                                                                |
| ---------------------------- | --------- | ------------------------------------------------------------------- |
| `@zxcvbn-ts/core`            | **4.2.0** | matchers, scoring, feedback, time estimates                         |
| `@zxcvbn-ts/language-common` | **4.1.3** | shared password / diceware lists, keyboard adjacency graphs         |
| `@zxcvbn-ts/language-en`     | **4.1.1** | English words, first names, surnames, Wikipedia terms, translations |

**Two runtime dependencies came from npm, not the checkout** — a stated
fallback, because the monorepo checkout carries no `node_modules` and neither
package is vendored inside it:

| package                             | version    | why                                                                                                                               |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fastest-levenshtein`               | **1.0.16** | required by `core/src/utils/levenshtein.ts`; the version is `core`'s own exact pin, not a range resolution                        |
| `@zxcvbn-ts/dictionary-compression` | **3.0.1**  | build-time `compress` + the `decompress` shipped in the bundle; upstream's own `scripts/rollup.config.mjs` treats it the same way |

Build tooling from npm: `esbuild` **0.28.2**. Every line of zxcvbn itself is
from the checkout.

Because `--legal-comments=none` strips the inline notices, the MIT notice
clause is satisfied by the `LICENSE` file here plus the banner at the top of
`index.js` — the same arrangement `media-chrome/` uses.

## Dictionary data — exactly what is in here

This is the bulk of the bundle and the part most likely to need regenerating,
so it is itemised. All of it is the `src/*.json` in the checkout, compressed at
build time (see below); raw sizes are the on-disk JSON in the checkout.

| pack              | file                   | raw                               |
| ----------------- | ---------------------- | --------------------------------- |
| `language-common` | `passwords.json`       | 476 KB                            |
| `language-common` | `diceware.json`        | 76 KB                             |
| `language-common` | `adjacencyGraphs.json` | 16 KB                             |
| `language-en`     | `lastnames.json`       | 856 KB                            |
| `language-en`     | `commonWords.json`     | 548 KB                            |
| `language-en`     | `wikipedia.json`       | 328 KB                            |
| `language-en`     | `firstnames.json`      | 44 KB                             |
| `language-en`     | `wordSequences.json`   | 4 KB                              |
| `language-en`     | `translations.ts`      | the feedback strings the UI shows |

**No other language pack is included and none should be** — the checkout ships
about twenty more and each is another half-megabyte. Adding one means editing
`lean.ts` to merge its `dictionary` into the factory, and re-measuring.

## Size — this is the whole design constraint

    index.js        1,670,255 bytes  (1.59 MiB) minified
                      859,084 bytes  (839 KiB)  gzipped
    module eval     ~220 ms in Node, dominated by dictionary decompression

That is roughly six times the vendored Observable Plot bundle. **It must never
be on a component's static import graph.** `password-strength.gts` reaches it
through `await import('./zxcvbn/index.js')` behind a cached promise, so
`PasswordInput` renders, accepts input and submits with the bundle untouched;
the first keystroke under `@strength={{true}}` is what fetches it.

Dictionary compression is applied at build time exactly as upstream's
`scripts/jsonPlugin.mjs` does it (array-valued JSON → `compress()` → a
`decompress()` call at module scope). Without it the same bundle is 2,437,587
bytes / 989 KB gzipped, so the compression is worth keeping even though it
costs the ~220 ms of eval above.

## Exports — one function, deliberately

```ts
estimate(password: string, userInputs?: (string | number)[]): PasswordEstimate
// { score, warning, suggestions, guessesLog10, crackTime }
```

The raw `ZxcvbnResult` is **not** exported. It carries `sequence`, an array of
the matched _substrings of the password_ — the shortest path from "we added a
strength meter" to a password in a DOM node or a log line. Reducing at the
bundle boundary means no consumer can reach it. `userInputs` is the argument
that matters most: pass the user's name, email and handle and "chris1985"
stops reading as strong.

Types live in `index.d.ts` beside the bundle so `import()` type-resolves.

## Two vendor patches, both about realm determinism

Upstream reads the wall clock twice. A realm forbids that (indexing
determinism), so both are patched in the build tree before bundling and the
patched lines carry a `PRETUI VENDOR PATCH` comment:

- `libraries/main/src/index.ts` — `const time = () => new Date().getTime()`
  becomes `() => 0`. It only feeds `calcTime` on the result, which is not part
  of the exported surface.
- `libraries/main/src/data/const.ts` — `REFERENCE_YEAR = new Date().getFullYear()`
  is **module scope**, so it would read the clock during indexing. Frozen to
  `2026`. It only affects how "recent" a year inside a password is judged;
  **bump it when re-vendoring.**

Audited in the shipped bundle: **0** `Date.now`, **0** `new Date`, **0**
`Math.random`, **0** `setTimeout`/`setInterval`/`requestAnimationFrame`, **0**
`document.`/`window.`, **0** network calls. Estimation is entirely local and
must stay that way.

Not exported for the same reason: upstream's `debounce` helper, which owns an
unowned `setTimeout`. The debounce that ships is `OneShotDebounce` in
`password-strength.gts`, owned by an `ember-modifier` that cancels it in its
destructor.

## Build

From a scratch tree holding `npm i esbuild@0.28.2 fastest-levenshtein@1.0.16
@zxcvbn-ts/dictionary-compression@3.0.1` plus copies of three `src/`
directories taken from the checkout at the commit above —
`packages/libraries/main/src` → `src/core`, `packages/languages/common/src` →
`src/common`, `packages/languages/en/src` → `src/en` — with the two patches
above applied, and `lean.ts` (the entry reproduced below):

```
esbuild lean.ts --bundle --format=esm --minify --line-limit=500 \
  --legal-comments=none --banner:js="<licence banner>" --outfile=index.js
```

plus an `onLoad` plugin for `/\.json$/` that mirrors upstream's
`scripts/jsonPlugin.mjs`. Without that plugin the dictionaries bundle raw.

`lean.ts`:

```ts
import { ZxcvbnFactory } from './src/core/index';
import { dictionary as common, adjacencyGraphs } from './src/common/index';
import { dictionary as en, translations } from './src/en/index';

const factory = new ZxcvbnFactory({
  dictionary: { ...common, ...en },
  graphs: adjacencyGraphs,
  translations,
});

export function estimate(password, userInputs = []) {
  const r = factory.check(password, userInputs);
  return {
    score: r.score,
    warning: r.feedback.warning ?? '',
    suggestions: r.feedback.suggestions ?? [],
    guessesLog10: r.guessesLog10,
    crackTime: String(
      r.crackTimes?.offlineSlowHashingXPerSecond?.display ?? '',
    ),
  };
}
```

Note `crackTimes[scenario].display` — the shape is not `crackTimesDisplay`,
which is what the v3 docs suggest and what silently returns `undefined`.

## Two things to know before using it

- **Import is DOM-free and the module evaluates cleanly under plain Node** —
  verified — so it cannot break indexing wherever it lands in the graph. It is
  still lazily imported, for weight, not for safety.
- **Estimation is advice, never a gate.** Current NIST 800-63B guidance is that
  composition rules are counterproductive and that length plus
  not-being-breached is what matters. Do not block submission on a score.
  zxcvbn agrees with NIST in its own words — one of its stock suggestions is
  "You can create strong passwords without using symbols, numbers, or
  uppercase letters."

See `password-strength.gts` for the Glimmer binding, and `controls-extras.gts`
for the `PasswordInput @strength={{true}}` opt-in.
