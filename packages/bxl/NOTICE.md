# Third-Party Notices

`@cardstack/bxl` contains code derived from or bundled from the following
open-source projects, each used under the MIT License. The full license text
for each is reproduced below.

Our own code in `src/bxl/` is licensed under MIT (see [LICENSE](./LICENSE)).
The derivations in `src/jqtools/` and `src/formulajs/`, and the bundled
validator.js dependency used by the validation extension, remain under MIT by
virtue of their upstreams' terms.

## 1. jq-tools

- Package: `@jq-tools/jq`
- Version basis: **v0.0.11** (`alexxander/jq-tools@c58581c`)
- Upstream: <https://github.com/alexxander/jq-tools>
- Copyright: © alexxander and contributors

**Files derived:** `src/jqtools/parser/*`, `src/jqtools/evaluate/*` (excluding
our additions listed in `src/jqtools/UPSTREAM-DIFFS.md`).

**Our changes:** import-path normalization (`.js` suffixes for NodeNext ESM
resolution), runtime-budget hooks (`runtimeState.ts`, `checkRuntimeBudget()`
call sites in the evaluator), registry parameterization of `Environment`, and
`dateTime.ts` utilities. See `src/jqtools/UPSTREAM-DIFFS.md` for the
file-by-file audit.

### MIT License text (jq-tools)

```
MIT License

Copyright (c) alexxander

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. Formula.js

- Package: `@formulajs/formulajs`
- Version basis: **v4.6.0** (`formulajs/formulajs@82eccb0`, audited 2026-04-22)
- Upstream: <https://github.com/formulajs/formulajs>
- Copyright: © 2014 Sutoiku, Inc.

**Files derived:** `src/formulajs/*`. BXL ships a curated subset of Formula.js
functions — scalar/analytic helpers that compose with jq expressions. We
exclude functions that assume spreadsheet coordinates or duplicate jq's own
data-reshaping capabilities. See `src/formulajs/UPSTREAM-DIFFS.md` for the
selection audit and our adaptations.

**Our changes:** TypeScript port (files are `.ts` with added type annotations),
organizational renaming to BXL-specific module layout (`common.ts`,
`criteria.ts`, `dateSerial.ts`, etc.), and adaptation to BXL's error
convention (`throwExcelError` from `errors.ts`) in place of Formula.js's
return-value error sentinels.

### MIT License text (Formula.js)

```
Copyright (c) 2014 Sutoiku, Inc.

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to
do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. validator.js

- Package: `validator`
- Version basis: **v13.15.35**
- Upstream: <https://github.com/validatorjs/validator.js>
- Copyright: © 2018 Chris O'Hara

**Files used:** BXL imports the `validator` package through the lazy
`validation` extension. No source files are vendored into `src/`.

**Our changes:** The bridge exposes validator.js boolean validators as BXL
native filters, keeps validator.js's function names and option object shapes, and adapts
validator exceptions / non-string inputs to safe `false` validation results.

### MIT License text (validator.js)

```
Copyright (c) 2018 Chris O'Hara <cohara87@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Reporting attribution issues

If you believe code in this repository is missing proper attribution, please
open an issue at <https://github.com/cardstack/bxl/issues>, or email
security@cardstack.com for coordinated handling.
