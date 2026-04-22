# src/bxl/

**Origin:** original code in this repository. Licensed under MIT
(see [`/LICENSE`](../../LICENSE)).

This directory contains BXL's **readable syntax layer**: the compiler,
formatter, linter, bridge, registry, and syntax-highlighting grammar that
make Excel-looking expressions compile down to canonical jqxl.

## Layering

```
src/bxl/  (this folder)
  ├── compiler/     readable BXL → canonical jqxl (source-level rewrite)
  ├── formatter/    solid / readable / multi-line formatters
  ├── linter/       parser-only diagnostics (imports jqtools/parser, never evaluate)
  ├── registry/     assembles jq-core + formula libraries
  ├── bridge/       top-level runtime entry (native.ts); wires formulajs to jq
  ├── syntax/       TextMate grammar JSON
  └── errors.ts     BXL-specific error types
```

BXL imports from both `src/jqtools/` and `src/formulajs/`. The reverse is
**not** allowed — those folders stand alone.

## Responsibilities

- **`compiler/readable-syntax.ts`** — rewrites readable BXL to canonical jqxl
  before tokenizing. Handles label paths, pseudos (`:first`, `:last`,
  `:nth`), row/index shortcuts (`[#N]`, `[*pred]`, `[all]`), predicate
  indices (`[Field = "X"]`, `[Field > 5]`), Excel preprocessor (`=`, `<>`,
  `^`, `&`, leading `=`), and formula-name lifting. Uses the schema to
  resolve quoted and bare labels to jq paths.
- **`compiler/lexicon.ts`** — shared keyword and literal dictionaries.
- **`formatter/index.ts`** — solidify (fuzzy/readable → canonical
  Solid BXL), expand (single-line → multi-line), collapse (multi-line →
  single-line), bxlToJq + jqToBxl conversions.
- **`linter/index.ts`** — non-evaluating diagnostics: missing quotes,
  zero-based index warnings, first-match predicate warnings, Excel-equality
  preference, deprecated row shortcut, etc.
- **`registry/index.ts`** — `BXL_REGISTRY` (core + formula), public
  `resolveBuiltinRegistry`.
- **`bridge/native.ts`** — `runNativeJq`, `parseNativeJq`, `tokenizeNativeJq`.
  The top-level runtime entry that chains compile → tokenize → parse →
  evaluate, wiring the full registry and runtime budgets.
- **`bridge/formula-contrib-*.ts`** — wires formulajs Excel helpers as jq
  builtins. Depends on `src/formulajs/`.
- **`syntax/bxl.tmLanguage.json`** — portable TextMate grammar for editors.

## Sub-entry mapping

The public package sub-entries (declared in `/package.json` `exports`) map
to specific subsets of this folder:

- `@cardstack/bxl/compiler` — `bxl/compiler/`
- `@cardstack/bxl/linter` — `bxl/linter/` (+ `jqtools/parser`)
- `@cardstack/bxl/runtime` — `bxl/bridge/native` (+ full registry + formulas)
- `@cardstack/bxl/runtime-bare` — `bxl/bridge/native` configured with
  `['core']` only, skipping `formulajs/`

See [`/src/index.ts`](../index.ts) for the public API surface.
