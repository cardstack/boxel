# Common GTS Imports and Import Preflight

Use this before writing or finalizing `.gts` files. Missing imports compile late and usually cost a server render/lint repair turn, so treat import preflight as part of authoring.

Research note: a May 2026 scan of active `boxel-workspaces` realm/source `.gts` files found the most common modules were `@cardstack/base/card-api`, base fields, `@cardstack/boxel-ui/helpers`, `@glimmer/tracking`, `@ember/modifier`, `@cardstack/boxel-ui/components`, `@ember/helper`, `@ember/object`, `ember-modifier`, and `ember-concurrency`. The common missing-import failures are template helpers/modifiers: `{{on ...}}`, `(fn ...)`, `concat`, `get`, `array`, `hash`, and Boxel helper predicates/formatters. `perform` is not a safe template helper in strict-mode realm GTS: do not import `ember-concurrency/helpers/perform`, and do not write `(perform this.someTask)`.

## Import Preflight

After writing a template, scan every non-builtin name used in mustaches/modifiers and verify a matching import or local class property exists.

Common built-ins that do not need imports: `if`, `each`, `let`, `unless`, `else`, `yield`.

Task invocation rule: never use `(perform this.someTask)` in strict-mode templates, and never import `perform` from `ember-concurrency/helpers/perform`; that subpath is not fetchable in realms and becomes `https://packages/ember-concurrency/helpers/perform`. Define a local handler that calls `.perform()` and bind that handler with `{{on}}`.

These do need imports:

| Template / class use | Import |
| --- | --- |
| `{{on 'click' ...}}` | `import { on } from '@ember/modifier';` |
| `(fn this.action arg)` | `import { fn } from '@ember/helper';` |
| `concat`, `get`, `array`, `hash` | `import { concat, get, array, hash } from '@ember/helper';` |
| `eq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`, `cn` | `import { eq, gt, gte, lt, lte, and, or, not, cn } from '@cardstack/boxel-ui/helpers';` |
| `add`, `subtract`, `multiply`, `divide` | `import { add, subtract, multiply, divide } from '@cardstack/boxel-ui/helpers';` |
| display dates/numbers/currency/duration/file sizes | `import { formatDateTime, formatNumber, formatCurrency, formatDuration, formatFileSize } from '@cardstack/boxel-ui/helpers';` |
| component state | `import { tracked } from '@glimmer/tracking';` |
| class actions used without arrow functions | `import { action } from '@ember/object';` |
| tasks / delays | `import { task, restartableTask, timeout } from 'ember-concurrency';` |
| click starts a task | no template helper; define `startSave = () => { this.saveTask.perform(); };` and bind `{{on 'click' this.startSave}}` |
| custom DOM modifier class | `import Modifier from 'ember-modifier';` |
| functional modifier | `import { modifier } from 'ember-modifier';` |

Do not rely on globals for `fn`, `on`, or Boxel UI helpers in `.gts`. If the template references them, import them explicitly. For tasks, keep `perform` in TypeScript class scope through a local handler; strict templates cannot see an unimported `perform` helper.

## Common Import Blocks

Core card definitions:

```gts
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
```

For query refs, follow `query-systems.md`: import `realmURL` from `@cardstack/runtime-common` and use `codeRef(...)`; do not hand-roll URLs or use `Symbol.for('realmURL')`.

Common base fields:

```gts
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import DateField from '@cardstack/base/date';
import DateTimeField from '@cardstack/base/datetime';
import MarkdownField from '@cardstack/base/markdown';
import TextAreaField from '@cardstack/base/text-area';
import UrlField from '@cardstack/base/url';
import ColorField from '@cardstack/base/color';
import EmailField from '@cardstack/base/email';
import PhoneNumberField from '@cardstack/base/phone-number';
```

Template interaction helpers:

```gts
import { on } from '@ember/modifier';
import { fn, concat, get, array, hash } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
```

Boxel UI helpers:

```gts
import {
  add,
  and,
  bool,
  cn,
  cssVar,
  divide,
  element,
  eq,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
  getContrastColor,
  gt,
  gte,
  lt,
  lte,
  markdownEscape,
  multiply,
  not,
  optional,
  or,
  pick,
  sanitizeHtml,
  sanitizeHtmlSafe,
  subtract,
} from '@cardstack/boxel-ui/helpers';
```

Never write a `style` attribute by hand: a literal or concatenated `style='…'` fails
lint (`no-inline-styles`, `style-concatenation`), and Glimmer warns in development
whenever a non-`SafeString` is bound to `style`. Static values belong in
`<style scoped>`; dynamic values go through the safe helper for the job (`cssVar`,
`setBackgroundImage`, `sanitizeHtmlSafe`) or an `htmlSafe` getter. See
`styling-design.md` "Dynamic inline styles".

`cssVar` sets custom properties inline from a hash; each key becomes `--key`, and
empty or `undefined` values are skipped. `getContrastColor` takes a hex color and
returns a dark or light ink for it (`undefined` for anything else, which `cssVar`
then skips so the CSS fallback applies), so text stays readable over a color the
model supplies. When the fill is a theme token rather than a model value, skip the
helper: use the token's own `--*-foreground` on its fill, or `--*-ink` for the hue
as text on a neutral surface (see `theme-token-contract.md`).

```hbs
<header
  class='hero'
  style={{cssVar hero-bg=@model.brandColor hero-fg=(getContrastColor @model.brandColor)}}
>
  <h1><@fields.cardTitle /></h1>
</header>
```

```css
.hero {
  background-color: var(--hero-bg, var(--primary));
  color: var(--hero-fg, var(--primary-foreground));
}
```

`sanitizeHtmlSafe` runs a string through DOMPurify and returns a `SafeString`, so
model-supplied or hand-built HTML can be rendered without escaping. It accepts
`undefined` and renders nothing. `sanitizeHtml` is the plain-string form for
attributes such as `href`:

```hbs
<p class='summary'>{{sanitizeHtmlSafe @model.summaryHtml}}</p>
<a href={{sanitizeHtml @model.externalUrl}}>Visit</a>
```

Base helpers (default exports):

```gts
import setBackgroundImage from '@cardstack/base/helpers/set-background-image';
```

```hbs
<div class='cover' style={{setBackgroundImage @model.cardThumbnailURL}} />
```

Async tasks and click handlers:

```gts
import { task, restartableTask, timeout } from 'ember-concurrency';
import { on } from '@ember/modifier';
```

Use tasks from templates through a local handler:

```gts
saveTask = restartableTask(async () => {
  await timeout(250);
});

startSave = () => {
  this.saveTask.perform();
};
```

```hbs
<Button {{on 'click' this.startSave}}>Save</Button>
```

Boxel UI components:

```gts
import {
  Accordion,
  Avatar,
  BoxelContainer,
  BoxelInput,
  BoxelMultiSelect,
  BoxelSelect,
  Button,
  CircleSpinner,
  ColorPicker,
  ContextButton,
  CopyButton,
  BoxelDropdown,
  EmailInput,
  FieldContainer,
  FilterList,
  FittedCard,
  FittedCardContainer,
  GridContainer,
  IconButton,
  LoadingIndicator,
  Menu,
  PhoneInput,
  Pill,
  ProgressBar,
  ProgressRadial,
  RadioInput,
  SkeletonPlaceholder,
  SortDropdown,
  Swatch,
  Switch,
  TabbedHeader,
  Tooltip,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
```

Host commands:

```gts
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/tools/send-request-via-proxy';
```

Icons are default imports from descriptor-first icon module names:

```gts
import SparklesIcon from '@cardstack/boxel-icons/sparkles';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
```

## Fast Manual Check

Before finalizing, search the file for the high-risk helper calls and compare against imports:

```sh
rg -n "\\(fn |\\(perform |\\bconcat\\b|\\bget\\b|\\barray\\b|\\bhash\\b|\\{\\{on\\b|format[A-Z]|\\((eq|gt|gte|lt|lte|and|or|not|add|subtract|multiply|divide)\\b" path/to/card.gts
```

Then confirm the file imports from `@ember/helper`, `@ember/modifier`, and `@cardstack/boxel-ui/helpers` as needed. Also confirm the file does **not** import `ember-concurrency/helpers/perform`.
If the search finds `(perform ...)`, replace it with a local handler method that calls `.perform()` and bind that handler with `{{on}}`.
