# BXL Password-Game: 26-Rule Form Stress Test

A Boxel card (`PasswordGameForm`) modeled after neal.fun's *The Password
Game* — except instead of a single password field, you must fill out a
structured form whose values satisfy **twenty-six cumulative rules**.
Every rule is a single BXL expression. No rule uses JavaScript. The
goal: exercise the full readable-syntax surface of `@cardstack/bxl` on
realistic cross-field form data.

You *start* with rule 1 visible. Each time the visible rules all pass,
the next rule appears. When all 26 are green the **Submit** button
unlocks and the card shows a victory banner.

---

## Form shape

```
PasswordGameForm (CardDef)
├── profile      (ProfileField)
│   ├── username      : StringField
│   ├── displayName   : StringField
│   ├── age           : NumberField
│   ├── email         : StringField
│   └── birthYear     : NumberField
├── preferences  (PreferencesField)
│   ├── favoriteColor : StringField
│   ├── favoriteNumber: NumberField
│   ├── newsletter    : BooleanField
│   └── theme         : StringField
├── security     (SecurityField)
│   ├── secretPhrase  : StringField
│   ├── backupCode    : StringField
│   └── pin           : NumberField
├── tags         : containsMany(StringField)
└── bio          : StringField
```

Why three nested FieldDefs? It forces every BXL rule to traverse a real
object path (`.profile.username`, `.security.pin`), which is how people
actually write them in cards.

---

## Canonical "A" solution

A deterministic set of values that satisfies every rule. Used by:
- the `reveal solution` button in the UI (fills all fields in one
  click so a reviewer can see the win state),
- the headless regression test
  (`tests/unit/password-game-cli.ts`), which asserts each rule
  evaluates `true` on this input and `false` on a plausible "wrong"
  counter-example.

```json
{
  "profile": {
    "username":    "ada42",
    "displayName": "Ada Lovelace",
    "age":         42,
    "email":       "ada42@bxl.dev",
    "birthYear":   1984
  },
  "preferences": {
    "favoriteColor":  "purple",
    "favoriteNumber": 6,
    "newsletter":     true,
    "theme":          "dark"
  },
  "security": {
    "secretPhrase": "I love coding in BXL",
    "backupCode":   "ADAPURPLE42",
    "pin":          4242
  },
  "tags": ["bxl", "cards", "forms", "code"],
  "bio":  "Ada Lovelace joined in 2026 to code with ada42 and love BXL"
}
```

---

## The 26 rules

Each rule has:
- a plain-English description (what the UI shows),
- a BXL expression (what runs through `expression('...')` in the
  `.gts`),
- a tag list for which BXL feature it exercises.

| # | Rule | BXL expression | Features |
|---|------|----------------|----------|
| 1 | Username is filled in | `present(.profile.username)` | `present()` helper |
| 2 | Username is at least 5 characters | `LEN(.profile.username) >= 5` | Excel `LEN`, `>=` |
| 3 | Username ends with your age as digits | `RIGHT(.profile.username, 2) == (.profile.age \| tostring)` | Excel `RIGHT`, jq `tostring`, cross-field |
| 4 | Display name is exactly two words | `words(.profile.displayName) == 2` | `words()` helper |
| 5 | Display name is in Title Case | `PROPER(.profile.displayName) == .profile.displayName` | Excel `PROPER`, self-equality |
| 6 | Age is between 18 and 120 | `.profile.age >= 18 AND .profile.age <= 120` | `AND`, numeric range |
| 7 | Email contains an `@` | `.profile.email \| contains("@")` | jq `contains` |
| 8 | Email starts with username | `. as $root \| .profile.email \| startswith($root.profile.username)` | jq `startswith`, field-to-field |
| 9 | Birth year + age equals this year (2026) | `.profile.birthYear + .profile.age == 2026` | arithmetic + equality |
| 10 | Favorite color uppercased is "PURPLE" | `UPPER(.preferences.favoriteColor) == "PURPLE"` | Excel `UPPER` |
| 11 | Favorite number equals length of favorite color | `.preferences.favoriteNumber == LEN(.preferences.favoriteColor)` | cross-field `LEN` |
| 12 | Theme is "dark" or "light" | `.preferences.theme IN ["dark", "light"]` | `IN` with literal array |
| 13 | If newsletter is on, bio must mention "BXL" | `implies(.preferences.newsletter, .bio \| contains("BXL"))` | `implies()` helper + jq `contains` |
| 14 | Secret phrase is exactly 5 words | `words(.security.secretPhrase) == 5` | `words()` on nested path |
| 15 | Secret phrase contains "BXL" (case-insensitive) | `UPPER(.security.secretPhrase) \| contains("BXL")` | `UPPER` piped into jq `contains` |
| 16 | Backup code starts with UPPER(first 3 chars of username) | `. as $root \| .security.backupCode \| startswith(UPPER(LEFT($root.profile.username, 3)))` | jq `startswith` + `UPPER` + `LEFT` composed |
| 17 | Backup code contains UPPER(favorite color) | `. as $root \| .security.backupCode \| contains(UPPER($root.preferences.favoriteColor))` | jq `contains` + `UPPER` on field |
| 18 | Backup code ends with your age | `. as $root \| .security.backupCode \| endswith($root.profile.age \| tostring)` | jq `endswith` + jq pipe |
| 19 | PIN is exactly 4 digits | `LEN(.security.pin \| tostring) == 4` | `LEN` on stringified number |
| 20 | Sum of PIN digits equals favoriteNumber × 2 | `([.security.pin \| tostring \| split("") \| .[] \| tonumber] \| add) == .preferences.favoriteNumber * 2` | jq pipe chain: `split`, array-spread, `tonumber`, `add` |
| 21 | Tag count equals favoriteNumber minus 2 | `(.tags \| length) == .preferences.favoriteNumber - 2` | jq `length` on array, arithmetic |
| 22 | First tag has length 3 | `LEN(.tags[0]) == 3` | array index + `LEN` on string |
| 23 | All tags are unique | `(.tags \| unique \| length) == (.tags \| length)` | jq `unique` |
| 24 | Bio mentions the display name | `. as $root \| .bio \| contains($root.profile.displayName)` | jq `contains`, field-to-field |
| 25 | Bio mentions the year 2026 | `.bio \| contains("2026")` | jq `contains` literal |
| 26 | Backup code is **exactly** `UPPER(first 3 of username) + UPPER(color) + age` | `.security.backupCode == UPPER(LEFT(.profile.username, 3)) + UPPER(.preferences.favoriteColor) + (.profile.age \| tostring)` | capstone: string concat, `UPPER`, `LEFT`, `tostring`, cross-field |

### Feature coverage cross-check

- **BXL-native helpers** — `present` (R1), `words` (R4, R14), `implies` (R13)
- **Excel functions** — `LEN` (R2, R11, R19, R22), `RIGHT` (R3), `PROPER` (R5), `UPPER` (R10, R15, R16, R17, R26), `LEFT` (R16, R26)
- **Readable word operators (infix)** — `AND` (R6), `IN` (R12)
- **jq string helpers** — `contains` (R7, R13, R15, R17, R24, R25), `startswith` (R8, R16), `endswith` (R18)
- **jq surface** — `length` (R21, R23), `unique` (R23), `tostring` (R3, R18, R19, R20, R26), `tonumber` (R20), `split` (R20), `add` (R20), array spread `.[]` (R20)
- **Cross-field references** — R3, R8, R11, R13, R16, R17, R18, R20, R21, R24, R26
- **Nested path traversal** — every rule touches `.profile.`, `.preferences.`, or `.security.`
- **Compound operators** — R9 (`+ ==`), R20 (arithmetic inside equality), R26 (string `+ + ==`)

---

## Rule-reveal mechanic

- At render time, the card evaluates every rule's boolean computed
  field. These live on `PasswordGameForm` as `rule1Pass` through
  `rule26Pass` (`BooleanField`, `computeVia: expression('...')`).
- The UI walks them in order. It shows:
  - all rules up to and including the first failing one, *plus* all
    already-passed rules before it, and
  - the "next" locked rule if the current frontier is passing.
- When `allRulesPass` (the meta-computed field, `AND` of all 26) is
  true, the submit button unlocks and a celebratory banner appears.
- A `revealSolutionMode` boolean on the card (default `false`, edited
  manually) causes the UI to fill every field with the canonical
  solution above. This exists purely so a reviewer can trigger the
  win state without memorising 12 nested values.
- A `devShowAll` boolean exposes every rule regardless of whether
  earlier ones pass — useful for screenshotting the whole list.

The card does not enforce gating server-side — all rule evaluation is
read-only. Users can type anything; the rules just update in real time
as BXL recomputes.

---

## Headless test strategy

`tests/unit/password-game-cli.ts` imports every rule (as a BXL string)
from the single source-of-truth array `RULES` and asserts, for each
rule:

1. The **canonical solution** evaluates the rule to `true`.
2. A per-rule **failing fixture** (the canonical solution with *one*
   field tweaked so the rule breaks) evaluates the rule to `false`.
3. The rule **compiles** without throwing — i.e. BXL parses and emits
   valid jqxl source.

The same `RULES` array can be pasted into the `.gts` (or imported, if
we later export a single-source-of-truth module). The canonical
solution is kept in sync by the regression test: if someone changes
rule 11 without also updating the canonical solution, the test fails
loudly.

---

## Why these 26 rules and not others

- **Breadth over depth.** Twenty-six rules is enough to touch every
  BXL syntactic family once and most twice. More rules would repeat
  without adding coverage.
- **Boolean-valued.** Every rule is a single pure boolean expression.
  No rule produces a number or string — that's the job of
  `.gts` computed fields (which are *not* in scope here).
- **Deterministic.** No rule depends on `TODAY()` or random inputs.
  The "year 2026" in R9 and R25 is a hard-coded literal so the tests
  remain stable into 2027.
- **Cross-field by design.** Fifteen of twenty-six rules touch two or
  more fields, because single-field validation is a weaker stress
  test than cross-field validation.
- **Capstone rule at the end.** R26 composes `UPPER`, `LEFT`,
  `tostring`, string `+`, and a compound equality against a nested
  field — the most ambitious single line in the game.

---

## File layout

```
bxl/
├── docs/password-game-spec.md         — this doc
└── tests/unit/password-game-cli.ts    — headless regression test

realm-fixture/password-game/
├── bxl.ts                             — the BXL bundle (same as other realms)
├── password-game.gts                  — card definition + UI
└── PasswordGameForm/
    ├── canonical-solution.json        — fully-populated, all 26 pass
    └── empty-start.json               — all fields null, every rule fails
```
