# Templates & Components

Boxel cards use Glimmer templates (`.gts` format) for their rendering. This guide covers the template system, component patterns, and the rendering API.

## Template Basics

Templates are defined as static properties on card classes:

```typescript
export class MyCard extends CardDef {
  static isolated = class extends Component<typeof MyCard> {
    <template>
      <h1>{{@model.title}}</h1>
      <@fields.body />
    </template>
  };
}
```

### The `<template>` Tag

The `<template>` tag defines the Glimmer template for the component. It supports:
- HTML elements
- Handlebars expressions (double curly braces)
- Component invocations (`<ComponentName />`)
- Field rendering (`<@fields.name />`)
- Helpers, modifiers, and blocks

## Template Arguments

### `@model`

The card instance. Use for direct value access:

```typescript
<template>
  <h1>{{@model.title}}</h1>
  <p>Posted on {{@model.publishDate}}</p>

  {{#if @model.isPublished}}
    <span class="badge">Published</span>
  {{/if}}
</template>
```

### `@fields`

Field rendering components. Use when you want the field to render itself:

```typescript
<template>
  {{! Field renders with its own template }}
  <@fields.title />

  {{! Field renders in a specific format }}
  <@fields.company @format="atom" />

  {{! In edit mode, fields become inputs }}
  <@fields.name />
</template>
```

### When to Use Which

| Need | Use | Example |
|------|-----|---------|
| Display raw value | `@model` | `{{@model.title}}` |
| Custom formatting | `@model` | `{{uppercase @model.name}}` |
| Conditional logic | `@model` | `{{#if @model.isActive}}` |
| Standard field render | `@fields` | `<@fields.title />` |
| Edit mode support | `@fields` | `<@fields.name />` |
| Format control | `@fields` | `<@fields.x @format="atom" />` |

## Glimmer Component Patterns

### Tracked State

```typescript
import { tracked } from '@glimmer/tracking';

static isolated = class extends Component<typeof MyCard> {
  @tracked isExpanded = false;
  @tracked selectedTab = 'overview';

  <template>
    <div class={{if this.isExpanded "expanded" "collapsed"}}>
      {{yield}}
    </div>
  </template>
};
```

### Actions

```typescript
import { action } from '@ember/object';
import { on } from '@ember/modifier';

static isolated = class extends Component<typeof MyCard> {
  @tracked count = 0;

  @action increment() {
    this.count++;
  }

  @action setTab(tab: string) {
    this.selectedTab = tab;
  }

  <template>
    <button {{on "click" this.increment}}>
      Count: {{this.count}}
    </button>
  </template>
};
```

### Helper Functions

```typescript
import { fn, hash } from '@ember/helper';

<template>
  <button {{on "click" (fn this.setTab "contacts")}}>
    Contacts
  </button>

  <MyComponent @options={{hash label="Hello" count=5}} />
</template>
```

### Conditionals and Loops

```typescript
<template>
  {{! Conditional }}
  {{#if @model.isPublished}}
    <span>Published</span>
  {{else if @model.isDraft}}
    <span>Draft</span>
  {{else}}
    <span>Unknown</span>
  {{/if}}

  {{! Loop }}
  {{#each @model.items as |item index|}}
    <div>{{index}}: {{item.name}}</div>
  {{/each}}

  {{! Inline conditional }}
  <div class={{if @model.isActive "active" "inactive"}}>
    Content
  </div>
</template>
```

## Using Boxel UI Components

Boxel UI provides a rich component library:

```typescript
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';

static isolated = class extends Component<typeof MyCard> {
  <template>
    <BoxelButton @kind="primary" @size="base" {{on "click" this.handleClick}}>
      <IconPlus /> Add Item
    </BoxelButton>
  </template>
};
```

### Common Boxel UI Components

| Component | Purpose |
|-----------|---------|
| `BoxelButton` | Styled buttons |
| `BoxelInput` | Text inputs |
| `BoxelSelect` | Dropdown selects |
| `BoxelDropdown` | Dropdown menus |
| `BoxelModal` | Modal dialogs |
| `BoxelHeader` | Page headers |
| `FieldContainer` | Labeled field wrapper |
| `Pill` | Tag/chip display |
| `CardContainer` | Card frame/wrapper |

## Container Queries for Fitted Format

The `fitted` format uses CSS container queries for responsive adaptation:

```typescript
static fitted = class extends Component<typeof MyCard> {
  <template>
    <div class="my-fitted">
      <div class="avatar">
        <@fields.avatar />
      </div>
      <div class="info">
        <strong><@fields.name /></strong>
        <span class="details"><@fields.email /></span>
      </div>
    </div>
    <style scoped>
      .my-fitted {
        display: flex;
        gap: var(--boxel-sp-sm);
        height: 100%;
        container-type: size;
      }

      /* Hide avatar when container is small */
      @container (max-height: 80px) {
        .avatar { display: none; }
      }

      /* Stack vertically when narrow */
      @container (max-width: 200px) {
        .my-fitted { flex-direction: column; }
      }

      /* Hide details when very compact */
      @container (max-height: 57px) {
        .details { display: none; }
      }
    </style>
  </template>
};
```

## Ember Concurrency Tasks

For async operations in templates:

```typescript
import { restartableTask } from 'ember-concurrency';

static isolated = class extends Component<typeof MyCard> {
  loadData = restartableTask(async () => {
    const response = await fetch('/api/data');
    return response.json();
  });

  <template>
    {{#if this.loadData.isRunning}}
      <p>Loading...</p>
    {{else if this.loadData.lastSuccessful}}
      <p>Data: {{this.loadData.lastSuccessful.value}}</p>
    {{/if}}

    <button {{on "click" (perform this.loadData)}}>
      Refresh
    </button>
  </template>
};
```

## External Components

For complex cards, extract components into separate files:

```typescript
// my-card/sidebar.gts
import Component from '@glimmer/component';

export class Sidebar extends Component {
  <template>
    <aside class="sidebar">
      {{yield}}
    </aside>
  </template>
}
```

```typescript
// my-card.gts
import { Sidebar } from './my-card/sidebar';

export class MyCard extends CardDef {
  static isolated = class extends Component<typeof MyCard> {
    <template>
      <Sidebar>
        <@fields.navigation />
      </Sidebar>
      <main>
        <@fields.content />
      </main>
    </template>
  };
}
```

## Next Steps

- [Styling Cards](/card-development/styling) — CSS and scoped styles
- [Defining Cards](/card-development/defining-cards) — Card patterns
- [Card Rendering](/core-concepts/card-rendering) — Format system
