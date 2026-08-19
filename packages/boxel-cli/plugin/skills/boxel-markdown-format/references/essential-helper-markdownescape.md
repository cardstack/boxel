## Essential helper: `markdownEscape`

```gts
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
```

Escapes every CommonMark/GFM metacharacter (`\`, `` ` ``, `*`, `_`, `[`, `]`, `(`, `)`, `<`, `>`, `|`, `~`, `!`, `#`, `+`, `-`) plus line-start numeric list prefixes (`1.` → `1\.`). Null/undefined inputs return `''`; non-string inputs are coerced with `String()`.

**Use it on any user-supplied string** before it lands in markdown output. Skipping it will eventually bite when a user types `*`, `_`, or a leading `1.`.
