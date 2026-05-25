# Catalog Spec Card Instances

For each top-level card definition, write a Catalog Spec card instance in the target realm's `Spec/` folder. This makes the card discoverable in the Boxel catalog.

Specs adopt from the `Spec` class exported by `https://cardstack.com/base/spec` — that module lives in the base realm, not your target realm. Fetch the authoritative schema by calling the `get_card_schema` factory tool:

```
get_card_schema({ module: 'https://cardstack.com/base/spec', name: 'Spec' })
```

The result gives you the exact `attributes` and `relationships` shape. Write the JSON file with native `Write` (paths are workspace-relative, e.g. `Spec/sticky-note.json`); `boxel sync` pushes it to the realm between iterations.

## Required Shape

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "specType": "card",
      "ref": { "module": "../sticky-note", "name": "StickyNote" },
      "readMe": "...",
      "cardInfo": { "name": "Sticky Note", "summary": "..." }
    },
    "relationships": {
      "linkedExamples.0": { "links": { "self": "../StickyNote/welcome-note" } }
    },
    "meta": {
      "adoptsFrom": {
        "module": "https://cardstack.com/base/spec",
        "name": "Spec"
      }
    }
  }
}
```

Key concepts:

- `ref` — a CodeRef pointing to the card definition (module path + exported class name). The module path is relative from the Spec card to the `.gts` file (e.g., `../sticky-note` from `Spec/sticky-note.json`).
- `specType` — `"card"` for CardDef, `"field"` for FieldDef, `"component"` for standalone components.
- `linkedExamples` — a `linksToMany` relationship pointing to sample card instances. Use dotted keys (`linkedExamples.0`, `linkedExamples.1`, …) — the array form is rejected by the indexer. Create at least one sample instance and link it here.
- **Do NOT call `run_instantiate` on the Spec file itself.** Spec's module lives in the base realm; the prerender enforces same-origin module loads and the call always fails. To validate Specs, call `run_instantiate` WITHOUT a `path`; it discovers Specs in the target realm and exercises their `linkedExamples` against the card classes you wrote.

## Sample Card Instances

Create at least one sample instance with realistic data for each top-level card. Sample instances serve as both catalog examples and test fixtures.

Place sample instances in a folder named after the card type (e.g., `StickyNote/welcome-note.json`) and write them with native `Write`. The `linkedExamples` relationship in the Spec card points to these using a relative path without the `.json` suffix (e.g., `../StickyNote/welcome-note`).

---

# Spec Type Usage Patterns

Below are usage patterns for each `specType`, showing how each type of definition is imported and used in code.

**Card specs (linksTo/linksToMany):**

```gts
import { Author } from './author';
@field author = linksTo(Author);
@field contributors = linksToMany(Author);
```

**Field specs (contains/containsMany):**

```gts
import StringField from 'https://cardstack.com/base/string';
import AddressField from 'https://cardstack.com/base/address-field';
@field name = contains(StringField);
@field addresses = containsMany(AddressField);
```

**Component specs (direct template usage):**

```hbs
<BoxelSelect @options={{this.options}} />
<Button @kind='primary' @size='small'>Save</Button>
```

**Command specs (programmatic execution):**

```ts
const cmd = new MyCommand(commandContext);
const result = await cmd.execute(input);
```

## Spec Usage Examples

A Spec is a comprehensive documentation and metadata container for code within the Boxel ecosystem.

This document provides real-world usage examples for each spec type based on actual implementations found in the Boxel repository.

### Card Specs (`specType: 'card'`)

(Cards are linked to using `linksTo` and `linksToMany` within consuming cards...)

#### Import

```typescript
import { Author } from './author';
import { Country } from 'https://cardstack.com/base/country';
import { Skill } from 'https://cardstack.com/base/skill';
```

#### Usage as a Field

```typescript
export class BlogPost extends CardDef {
  // Single card reference
  @field author = linksTo(Author);
  @field country = linksTo(Country);

  // Multiple card references
  @field enabledSkills = linksToMany(Skill);
  @field attachedCards = linksToMany(CardDef);
}
```

#### Template Usage

```handlebars
{{! Display linked card in different formats }}
<@fields.author @format='embedded' />
<@fields.author @format='atom' />

{{! Display collection of linked cards }}
<div class='skills-container'>
  <@fields.enabledSkills @format='embedded' />
</div>
```

### Field Specs (`specType: 'field'`)

(Fields are embedded using `contains` and `containsMany` within cards.)

#### Import

```typescript
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import { SocialMediaLink } from './social-media-link';
```

#### Usage as a Field

```typescript
export class MinecraftInvite extends CardDef {
  // Basic field types
  @field celebrantName = contains(StringField);
  @field age = contains(StringField);
  @field date = contains(DateField);

  // Custom field types
  @field socialLinks = containsMany(SocialMediaLink);
}
```

#### Template Usage

```handlebars
{{! Display contained fields }}
<@fields.celebrantName />
<@fields.date @format='atom' />

{{! Display collection of contained fields }}
<div class='social-links'>
  <@fields.socialLinks @format='embedded' />
</div>
```

### Component Specs (`specType: 'component'`)

(Components are used directly in templates, extending GlimmerComponent...)

#### Import

```typescript
import { BoxelSelect, Pill } from '@cardstack/boxel-ui/components';
import { FilterDropdown } from './filter-dropdown';
import { CardsGrid } from './cards-grid';
```

#### Usage in Templates

```handlebars
{{! Basic component usage }}
<BoxelSelect
  @placeholder='Select option'
  @options={{this.options}}
  @onChange={{this.onSelectOption}}
/>

{{! Custom components }}
<FilterDropdown @filters={{this.filters}} />
<CardsGrid @cards={{this.cards}} @columns={{3}} />

{{! Component with content }}
<Pill @variant='primary'>
  Active Status
</Pill>
```

### App Specs (`specType: 'app'`)

(Apps extend AppCard and are typically linked to like regular cards...)

#### Import

```typescript
import { AppCard } from '/experiments/app-card';
import { GardenAppCard } from './garden-app';
```

#### Usage as a Field

```typescript
export class Dashboard extends CardDef {
  @field primaryApp = linksTo(GardenAppCard);
  @field availableApps = linksToMany(AppCard);
}
```

#### Template Usage

```handlebars
{{! Display app in card context }}
<@fields.primaryApp @format='fitted' />

{{! App navigation }}
<div class='app-grid'>
  <@fields.availableApps @format='embedded' />
</div>
```

### Command Specs (`specType: 'command'`)

(Commands are instantiated and executed programmatically.)

#### Import

```typescript
import { GenerateReadmeSpecCommand } from './generate-readme-spec';
import { SwitchSubmodeCommand } from './switch-submode';
import { UpdatePlaygroundSelectionCommand } from './update-playground-selection';
```

#### Template Usage

When you need to execute commands in response to user interactions, you can just access the commandContext and invoke it as how you would a simple async function in javascript

```typescript
let commandContext = this.args.context?.commandContext;
if (!commandContext) {
  console.error('Command context not available');
  return;
}

const someCommandInput = new CommandInput({ ...args });
const myCommand = new MyCommand(commandContext);
const result = await myCommand.execute(someCommandInput);
```
