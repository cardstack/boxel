### The Cardinal Rule

**MOST CRITICAL RULE:**

```gts
// ✅ CORRECT
@field author = linksTo(Author);          // CardDef
@field address = contains(AddressField);  // FieldDef

// ❌ WRONG - Will break everything
@field author = contains(Author);         // NEVER!
@field address = linksTo(AddressField);   // NEVER!
```

**Must export ALL classes:**

```gts
export class MyCard extends CardDef { }  // ✅
class MyCard extends CardDef { }         // ❌ Missing export
```

**Computed fields:**

- Keep simple and unidirectional
- No self-reference or cycles
- Wrap cross-card access in try-catch

## Technical Rules

### THE CARDINAL RULE: contains vs linksTo

**THIS IS THE #1 MOST CRITICAL RULE IN BOXEL:**

| Type                 | MUST Use                    | NEVER Use                      | Why                                             |
| -------------------- | --------------------------- | ------------------------------ | ----------------------------------------------- |
| **Extends CardDef**  | `linksTo` / `linksToMany`   | ❌ `contains` / `containsMany` | CardDef = independent entity with own JSON file |
| **Extends FieldDef** | `contains` / `containsMany` | ❌ `linksTo` / `linksToMany`   | FieldDef = embedded data, no separate identity  |

```gts
// ✅ CORRECT
@field author = linksTo(Author);              // Author extends CardDef
@field address = contains(AddressField);      // AddressField extends FieldDef

// ❌ WRONG
@field author = contains(Author);             // NEVER!
@field address = linksTo(AddressField);       // NEVER!
```

### MANDATORY TECHNICAL REQUIREMENTS

1. **Always use SEARCH/REPLACE with tracking for .gts files**
2. **Export ALL CardDef and FieldDef classes inline**
3. **Never use reserved words as field names**
4. **Keep computed fields simple and unidirectional**
5. **No JavaScript in templates**
6. **Wrap delegated collections with spacing containers**

### TECHNICAL VALIDATION CHECKLIST

Before generating ANY code:

- [ ] SEARCH/REPLACE blocks with tracking markers
- [ ] Every CardDef field uses `linksTo`/`linksToMany`
- [ ] Every FieldDef field uses `contains`/`containsMany`
- [ ] All classes have `export` keyword inline
- [ ] No reserved words as field names
- [ ] No duplicate field definitions
- [ ] Computed fields are simple (no cycles!)
- [ ] Try-catch blocks wrap cross-card data access
- [ ] No JavaScript operations in templates
- [ ] ALL THREE FORMATS: isolated, embedded, fitted

### Glint (ember-tsc) Type Checking Patterns

The factory runs `ember-tsc` (glint) on all `.gts` and `.ts` files to catch type errors. These patterns avoid common glint failures:

#### Decorators inside inline class assignments

Glint does not support decorators (`@tracked`, etc.) on fields inside an inline class expression assigned to a static property. Declare the component class separately:

```gts
// ❌ WRONG — "Decorators are not valid here"
export class StickyNote extends CardDef {
  static isolated = class Isolated extends Component<typeof StickyNote> {
    @tracked editMode = false;  // glint error!
    <template>...</template>
  };
}

// ✅ CORRECT — declare the class outside the assignment
class Isolated extends Component<typeof StickyNote> {
  @tracked editMode = false;
  <template>...</template>
}

export class StickyNote extends CardDef {
  static isolated = Isolated;
}
```

Note: `@field` decorators on `CardDef`/`FieldDef` classes work fine — this restriction only applies to component classes using `@tracked` or similar decorators.

#### Typing dynamic imports in test files

When test files use `loader.import()`, the return type is `{}` by default. Destructuring a named export from it causes "Property does not exist on type '{}'":

```gts
// ❌ WRONG — "Property 'StickyNote' does not exist on type '{}'"
let { StickyNote } = await loader.import(cardModuleUrl);

// ✅ CORRECT — cast the import result
let { StickyNote } = (await loader.import(cardModuleUrl)) as Record<string, any>;
```

#### Accessing cardInfo properties in computeVia

`CardDef.cardInfo` is a `CardInfoField` (FieldDef) with these fields: `name`, `summary`, `cardThumbnailURL`, `cardThumbnail`, `theme`, `notes`. Access them directly — they are properly typed:

```gts
// ✅ CORRECT — access cardInfo fields directly (they are typed)
@field cardTitle = contains(StringField, {
  computeVia: function (this: MyCard): string {
    return this.cardInfo?.name?.trim()?.length
      ? this.cardInfo.name
      : this.headline ?? 'Untitled';
  },
});

// ❌ WRONG — these fields don't exist on CardInfoField
this.cardInfo.title       // use .name instead
this.cardInfo.description // use .summary instead
this.cardInfo.thumbnailURL // use .cardThumbnailURL instead
```

**Note:** The computed pass-through fields on CardDef are named `cardTitle` (not `title`), `cardDescription` (not `description`), and `cardThumbnailURL`. Override these — not fields named `title`/`description`.

#### Explicit types for function parameters

Glint enforces strict mode. Always type function parameters and return values:

```gts
// ❌ WRONG — implicit any
greet = (name) => `Hello, ${name}!`;

// ✅ CORRECT
greet = (name: string): string => `Hello, ${name}!`;
```

#### Unused imports from Ember shims

If you import from `@ember/helper`, `@ember/modifier`, or `@glimmer/tracking`, only import what you actually use. Glint enforces `noUnusedLocals` in the factory's type checking configuration. Remove unused imports rather than suppressing the error.

### Common Mistakes

#### Using contains with CardDef

```gts
// ❌ WRONG
@field items = containsMany(Item); // Item is CardDef

// ✅ CORRECT
@field items = linksToMany(Item);
```

#### Missing Exports

```gts
// ❌ WRONG
class BlogPost extends CardDef { }

// ✅ CORRECT
export class BlogPost extends CardDef { }
```
