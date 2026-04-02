**Core imports:**

```gts
import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
```

**UI Components:**

```gts
import { Button, Pill, BoxelSelect } from '@cardstack/boxel-ui/components';
```

**Helpers:**

```gts
import { eq, gt, and, or, not } from '@cardstack/boxel-ui/helpers';
import { formatDateTime, formatCurrency } from '@cardstack/boxel-ui/helpers';
```

## Quick Reference

**File Types:** `.gts` (definitions) | `.json` (instances)  
**Core Pattern:** CardDef/FieldDef → contains/linksTo → Templates → Instances  
**Essential Formats:** Every CardDef MUST implement `isolated`, `embedded`, AND `fitted` formats

```gts
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ Core imports - ALWAYS needed for definitions
import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';

// ² Base field imports (only what you use)
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import DateField from '@cardstack/base/date';
import DateTimeField from '@cardstack/base/datetime';
import MarkdownField from '@cardstack/base/markdown';
import TextAreaField from '@cardstack/base/text-area';
import BigIntegerField from '@cardstack/base/big-integer';
import CodeRefField from '@cardstack/base/code-ref';
import Base64ImageField from '@cardstack/base/base64-image'; // 🚨 NEVER USE - embeds binary in JSON, crashes AI context; use FileDef types instead

// ⁸ FileDef imports - for file fields (use linksTo, never contains)
import FileDef from '@cardstack/base/file-api';
import ImageDef from '@cardstack/base/image-file-def'; // any image
import PngDef from '@cardstack/base/png-image-def'; // .png
import JpgDef from '@cardstack/base/jpg-image-def'; // .jpg/.jpeg
import SvgDef from '@cardstack/base/svg-image-def'; // .svg
import GifDef from '@cardstack/base/gif-image-def'; // .gif
import WebpDef from '@cardstack/base/webp-image-def'; // .webp
import AvifDef from '@cardstack/base/avif-image-def'; // .avif
import MarkdownDef from '@cardstack/base/markdown-file-def'; // .md (NOT same as MarkdownField)
import TextFileDef from '@cardstack/base/text-file-def'; // .txt
import TsFileDef from '@cardstack/base/ts-file-def'; // .ts
import GtsFileDef from '@cardstack/base/gts-file-def'; // .gts
import JsonFileDef from '@cardstack/base/json-file-def'; // .json
import CsvFileDef from '@cardstack/base/csv-file-def'; // .csv
import ColorField from '@cardstack/base/color';
import EmailField from '@cardstack/base/email';
import PercentageField from '@cardstack/base/percentage';
import PhoneNumberField from '@cardstack/base/phone-number';
import UrlField from '@cardstack/base/url';
import AddressField from '@cardstack/base/address';

// ⚠️ EXTENDING BASE FIELDS: To customize a base field, import it and extend:
// import BaseAddressField from '@cardstack/base/address';
// export class FancyAddressField extends BaseAddressField { }
// Never import and define the same field name - it causes conflicts!

// ³ UI Component imports
import {
  Button,
  Pill,
  Avatar,
  FieldContainer,
  CardContainer,
  BoxelSelect,
  ViewSelector,
} from '@cardstack/boxel-ui/components';

// ⁴ Helper imports
import {
  eq,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  cn,
  add,
  subtract,
  multiply,
  divide,
} from '@cardstack/boxel-ui/helpers';
import {
  currencyFormat,
  formatDateTime,
  optional,
  pick,
} from '@cardstack/boxel-ui/helpers';
import { concat, fn } from '@ember/helper';
import { get } from '@ember/helper';
import { on } from '@ember/modifier';
import Modifier from 'ember-modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { task, restartableTask } from 'ember-concurrency';
// NOTE: 'if' is built into Glimmer templates - DO NOT import it

// ⁶ TIMING RULE: NEVER use requestAnimationFrame
// - DOM timing: Use Glimmer modifiers with cleanup
// - Async coordination: Use task/restartableTask from ember-concurrency
// - Delays: Use await timeout(ms) from ember-concurrency, not setTimeout

// ⁵ Icon imports
import EmailIcon from '@cardstack/boxel-icons/mail';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import RocketIcon from '@cardstack/boxel-icons/rocket';
// Available from Lucide, Lucide Labs, and Tabler icon sets
// NOTE: Only use for static card/field type icons, NOT in templates

// CRITICAL IMPORT RULES:
// ⚠️ If you don't see an import in the approved lists above, DO NOT assume it exists!
// ⚠️ Only use imports explicitly shown in this guide - no exceptions!
// - Verify any import exists in the approved lists before using
// - Do NOT assume similar imports exist (e.g., don't assume IntegerField exists because NumberField does)
// - If needed functionality isn't in approved imports, define it directly with a comment:
//   // Defining custom helper - not yet available in Boxel environment
//   function customHelper() { ... }
```
