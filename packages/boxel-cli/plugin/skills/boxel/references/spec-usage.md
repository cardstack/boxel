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
<Button @kind="primary" @size="small">Save</Button>
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
<@fields.author @format="embedded" />
<@fields.author @format="atom" />

{{! Display collection of linked cards }}
<div class="skills-container">
  <@fields.enabledSkills @format="embedded" />
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
<@fields.date @format="atom" />

{{! Display collection of contained fields }}
<div class="social-links">
  <@fields.socialLinks @format="embedded" />
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
  @placeholder="Select option"
  @options={{this.options}}
  @onChange={{this.onSelectOption}}
/>

{{! Custom components }}
<FilterDropdown @filters={{this.filters}} />
<CardsGrid @cards={{this.cards}} @columns={{3}} />

{{! Component with content }}
<Pill @variant="primary">
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
<@fields.primaryApp @format="fitted" />

{{! App navigation }}
<div class="app-grid">
  <@fields.availableApps @format="embedded" />
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

const someCommandInput = new CommandInput({...args})
const myCommand = new MyCommand(commandContext);
const result = await myCommand.execute(someCommandInput);
```