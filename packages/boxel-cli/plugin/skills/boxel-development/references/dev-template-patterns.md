### Template Essentials

**Field access patterns:**

```hbs
{{@model.title}}
<!-- Raw data -->
<@fields.title />
<!-- Field's template -->
<@fields.phone @format='atom' />
<!-- Compound field -->
<@fields.items @format='embedded' />
<!-- Auto-collection -->
```

For theming, CSS variables, spacing scales, and CSS safety rules, see Module 3: Theme-First Design System.

### `static markdown` templates

The `markdown` format emits plain text (Boxel Flavored Markdown), not HTML. A working default exists (HTML-to-markdown fallback), so only define `static markdown` when the default is poor. When you do, the same `<@fields.x />` delegation rules apply — children render their own `markdown` format, composed into the parent's output with whitespace preserved. See the `dev-markdown-format` skill for authoring details and the `dev-bfm-syntax` skill for the dialect.

#### ⚠️ CRITICAL: @model Iteration vs @fields Delegation

**Once you iterate with @model, you CANNOT delegate to @fields within that iteration.**

```hbs
<!-- ❌ BREAKS: Mixing @model iteration with @fields delegation -->
{{#each @model.teamMembers as |member|}}
  <@fields.member @format='embedded' />
  <!-- NO ACCESS to @fields.member -->
{{/each}}

<!-- ✅ OPTION 1: Use delegated rendering for the whole collection -->
<@fields.teamMembers @format='embedded' />

<!-- ✅ OPTION 2: Commit to full @model control -->
{{#each @model.teamMembers as |member|}}
  <div class='custom-member'>{{member.name}}</div>
{{/each}}

<!-- ✅ OPTION 3: If filtering needed, use query patterns -->
<!-- Use PrerenderedCardSearch or getCards for filtered collections -->
```

**Why this breaks:** @fields provides field-level components. Once you're iterating with @model, you're working with raw data, not field components.

**Decision Rule:** Before iterating, decide:

- Need composability? → Use delegated rendering
- Need filtering? → Use query patterns (PrerenderedCardSearch/getCards)
- Need custom control? → Use @model but handle ALL rendering yourself

#### ⚠️ CRITICAL: Block-Param Names Must Not Match HTML Tag Names

**A block param introduced by `as |x|` shadows any lowercase HTML tag with the same name inside the block.** In `.gts` strict mode, `<x>` is resolved as "invoke the block-param `x` as a component", _not_ as an HTML element. Picking block-param names that don't collide with HTML tags is the rule; this is about avoiding the footgun in the first place.

```hbs
<!-- ❌ block-param `s` shadows the <s> strikethrough tag -->
<Shell as |s|>
  <button disabled={{not s.isEditing}}><s>S</s></button>
</Shell>

<!-- ❌ block-param `section` shadows the <section> HTML5 element -->
{{#each this.sections as |section sectionIndex|}}
  <section class='content-section'>...</section>
{{/each}}

<!-- ❌ block-param `option` shadows the <option> tag -->
<BoxelSelect @options={{@model.options}} as |option|>
  <option />
</BoxelSelect>

<!-- ✅ rename the block param so it can't collide -->
<Shell as |shell|>
  <button disabled={{not shell.isEditing}}><s>S</s></button>
</Shell>

{{#each this.sections as |sec sectionIndex|}}
  <section class='content-section'>...</section>
{{/each}}

<BoxelSelect @options={{@model.options}} as |opt|>
  <option>{{opt.label}}</option>
</BoxelSelect>
```

**Avoid these block-param names** (HTML tags that commonly come up as iteration / yield-data names):

| Don't use                                              | Use instead                                |
| ------------------------------------------------------ | ------------------------------------------ |
| `s`, `b`, `i`, `u`, `q`                                | `surface`, `bold`, `item`, `unit`, `quote` |
| `section`                                              | `sec`                                      |
| `option`                                               | `opt`                                      |
| `a`                                                    | `link`, `anchor`                           |
| `p`                                                    | `para`                                     |
| `nav`, `header`, `footer`, `main`, `aside`, `article`  | qualify (`navData`, `pageHeader`, …)       |
| `form`, `input`, `button`, `label`, `select`, `option` | qualify                                    |
| `dt`, `dd`, `li`, `tr`, `td`, `th`                     | qualify                                    |
| `sub`, `sup`, `del`, `ins`                             | qualify                                    |

The safe rule: **block-param names should be at least 2 characters AND not match any HTML tag**. Multi-word names (`firstItem`, `selectedOption`, `currentSection`) are always safe. Short single-word names are fine if they're not tag names (`item`, `tile`, `bullet`, `member`, `task` etc.).

**Exception — when the block-param IS a component:** sometimes the yielded value is itself a card/field component you want to invoke (e.g. `<@fields.items as |Item|>` … `<Item @format='embedded' />`). In that case, **capitalize the block-param name** (TitleCase). Strict mode treats uppercase tags as components unconditionally — no shadowing concern, and the convention matches Ember's component-naming rules. The lowercase footgun only applies when the yielded value is data, not a component.

**If the rule is violated, the runtime symptom is generic and unhelpful:** Glimmer's component-manager lookup returns `null` for the shadowed name and crashes with

```
TypeError: Cannot read properties of null (reading 'manager')
```

…sometimes wrapped as `"Render binding desync"` in the indexer's error_doc with the TypeError buried in `additionalErrors[0]`. The error does NOT name the offending block-param or tag, and the same message can come from many other causes (any path where Glimmer is asked to invoke a `null` component reference). Treat the message as a hint to look for this footgun, _not_ as proof of it — but the easiest way not to chase the message is to not write the footgun in the first place.

### Accessing @fields by Index: The Bridge Pattern

**Use Case:** You need to use `@model` data to find specific items in a `containsMany` or `linksToMany` collection, then render those items using their field templates for proper delegated rendering.

**Key Concept:** The `get` helper allows you to access `@fields` array elements by index, creating a bridge between data-driven iteration and component-based rendering.

#### When to Use This Pattern

- **Filtering:** Show only items matching certain criteria
- **Conditional rendering:** Display items based on model data
- **Custom ordering:** Reorder items based on computed logic
- **Highlighted selection:** Emphasize specific items in a collection

#### Basic Pattern

```hbs
{{! Access a specific field by index }}
{{#let (get @fields.shoppingList 0) as |firstItem|}}
  {{#if firstItem}}
    <firstItem @format='embedded' />
  {{else}}
    <div class='no-item'>No first item</div>
  {{/if}}
{{/let}}

{{! Access last item using subtract helper }}
{{#let (get @fields.items (subtract @model.items.length 1)) as |lastItem|}}
  {{#if lastItem}}
    <lastItem @format='fitted' />
  {{/if}}
{{/let}}
```

#### Displaying Compound Fields

**CRITICAL:** When displaying compound fields (FieldDef types) like `PhoneNumberField`, `AddressField`, or custom field definitions, you must use their format templates, not raw model access:

```hbs
<!-- ❌ WRONG: Shows [object Object] -->
<p>Phone: {{@model.phone}}</p>

<!-- ✅ CORRECT: Uses the field's atom format -->
<p>Phone: <@fields.phone @format='atom' /></p>

<!-- ✅ CORRECT: For full field display -->
<div class='contact-info'>
  <@fields.phone @format='embedded' />
</div>
```

**💡 Line-saving tip:** Keep self-closing tags compact:

```hbs
<!-- Good: Saves vertical space -->
<@fields.author @format='embedded' />
<@fields.phone @format='atom' />
```

#### @fields Delegation Rule

**CRITICAL:** When delegating to embedded/fitted formats, you must iterate through `@fields`, not `@model`. Always use `@fields` for delegation, even for singular fields.

```hbs
<!-- ✅ CORRECT: Using @fields for both singular and collection fields -->
<@fields.author @format='embedded' />
<@fields.items @format='embedded' />
{{#each @fields.items as |item|}}
  <item @format='embedded' />
{{/each}}

<!-- ❌ WRONG: Can't iterate @model then try to delegate to @fields -->
{{#each @model.items as |item|}}
  <@fields.??? @format='embedded' />
  <!-- This won't work -->
{{/each}}
```

**containsMany Spacing Pattern:** Due to an additional wrapper div, target `.containsMany-field`:

```css
/* For grids */
.products-grid > .containsMany-field {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

/* For lists */
.items-list > .containsMany-field {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
```

### Template Fallback Value Patterns

**CRITICAL:** Boxel cards boot with no data by default. Templates must gracefully handle null, undefined, and empty string values at ALL levels of data access to prevent runtime errors and provide meaningful visual fallbacks.

#### Three Primary Patterns for Fallbacks

**1. Inline if/else (for simple display fallbacks):**

```hbs
<span>{{if
    @model.eventTime
    (formatDateTime @model.eventTime 'MMM D, h:mm A')
    'Event time to be announced'
  }}</span>
<h2>{{if @model.title @model.title 'Untitled Document'}}</h2>
<p>Status: {{if @model.status @model.status 'Status pending'}}</p>
```

**2. Block-based if/else (for complex content):**

```hbs
<div class='event-time'>
  {{#if @model.eventTime}}
    <strong>{{formatDateTime @model.eventTime 'MMM D, h:mm A'}}</strong>
  {{else}}
    <em class='placeholder'>Event time to be announced</em>
  {{/if}}
</div>

{{#if @model.description}}
  <div class='description'>
    <@fields.description />
  </div>
{{else}}
  <div class='empty-description'>
    <p>No description provided yet. Click to add one.</p>
  </div>
{{/if}}
```

**3. Unless for safety/validation checks (composed with other helpers):**

```hbs
{{unless
  (and @model.isValid @model.hasPermission)
  '⚠️ Cannot proceed - missing validation or permission'
}}
{{unless (or @model.email @model.phone) 'Contact information required'}}
{{unless (gt @model.items.length 0) 'No items available'}}
{{unless (eq @model.status 'active') 'Service unavailable'}}
```

**Best Practices:** Use descriptive placeholder text rather than generic "N/A", style placeholder text differently (lighter color, italic), use `unless` for safety checks and `if` for display fallbacks.

**Icon Usage:** Avoid emoji in templates (unless the application specifically calls for it) due to OS/platform variations that cause legibility issues. Use Boxel icons only for static card/field type icons (`static icon` property). In templates, use inline SVG instead since we can't be sure which Boxel icons exist.

### Template Array Handling Patterns

**CRITICAL:** Templates must gracefully handle all array states to prevent errors. Arrays can be undefined, null, empty, or populated.

#### The Three Array States

Your templates must handle:

1. **Completely undefined arrays** - Field doesn't exist or is null
2. **Empty arrays** - Field exists but has no items (`[]`)
3. **Arrays with actual data** - Field has one or more items

#### Array Logic Pattern

**❌ WRONG - Only checks for existence:**

```hbs
{{#if @model.goals}}
  <ul class='goals-list'>
    {{#each @model.goals as |goal|}}
      <li>{{goal}}</li>
    {{/each}}
  </ul>
{{/if}}
```

**✅ CORRECT - Checks for length and provides empty state:**

```hbs
{{#if @model.goals.length}}
  <div class='goals-section'>
    <h4>
      <svg
        width='16'
        height='16'
        class='section-icon'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
      >
        <circle cx='12' cy='12' r='10' />
        <circle cx='12' cy='12' r='6' />
        <circle cx='12' cy='12' r='2' />
      </svg>
      Daily Goals
    </h4>
    <ul class='goals-list'>
      {{#each @model.goals as |goal|}}
        <li>{{goal}}</li>
      {{/each}}
    </ul>
  </div>
{{else}}
  <div class='goals-section'>
    <h4>
      <svg
        width='16'
        height='16'
        class='section-icon'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
      >
        <circle cx='12' cy='12' r='10' />
        <circle cx='12' cy='12' r='6' />
        <circle cx='12' cy='12' r='2' />
      </svg>
      Daily Goals
    </h4>
    <p class='empty-state'>No goals set yet. What would you like to accomplish?</p>
  </div>
{{/if}}
```

**Remember:** When implementing templates via SEARCH/REPLACE, include tracking markers ⁿ for style blocks

### Real-World Example: Shopping List with Featured Items

```gts
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { get } from '@ember/helper';
import { subtract } from '@cardstack/boxel-ui/helpers';

export class FruitItem extends FieldDef {
  static displayName = 'Fruit';
  @field title = contains(StringField);
  @field quantity = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='fruit-item'>
        <span>{{if @model.title @model.title 'Unknown'}}</span>
        <span>{{if @model.quantity @model.quantity 0}} units</span>
      </div>
    </template>
  };
}

export class ShoppingList extends CardDef {
  static displayName = 'Shopping List';
  @field items = containsMany(FruitItem);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article>
        <h1><@fields.cardTitle /></h1>

        {{! Show first and last items using get helper }}
        <section class='featured'>
          <h2>First Item</h2>
          {{#let (get @fields.items 0) as |item|}}
            {{#if item}}
              <item @format='embedded' />
            {{else}}
              <p>No items</p>
            {{/if}}
          {{/let}}

          <h2>Last Item</h2>
          {{#let
            (get @fields.items (subtract @model.items.length 1))
            as |item|
          }}
            {{#if item}}
              <item @format='embedded' />
            {{/if}}
          {{/let}}
        </section>

        {{! Full list }}
        <section>
          <h2>All Items</h2>
          {{#if @model.items.length}}
            <@fields.items @format='embedded' class='items-container' />
          {{else}}
            <p>No items</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .items-container {
          gap: var(--boxel-sp-2xs);
        }
      </style>
    </template>
  };
}
```

#### Important Notes

**CRITICAL Safety Checks:**

- Always wrap `get` results in `{{#if}}` to handle undefined indices
- Use `subtract` helper for negative indexing (e.g., last item)
- Validate array length before accessing by index

**When NOT to Use:**

- If you need to iterate all items → use `<@fields.items />` delegation
- If you need custom rendering for each → use `{{#each @model.items}}` pattern
- For simple filtering → use query patterns with PrerenderedCardSearch

**Performance Consideration:**
The `get` helper is efficient for accessing specific indices. For complex filtering or transformation, consider using query patterns or computed properties instead.
