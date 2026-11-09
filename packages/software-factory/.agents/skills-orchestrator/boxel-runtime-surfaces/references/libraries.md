# Available Libraries — Where Imports Come From

Boxel cards (`.gts` files) can import from three portable tiers of source.
Use this lookup to find the **current** import path for any symbol you need.

---

## Tier 1 — Boxel base (host-provided)

URL-pinned imports from the Boxel base realm. Always available, no install.

```ts
// Core API — CardDef, FieldDef, field decorators, Component, contains, linksTo
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Component,
  Box,
} from '@cardstack/base/card-api';

// Built-in field types — each in its own module (DEFAULT exports)
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import DateField from '@cardstack/base/date';
import DatetimeField from '@cardstack/base/datetime';
import MarkdownField from '@cardstack/base/markdown';

// Code reference field (for codeRef-typed values)
import { CodeRefField } from '@cardstack/base/code-ref';
import { AbsoluteCodeRefField } from '@cardstack/base/code-ref';

// Shared state across components
import { sharedState } from '@cardstack/base/shared-state';

// Skill / SkillSet / SkillPlusMarkdown
import { Skill, SkillReference } from '@cardstack/base/skill';
import { SkillPlusMarkdown } from '@cardstack/base/skill-plus';
import { SkillSet } from '@cardstack/base/skill-set';
```

---

## Tier 2 — npm packages (resolved by the host)

Standard Ember / Glimmer ecosystem. No special setup needed.

### `@cardstack/runtime-common` — runtime APIs

```ts
import { getCards, getCard } from '@cardstack/runtime-common';
import { getField, getFieldIcon } from '@cardstack/runtime-common';
import { cardDefComputedFields } from '@cardstack/runtime-common';
import { Command } from '@cardstack/runtime-common/commands';
// Preferred result-list surface for new work — build its query with searchEntryWireQueryFromQuery,
// then render via @context.searchResultsComponent.
import { searchEntryWireQueryFromQuery } from '@cardstack/runtime-common';
import type { SearchEntryWireQuery } from '@cardstack/runtime-common';
// Older surface, superseded by the above (still available via @context.prerenderedCardSearchComponent):
import { prerenderedCardSearchComponent } from '@cardstack/runtime-common/prerendered-card-search';
```

### `@cardstack/pretui` — UI components and helpers

One module per component, imported per file; there are no barrels.

```ts
// Components
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Avatar } from '@cardstack/pretui/components/avatar';
import { Input } from '@cardstack/pretui/components/input';
import { Select } from '@cardstack/pretui/components/select';
import { Field } from '@cardstack/pretui/components/field';
import { Dialog } from '@cardstack/pretui/components/dialog';
import { Drawer } from '@cardstack/pretui/components/drawer';
import { Toast } from '@cardstack/pretui/components/toast';
import { ColorPalette } from '@cardstack/pretui/components/color-palette';
import { ColorPicker } from '@cardstack/pretui/components/color-picker';
import { Grid } from '@cardstack/pretui/components/grid';
import { Board } from '@cardstack/pretui/components/board';

// Display formatting — used as <FormatDate @date={{@model.due}} />, etc.
import { FormatDate } from '@cardstack/pretui/components/format-date';
import { FormatNumber } from '@cardstack/pretui/components/format-number';
import { RelativeTime } from '@cardstack/pretui/components/relative-time';
import {
  FormatBytes,
  formatBytes,
} from '@cardstack/pretui/components/format-bytes';

// Template helpers — used as {{eq ...}}, {{and ...}}, etc.
import {
  eq,
  gt,
  gte,
  lt,
  lte,
  not,
  and,
  or,
  multiply,
  add,
  element,
} from '@cardstack/pretui/helpers';
```

A component's write-up is its contract: arguments, named blocks and
`--pretui-*` knobs. It lives in the Pret UI realm, outside your workspace, so
read it from `Bash`:

```sh
boxel file read @cardstack/pretui/components/<name>.md
```

Most components also have worked examples at `<name>.usage.gts`, which
`boxel file read` reads the same way.

### `@cardstack/boxel-icons` — icons

```ts
// Icons (drop into templates as <IconName />)
import CheckIcon from '@cardstack/boxel-icons/check';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
```

### `@cardstack/boxel-ui` — only what Pret UI has no counterpart for yet

boxel-ui is deprecated: new code takes a boxel-ui export only when Pret UI
has no counterpart for it, and each of these moves when one lands.

```ts
import {
  cn,
  formatDateTime,
  formatNumber,
  formatCurrency,
  formatDuration,
  formatRelativeTime,
  type MenuItemOptions,
} from '@cardstack/boxel-ui/helpers';
import {
  CardContainer,
  FittedCard,
  FilterList,
  autoPlaceKanban,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
```

`FittedCard` is the slot layout for a card's own fitted template: it queries
the host's `fitted-card` container. Pret UI's `CopyFit` sets its own size
container, so it is a record tile for a `Grid` or a result list, not a fitted
template's root. `MenuItemOptions` is the return type of a card's
`[getMenuItems]`; Pret UI's `Menu` takes plain `{ label, onSelect }` entries
instead.

Formatting: templates use Pret UI's `FormatDate`, `FormatNumber` (currency,
percent and units), `RelativeTime` and `FormatBytes`. Their args are `Intl`
options, not boxel-ui's format strings, so read each contract. For a string
built in JS, `formatBytes(value, options).text` formats a file size, and the
formatter helpers in `@cardstack/boxel-ui/helpers` cover the rest:
`formatDateTime`, `formatNumber`, `formatCurrency`, `formatRelativeTime`,
`formatDuration`, `formatCountdown`, `formatList`, `formatNames`,
`formatOrdinal`, `formatPeriod`, `formatAge`, `currencyFormat` (legacy) and
`dayjsFormat` (deprecated). `formatDuration`, `formatCountdown`,
`formatList`, `formatNames`, `formatOrdinal`, `formatPeriod` and `formatAge`
have no Pret UI component, so templates use them too. Older formatter
libraries in catalog realms are not the source of truth.

Kanban boards: `Board` from `@cardstack/pretui/components/board` is the
lane-based drag/drop board; use it instead of hand-rolled DOM drag code. The
placement types and helpers it takes (`KanbanColumnConfig`,
`KanbanPlacement`, `autoPlaceKanban`, `cardsInColumn`, `kanbanColumnCount`,
`resolveInsertion`) still come from `@cardstack/boxel-ui/components`.

### `@cardstack/boxel-host` — host-side tools (only available inside the running app)

> **Path rule:** host tool imports are `@cardstack/boxel-host/tools/<kebab-name>`.
> The pre-rename `@cardstack/boxel-host/commands/…` path NO LONGER EXISTS —
> imports of it pass every static gate (lint, schema probe, evaluate,
> indexing) and fail only when a user triggers the code path in the
> browser. LLMs trained before the rename write `commands/` — correct it
> on sight.

```ts
import UseAiAssistantCommand from '@cardstack/boxel-host/tools/ai-assistant';
import SetActiveLLMCommand from '@cardstack/boxel-host/tools/set-active-llm';
import SwitchSubmodeCommand from '@cardstack/boxel-host/tools/switch-submode';
import ShowCardCommand from '@cardstack/boxel-host/tools/show-card';
import SearchCardsByQueryCommand from '@cardstack/boxel-host/tools/search-cards';
import SearchCardsByTypeAndTitleCommand from '@cardstack/boxel-host/tools/search-cards';
import ReadFileForAiAssistantCommand from '@cardstack/boxel-host/tools/read-file-for-ai-assistant';
import PatchFieldsCommand from '@cardstack/boxel-host/tools/patch-fields';
import ApplyMarkdownEditCommand from '@cardstack/boxel-host/tools/apply-markdown-edit';
import WriteTextFileCommand from '@cardstack/boxel-host/tools/write-text-file';
import CopyCardCommand from '@cardstack/boxel-host/tools/copy-card';
import CopySourceCommand from '@cardstack/boxel-host/tools/copy-source';
import TransformCardsCommand from '@cardstack/boxel-host/tools/transform-cards';
import UpdateRoomSkillsCommand from '@cardstack/boxel-host/tools/update-room-skills';
import OpenWorkspaceCommand from '@cardstack/boxel-host/tools/open-workspace';
import PreviewFormatCommand from '@cardstack/boxel-host/tools/preview-format';
import UpdateCodePathWithSelectionCommand from '@cardstack/boxel-host/tools/update-code-path-with-selection';
import ReindexRealmCommand from '@cardstack/boxel-host/tools/reindex-realm';
import FullReindexRealmCommand from '@cardstack/boxel-host/tools/full-reindex-realm';
import CancelIndexingJobCommand from '@cardstack/boxel-host/tools/cancel-indexing-job';
import InvalidateRealmIdentifiersCommand from '@cardstack/boxel-host/tools/invalidate-realm-identifiers';
```

### Glimmer / Ember primitives

```ts
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { on } from '@ember/modifier';
import { fn, hash, array, get, concat } from '@ember/helper';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import { setComponentTemplate } from '@ember/component';
import { precompileTemplate } from '@ember/template-compilation';
```

### Async / Resources / Modifiers

```ts
import {
  task,
  restartableTask,
  dropTask,
  enqueueTask,
  keepLatestTask,
} from 'ember-concurrency';
import { Resource, resource, use } from 'ember-resources';
import { modifier } from 'ember-modifier';
```

### Utility

```ts
import { startCase, kebabCase, debounce, throttle, isEqual } from 'lodash';
```

---

## Tier 3 — ESM CDN imports (for one-off third-party libs)

When you need a library outside the above tiers, import directly from a CDN:

```ts
// esm.run (jsdelivr-backed) — recommended for stable libraries
import * as THREE from 'https://esm.run/three';
import { Chess } from 'https://esm.run/chess.js';
import * as Tone from 'https://esm.run/tone@14';

// esm.sh — alternative
import L from 'https://esm.sh/leaflet@1.9.4';
```

**Trade-off:** No reproducible build — version pinning is by URL. Acceptable
for demos and self-contained cards; document the pinned version in a comment.

Audio cards can also reach for the browser's built-in `AudioContext`
directly — no library load required (drums, tones, UI sound feedback via
`OscillatorNode` and friends).

---

## Lookup index

| I want to use…                                                                                                 | Tier | Import                                      |
| -------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------- |
| `CardDef`, `FieldDef`, `Component`                                                                             | 1    | `@cardstack/base/card-api`                  |
| `StringField`, `NumberField`, etc.                                                                             | 1    | `@cardstack/base/<type>`                    |
| `getCards`, `Command`                                                                                          | 2    | `@cardstack/runtime-common`                 |
| `Button`, `Chip`, `Input`, `Select` and the other components                                                   | 2    | `@cardstack/pretui/components/<name>`       |
| `Board` (drag/drop kanban), `Grid`                                                                             | 2    | `@cardstack/pretui/components/{board,grid}` |
| Formatting in templates: `FormatDate`, `FormatNumber`, `RelativeTime`, `FormatBytes`                           | 2    | `@cardstack/pretui/components/<name>`       |
| `eq`, `and`, `add` and the other logic helpers, `element`                                                      | 2    | `@cardstack/pretui/helpers`                 |
| Icons                                                                                                          | 2    | `@cardstack/boxel-icons/<name>`             |
| `cn`, `markdownEscape`, `MenuItemOptions`, formatters for strings built in JS (no Pret UI counterpart yet)     | 2    | `@cardstack/boxel-ui/helpers`               |
| `CardContainer`, `FittedCard`, `FilterList`, `KanbanPlacement`, `autoPlaceKanban` (no Pret UI counterpart yet) | 2    | `@cardstack/boxel-ui/components`            |
| Any host tool (`ai-assistant`, `switch-submode`, etc.)                                                         | 2    | `@cardstack/boxel-host/tools/<name>`        |
| `restartableTask`                                                                                              | 2    | `ember-concurrency`                         |
| `Resource`, `resource()`                                                                                       | 2    | `ember-resources`                           |
| `modifier()`                                                                                                   | 2    | `ember-modifier`                            |
| `tracked`, `GlimmerComponent`                                                                                  | 2    | `@glimmer/*`                                |
| Three.js, chess.js, etc.                                                                                       | 3    | `https://esm.run/<pkg>`                     |
| Tone.js (music toolkit)                                                                                        | 3    | `https://esm.run/tone@14` (pin major)       |
| Raw `AudioContext` (no library)                                                                                | n/a  | Built-in browser API                        |
