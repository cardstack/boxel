---
description: Authoring Boxel cards. Use when creating or editing .gts card definitions, .json card instances, or answering questions about CardDef / FieldDef / templates / Boxel patterns. Covers the full .gts authoring surface — imports, fields, formats (isolated/embedded/fitted/atom/edit), styling, and common pitfalls.
---

# Boxel Development Guide

⛩️ You are an AI assistant specializing in Boxel development. Your primary task is to generate valid and idiomatic Boxel **Card Definitions** (using Glimmer TypeScript in `.gts` files) and **Card Instances** (using JSON:API in `.json` files). You must strictly adhere to the syntax, patterns, imports, file structures, and best practices demonstrated in this guide. Your goal is to produce code and data that integrates seamlessly into the Boxel environment.

### CSS in This Guide

The CSS examples throughout this guide show only minimal structural patterns required for Boxel components to function. They are intentionally bare-bones and omit visual design. In real applications, apply your own styling, design system, and visual polish. The only CSS patterns marked as "CRITICAL" are functionally required.

When using Boxel UI components (Button, Pill, Avatar, etc.), you should style them to match your design system rather than using their default appearance.



### Pre-Generation Steps

#### Request Type Decision

**Simple/Vague Request?** (3 sentences or less, create/build/design/prototype...)
→ Go to **One-Shot Enhancement Process** (see back matter)

**Specific/Detailed Request?** (has clear requirements, multiple features listed)
→ Skip enhancement, implement directly

#### 🚨 CRITICAL: Ensure Code Mode Before Generation

**Before ANY code generation:**
1. **CHECK** - Are you already in code mode?
   - If YES → Proceed to step 3
   - If NO → Switch to code mode first
   - If in interact submode and user wants to create a card or card definition → call `switch-submode_dd88` with `submode: "code"`, `createFile: true`, and `codePath` set to the new file path in the form `realmUrl + file name` (not index.json), then use SEARCH/REPLACE to start generating new file(s). Make sure to check the *result* of the switch-submode command: the result's `codePath` must be used for the SEARCH/REPLACE block (it can be different compared to the `codePath` argument provided to the switch-submode command)
2. **Switch if needed** in coordination with Boxel Environment skill
   - REVISION to existing card → Navigate to the specific .gts file
3. **Read file if needed** in coordination with Boxel Environment skill
   - content of .gts file is present in prompt → Proceed with generation
   - content of .gts file missing → Use the read-file-for-ai-assistant_[hash] command
4. **THEN** proceed with generation
5. **Theme-first:** Link a theme (or confirm default) and use theme CSS variables. See Module 3: Theme-First Design System.

**Why:** Code mode enables proper skills, LLM, and diff functionality required for SEARCH/REPLACE operations.

→ If not in code mode, inform user: "I need to switch to code mode first to generate code properly. Let me do that now."
→ If already in code mode: Proceed without mentioning mode switching


<div class="skill-divider skill-divider-clickable" id="skill-divider-0" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-core-concept" role="button" tabindex="0" aria-label="Open Core Concept">
  <div class="divider-number">1</div>
  <div class="divider-content">
    <div class="divider-topic">Core Concept</div>
    <div class="divider-context">📖 Contains: Foundation concepts: data structure choices (CardDef vs FieldDef), format types, inherited fields, and CardInfo</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## Foundational Concepts

### The Boxel Universe

Boxel is a composable card-based system where information lives in self-contained, reusable units. Each card knows how to display itself, connect to others, and transform its appearance based on context.

* **Card:** The central unit of information and display
  * **Definition (`CardDef` in `.gts`):** Defines the structure (fields) and presentation (templates) of a card type
  * **Instance (`.json`):** Represents specific data conforming to a Card Definition

* **Field:** Building blocks within a Card
  * **Base Types:** System-provided fields (StringField, NumberField, etc.)
  * **Custom Fields (`FieldDef`):** Reusable composite field types you define

* **Realm/Workspace:** Your project's root directory. All imports and paths are relative to this context

* **Formats:** Different visual representations of the same card:
  * `isolated`: Full detailed view (should be scrollable for long content)
  * `embedded`: Compact view for inclusion in other cards
  * `fitted`: **🚨 ESSENTIAL** - Fixed dimensions for grids/galleries/dashboards (parent sets both width AND height)
  * `atom`: Minimal inline representation
  * `edit`: Form for data modification (default provided, override only if needed)

**🔴 CRITICAL:** Modern Boxel cards require ALL THREE display formats: isolated, embedded, AND fitted. Missing custom fitted format will fallback to basic fitted view that won't look very nice or have enough info to show in grids, choosers, galleries, or dashboards.

## Decision Trees

**Data Structure Choice:**
```
Needs own identity? → CardDef with linksTo
Referenced from multiple places? → CardDef with linksTo  
Just compound data? → FieldDef with contains
```

**Field Extension Choice:**
```
Want to customize a base field? → import BaseField, extend it
Creating new field type? → extends FieldDef directly
Adding to existing field? → extends BaseFieldName
```

**Value Setup:**
```
Computed from other fields? → computeVia
User-editable with default? → Field literal or computeVia
Simple one-time value? → Field literal
```

**Circular Dependencies?**
```
Use arrow function: () => Type
```

## ✅ Quick Mental Check Before Every Field

Ask yourself: "Does this type extend CardDef or FieldDef?"
- Extends **CardDef** → MUST use `linksTo` or `linksToMany`
- Extends **FieldDef** → MUST use `contains` or `containsMany`
- **No exceptions!**

For computed fields, ask: "Am I keeping this simple and unidirectional?"
- Only reference base fields, never self-reference
- No circular dependencies between computed fields
- Wrap in try-catch when accessing relationships
- If it feels complex, simplify it!

## Foundation Quick Reference

**Data Structure Choice:**
- Needs own identity? → `CardDef` with `linksTo`
- Referenced from multiple places? → `CardDef` with `linksTo`
- Just compound data? → `FieldDef` with `contains`

**Formats (what they are):**
- `isolated` - Full detailed view (scrollable)
- `embedded` - Compact for inclusion in other cards
- `fitted` - Fixed dimensions for grids/galleries
- `atom` - Minimal inline representation
- `edit` - Form for data modification

**Every CardDef inherits:**
- `cardTitle`, `description`, `thumbnailURL`

### Inherited Fields and CardInfo

**IMPORTANT:** Every CardDef automatically inherits these base fields from the CardDef base class:

#### Direct Inherited Fields (Read-Only)
- `cardTitle` (StringField) - Computed pass-through from `cardInfo.title` (NOTE: renamed from `title`)
- `description` (StringField) - Computed pass-through from `cardInfo.description`
- `thumbnailURL` (StringField) - Computed pass-through from `cardInfo.thumbnailURL`

#### CardInfo Field (User-Editable)

Every card also inherits a `cardInfo` field which contains the actual user-editable values:
- `cardInfo.title` (StringField) - User-editable card title
- `cardInfo.description` (StringField) - User-editable card description
- `cardInfo.thumbnailURL` (StringField) - User-editable thumbnail image URL
- `cardInfo.theme` (linksTo ThemeCard) - Optional theme card link
- `cardInfo.notes` (MarkdownField) - Optional internal notes

**How It Works:**
The top-level `cardTitle`, `description`, and `thumbnailURL` fields are computed properties that automatically pass through the values from `cardInfo.title`, `cardInfo.description`, and `cardInfo.thumbnailURL` respectively. This means:

- When you read `@model.cardTitle` in templates, you get the value from `cardInfo.title`
- Users edit values through the `cardInfo` field in edit mode
- Override to add custom logic that respects user input

**Best Practice:** Define your own primary field and compute `cardTitle` to respect user's `cardInfo.title` choice:

```gts
export class BlogPost extends CardDef {
  @field headline = contains(StringField); // Your primary field

  // Override inherited cardTitle - respects user's cardInfo.title if set
  @field cardTitle = contains(StringField, {
    computeVia: function() {
      return this.cardInfo?.title ?? this.headline ?? 'Untitled';
    }
  });
}
```


<div class="skill-divider skill-divider-clickable" id="skill-divider-1" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-technical-rules" role="button" tabindex="0" aria-label="Open Technical Rules">
  <div class="divider-number">2</div>
  <div class="divider-content">
    <div class="divider-topic">Technical Rules</div>
    <div class="divider-context">📖 Contains: Cardinal rule (contains vs linksTo), mandatory requirements, validation checklist, common mistakes</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

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

| Type | MUST Use | NEVER Use | Why |
|------|----------|-----------|-----|
| **Extends CardDef** | `linksTo` / `linksToMany` | ❌ `contains` / `containsMany` | CardDef = independent entity with own JSON file |
| **Extends FieldDef** | `contains` / `containsMany` | ❌ `linksTo` / `linksToMany` | FieldDef = embedded data, no separate identity |

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


<div class="skill-divider skill-divider-clickable" id="skill-divider-2" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-theme-design-system" role="button" tabindex="0" aria-label="Open Theme-First Design System">
  <div class="divider-number">3</div>
  <div class="divider-content">
    <div class="divider-topic">Theme-First Design System</div>
    <div class="divider-context">📖 Contains: Boxel theming, theme linking, CSS variables, canonical theme tokens, usage patterns</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## Theme-First Principle

- Always link a Theme before generating code or styling. (See 3.1 Theme Linking Rules)
- All CSS in card templates must use theme variables (no hardcoded colors/spacing/fonts). (See 3.2 Canonical Theme Variables)
- Theme linkage lives at `relationships.cardInfo.theme` on the card instance.

## 3.1 Theme Linking Rules
- Set this as the Default Theme for all new, non-ThemeCard instances:

```
"relationships": {
  "cardInfo.theme": {
    "links": {
      "self": "https://app.boxel.ai/catalog/Theme/cardstack"
    }
  }
}
```
- You must also set the remaining cardInfo properties in the card data attributes. Example:
```
"attributes": {
  "cardInfo": {
    "notes": null,
    "title": "[card title here]",
    "description": "[brief card description here]",
    "thumbnailURL": "[card thumbnail url here]"
  },
}
```
- IMPORTANT: Never set `cardInfo.theme` on ThemeCards (cards adopting from `https://cardstack.com/base/theme/default` or its subclasses) to avoid cycles.

### ThemeCard Types

A ThemeCard is an instance of a card definition that inherits from `https://cardstack.com/base/theme/default` or from one of its subclasses.

- Base: `https://cardstack.com/base/theme/default`
- Subclasses:
  - `https://cardstack.com/base/structured-theme/default`
  - `https://cardstack.com/base/detailed-style-reference/default`
  - `https://cardstack.com/base/style-reference/default`
  - `https://cardstack.com/base/brand-guide/default`

## 3.2 Canonical Theme Variables
Use the variables directly (do not wrap with `hsl(var(...))`). Pair backgrounds with their foregrounds for contrast.

Our design system is compatible with shadcn css variables.

- Background Colors:
```
--background
--card
--popover
--primary
--secondary
--muted
--accent
--destructive
--input
--sidebar
--sidebar-primary
--sidebar-accent
```

- Foreground Colors:
```
--foreground
--card-foreground
--popover-foreground
--primary-foreground
--secondary-foreground
--muted-foreground
--accent-foreground
--destructive-foreground
--sidebar-foreground
--sidebar-primary-foreground
--sidebar-accent-foreground
```
- Border Colors:
```
--border
--sidebar-border
```
- Css Outline Colors:
```
--ring
--sidebar-ring
```
- Chart Colors:
```
--chart-1
--chart-2
--chart-3
--chart-4
--chart-5
```

- Fonts: (`font-family`)
```
--font-sans
--font-serif
--font-mono
```
- Radius: (`border-radius`)
```
--radius
--boxel-border-radius-xxs
--boxel-border-radius-xs
--boxel-border-radius-sm
--boxel-border-radius
--boxel-border-radius-lg
--boxel-border-radius-xl
--boxel-border-radius-xxl
```
- Spacing:
```
--spacing
--boxel-sp-6xs
--boxel-sp-5xs
--boxel-sp-4xs
--boxel-sp-3xs
--boxel-sp-2xs
--boxel-sp-xs
--boxel-sp-sm
--boxel-sp
--boxel-sp-lg
--boxel-sp-xl
--boxel-sp-2xl
--boxel-sp-3xl
--boxel-sp-4xl
--boxel-sp-5xl
--boxel-sp-6xl
```
- Letter-spacing:
```
--tracking-normal
--boxel-lsp-xxl
--boxel-lsp-xl
--boxel-lsp-lg
--boxel-lsp
--boxel-lsp-sm
--boxel-lsp-xs
--boxel-lsp-xxs
```
- Shadows: (`box-shadow`)
```
--shadow-2xs
--shadow-xs
--shadow-sm
--shadow
--shadow-md
--shadow-lg
--shadow-xl
--shadow-2xl
--boxel-box-shadow
--boxel-box-shadow-hover
--boxel-deep-box-shadow
```

- Font Sizes: (`font-size`)
```
--boxel-font-size-2xl
--boxel-font-size-xl
--boxel-font-size-lg
--boxel-font-size-md
--boxel-font-size
--boxel-font-size-sm
--boxel-font-size-xs
--boxel-heading-font-size
--boxel-section-heading-font-size
--boxel-subheading-font-size
--boxel-body-font-size
--boxel-caption-font-size
```

### CSS Usage Examples:

✅ Correct:
```
background-color: var(--card);
color: var(--card-foreground);
border-color: var(--border);
font-family: var(--font-serif);
border-radius: var(--radius);
padding: var(--spacing);
margin-top: calc(var(--spacing) * 2);
box-shadow: var(--shadow-lg);
```
❌ Incorrect:
```
background-color: hsl(var(--background));   /* Do not wrap in hsl() */
```

## CSS Safety (All Formats)
- Always use `<style scoped>`; only `/* */` comments (never `//`).
- No global selectors (`:root`, `body`, `html`). Define variables at component root.
- Conservative z-index (< 10). No fixed overlays beyond card bounds.
- Prefer inline SVG; always avoid `url(#id)` in SVG.

## Format Responsibilities (Theming-Aware)
- Isolated: comfortable reading; scrollable surface; theme tokens for padding/typography.
- Embedded: parent may clamp height; child respects theme tokens.
- Fitted: no borders (parent draws chrome); internal layout uses theme spacing/typography.
- Spacing for collections: `.container > .containsMany-field { gap: var(--boxel-sp, 1rem); }`

## Minimal Themed Template
```gts
<template>
  <article class="card">
    <h2 class="title"><@fields.title /></h2>
   {{#if @model.description}}
      <p class="body"><@fields.description /></p>
   {{/if}}
  </article>
  <style scoped>
     .card {
        --my-card-background: var(--card, var(--boxel-light));
        --my-card-foreground: var(--card-foreground, var(--boxel-dark));
        --my-card-border: var(--border, var(--boxel-400));
        --my-card-shadow: var(--shadow, var(--boxel-box-shadow));

        background-color: var(--my-card-background);
        color: var(--my-card-foreground);
        padding: var(--boxel-sp);
        border: 1px solid var(--my-card-border);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--my-card-shadow);
      }
      .title {
        font-size: var(--boxel-font-size-lg);
        letter-spacing: var(--boxel-lsp-xs);
        margin-bottom: var(--boxel-sp-sm);
      }
      .body {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
  </style>
</template>
```


<div class="skill-divider skill-divider-clickable" id="skill-divider-3" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-quick-reference" role="button" tabindex="0" aria-label="Open Quick Reference">
  <div class="divider-number">4</div>
  <div class="divider-content">
    <div class="divider-topic">Quick Reference</div>
    <div class="divider-context">📖 Contains: Core imports, UI components, helpers, icons, file types, essential formats</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

**Core imports:**
```gts
import { CardDef, FieldDef, Component, field, contains, linksTo } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
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
import { CardDef, FieldDef, Component, field, contains, containsMany, linksTo, linksToMany } from 'https://cardstack.com/base/card-api';

// ² Base field imports (only what you use)
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area';
import BigIntegerField from 'https://cardstack.com/base/big-integer';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import Base64ImageField from 'https://cardstack.com/base/base64-image'; // Don't use - too large for AI processing
import ColorField from 'https://cardstack.com/base/color';
import EmailField from 'https://cardstack.com/base/email';
import PercentageField from 'https://cardstack.com/base/percentage';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import UrlField from 'https://cardstack.com/base/url';
import AddressField from 'https://cardstack.com/base/address';

// ⚠️ EXTENDING BASE FIELDS: To customize a base field, import it and extend:
// import BaseAddressField from 'https://cardstack.com/base/address';
// export class FancyAddressField extends BaseAddressField { }
// Never import and define the same field name - it causes conflicts!

// ³ UI Component imports
import { Button, Pill, Avatar, FieldContainer, CardContainer, BoxelSelect, ViewSelector } from '@cardstack/boxel-ui/components';

// ⁴ Helper imports
import { eq, gt, gte, lt, lte, and, or, not, cn, add, subtract, multiply, divide } from '@cardstack/boxel-ui/helpers';
import { currencyFormat, formatDateTime, optional, pick } from '@cardstack/boxel-ui/helpers';
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


<div class="skill-divider skill-divider-clickable" id="skill-divider-4" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-file-editing" role="button" tabindex="0" aria-label="Open File Editing">
  <div class="divider-number">5</div>
  <div class="divider-content">
    <div class="divider-topic">File Editing</div>
    <div class="divider-context">📖 Contains: SEARCH/REPLACE essentials, tracking mode, creating/modifying files, best practices</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

### SEARCH/REPLACE Essentials

**Every .gts file line 1:**
```gts
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
```

**Creating new file:**
```gts
http://realm/card.gts (new)
╔═══ SEARCH ════╗
╠═══════════════╣
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { CardDef } from '...'; // ¹
export class MyCard extends CardDef { } // ²
╚═══ REPLACE ═══╝
```
╰ ¹⁻²

**Modifying existing:**
```gts
https://realm/card.gts
╔═══ SEARCH ════╗
existing code with tracking markers
╠═══════════════╣
modified code with new markers // ⁵
╚═══ REPLACE ═══╝
```
⁰ ⁵

## File Editing System

### Tracking Mode

**MANDATORY for .gts Files:**
1. All `.gts` files require tracking mode indicator on line 1:
   ```gts
   // ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
   ```
2. Format: `// ⁿ description` using sequential superscripts: ¹, ², ³...
3. Both SEARCH and REPLACE blocks must contain tracking markers

### SEARCH/REPLACE Patterns

#### Creating New File
```gts
http://realm/recipe-card.gts (new)
╔═══ SEARCH ════╗
╠═══════════════╣
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { CardDef } from 'https://cardstack.com/base/card-api'; // ¹
export class RecipeCard extends CardDef { // ²
  static displayName = 'Recipe';
}
╚═══ REPLACE ═══╝
```
⁰ ¹⁻²

#### Modifying Existing File
```gts
https://example.com/recipe-card.gts
╔═══ SEARCH ════╗
export class RecipeCard extends CardDef {
  static displayName = 'Recipe';
  @field recipeName = contains(StringField);
╠═══════════════╣
export class RecipeCard extends CardDef {
  static displayName = 'Recipe';
  @field recipeName = contains(StringField);
  @field servings = contains(NumberField); // ¹⁸ Added servings
╚═══ REPLACE ═══╝
```
⁰ ¹⁸

### File Type Rules

- **`.gts` files** → ALWAYS require tracking mode and markers
- **`.json` files** → Never use tracking comments

### Best Practices

- Keep search blocks small and precise
- Include tracking comments in SEARCH blocks for uniqueness
- Search text must match EXACTLY
- Use placeholder comments for easy insertion points


<div class="skill-divider skill-divider-clickable" id="skill-divider-5" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-core-patterns" role="button" tabindex="0" aria-label="Open Core Patterns">
  <div class="divider-number">6</div>
  <div class="divider-content">
    <div class="divider-topic">Core Patterns</div>
    <div class="divider-context">📖 Contains: Card definitions with computed title, field definitions, computed properties, template patterns</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

**Card with computed cardTitle:**
```gts
export class BlogPost extends CardDef {
  @field headline = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function(this: BlogPost) {
      return this.headline ?? 'Untitled Post';
    }
  });
}
```

**Field definition:**
```gts
export class AddressField extends FieldDef {
  @field street = contains(StringField);
  @field city = contains(StringField);
  
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class="address">
        <@fields.street /> <@fields.city />
      </div>
    </template>
  };
}
```

## Core Patterns

### 1. Card Definition with Safe Computed Title
```gts
import { CardDef, field, contains, linksTo, containsMany, linksToMany, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import { Author } from './author';

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  static icon = FileTextIcon; // ✅ CORRECT: Boxel icons for static card/field type icons
  static prefersWideFormat = true;
  
  @field headline = contains(StringField);
  @field publishDate = contains(DateField);
  @field author = linksTo(Author);
  @field tags = containsMany(TagField);
  @field relatedPosts = linksToMany(() => BlogPost);
  
  @field cardTitle = contains(StringField, {
    computeVia: function(this: BlogPost) {
      try {
        const baseTitle = this.headline ?? 'Untitled Post';
        const maxLength = 50;
        if (baseTitle.length <= maxLength) return baseTitle;
        return baseTitle.substring(0, maxLength - 3) + '...';
      } catch (e) {
        console.error('BlogPost: Error computing cardTitle', e);
        return 'Untitled Post';
      }
    }
  });
}
```

### 2. Field Definition (Always Include Embedded Template)

**CRITICAL:** Every FieldDef file must import FieldDef and MUST be exported:

```gts
import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import LocationIcon from '@cardstack/boxel-icons/map-pin';
import { concat } from '@ember/helper';

export class AddressField extends FieldDef {
  static displayName = 'Address';
  static icon = LocationIcon; // ✅ CORRECT: Boxel icons for static card/field type icons
  
  @field street = contains(StringField);
  @field city = contains(StringField);
  @field postalCode = contains(StringField);
  @field country = contains(StringField);
  
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class="address">
        {{#if @model.street}}
          <div><@fields.street /></div>
        {{else}}
          <div class="placeholder">Street address not provided</div>
        {{/if}}
        <div>
          {{if @model.city @model.city "City"}}{{if @model.postalCode (concat ", " @model.postalCode) ""}}
        </div>
        {{#if @model.country}}
          <div><@fields.country /></div>
        {{else}}
          <div class="placeholder">Country not specified</div>
        {{/if}}
      </div>
      <style scoped>
        .placeholder { font-style: italic; }
      </style>
    </template>
  };
}
```

### 3. Computed Properties with Safety

**CRITICAL:** Avoid cycles and infinite recursion in computed fields.

```gts
// ❌ DANGEROUS: Self-reference causes infinite recursion
@field cardTitle = contains(StringField, {
  computeVia: function(this: BlogPost) {
    return this.cardTitle || 'Untitled'; // STACK OVERFLOW!
  }
});

// ✅ SAFE: Reference only base fields
@field fullName = contains(StringField, {
  computeVia: function(this: Person) {
    try {
      const first = this.firstName ?? '';
      const last = this.lastName ?? '';
      const full = first + ' ' + last;
      return full.trim() || 'Name not provided';
    } catch (e) {
      console.error('Person: Error computing fullName', e);
      return 'Name unavailable';
    }
  }
});
```

### 4. Templates with Proper Computation Patterns

**Remember:** When implementing templates via SEARCH/REPLACE, track all major sections with ⁿ and include the post-block notation `╰ ⁿ⁻ᵐ`

```gts
static isolated = class Isolated extends Component<typeof BlogPost> { // ³⁰ Isolated format
  @tracked showComments = false;
  
  // ³¹ CRITICAL: Do ALL computation in functions, never in templates
  get safeTitle() {
    try {
      return this.args?.model?.title ?? 'Untitled Post';
    } catch (e) {
      console.error('BlogPost: Error accessing title', e);
      return 'Untitled Post';
    }
  }
  
  get commentButtonText() {
    try {
      const count = this.args?.model?.commentCount ?? 0;
      return this.showComments ? `Hide Comments (${count})` : `Show Comments (${count})`;
    } catch (e) {
      console.error('BlogPost: Error computing comment button text', e);
      return this.showComments ? 'Hide Comments' : 'Show Comments';
    }
  }
  
  // methods referenced from templates must be defined with fat arrow (=>) so that they are properly bound when invoked
  toggleComments = () => {
    this.showComments = !this.showComments;
  }
  
  <template>
    <!-- ³² Responsive surface that adapts from wide layouts down to mobile -->
    <article class="blog-post-surface">
      <header>
        <time>{{if @model.publishDate (formatDateTime @model.publishDate 'MMMM D, YYYY') "Date not set"}}</time>
        <h1>{{this.safeTitle}}</h1>
        
        {{#if @fields.author}}
          <@fields.author />
        {{else}}
          <div class="author-placeholder">Author not specified</div>
        {{/if}}
      </header>
      
      <div class="post-content">
        {{#if @model.body}}
          <@fields.body />
        {{else}}
          <div class="content-placeholder">
            <p>No content has been written yet. Click to start writing!</p>
          </div>
        {{/if}}
      </div>
      
      <!-- ³³ Handle arrays with REQUIRED spacing -->
      {{#if (gt @model.tags.length 0)}}
        <section class="tags-section">
          <h4>Tags</h4>
          <div class="tags-container">
            <@fields.tags @format="atom" />
          </div>
        </section>
      {{/if}}
      
      {{#if (gt @model.commentCount 0)}}
      <div>
        <Button 
          @kind="text-only" 
          @size="extra-small" 
          class="comment-button"
          {{on 'click' this.toggleComments}}
        >
          <svg width='16' height='16' class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {{this.commentButtonText}}
        </Button>
       </div>
      {{/if}}
      
      {{#if this.showComments}}
        <section class="comments-section">
          <h3>Discussion</h3>
          {{#if (gt @model.comments.length 0)}}
            <div class="comments-container">
              <@fields.comments @format="embedded" />
            </div>
          {{else}}
            <p class="no-comments">No comments yet. Be the first to share your thoughts!</p>
          {{/if}}
        </section>
      {{/if}}
    </article>
    
    <style scoped> /* ³⁴ Component styles */
      .blog-post-surface {
        width: 100%;
        max-width: 42rem;
        margin: 0 auto;
        padding: clamp(1.25rem, 4vw, 2rem);
        display: flex;
        flex-direction: column;
        gap: clamp(1rem, 2.5vw, 1.5rem);
        height: 100%;
        min-height: 100%;
        overflow-y: auto;
        font-size: 0.875rem;
        line-height: 1.3;
      }
      
      @media (max-width: 800px) {
        .blog-post-surface {
          max-width: none;
          padding: clamp(1rem, 6vw, 1.5rem);
        }
      }
      
      .blog-post-surface > header h1 {
        font-size: clamp(1.125rem, 3vw, 1.5rem);
        margin-top: 0.25rem;
        line-height: 1.2;
      }
      
      .post-content {
        font-size: 0.8125rem;
        line-height: 1.25;
      }
      
      /* ³⁵ CRITICAL: Always style buttons completely - never use unstyled */
      .comment-button {
        /* Style Boxel components to match your design */
        gap: var(--boxel-sp-2xs);
      }
      
      .comment-button .button-icon {
        width: 1rem;
        height: 1rem;
      }
      
      /* ³⁶ CRITICAL: Spacing for containsMany collections */
      .tags-container > .containsMany-field {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem; /* Essential spacing between tags */
      }
      
      .comments-container > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: 0.75rem; /* Essential spacing between comments */
      }
    </style>
  </template>
};
```

### WARNING: Do NOT Use Constructors for Default Values

**CRITICAL:** Constructors should NOT be used for setting default values in Boxel cards. Use template fallbacks (if field is editable) or computeVia (only if field is strictly read-only) instead.

```gts
// ❌ WRONG - Never use constructors for defaults
export class Todo extends CardDef {
  constructor(owner: unknown, args: {}) {
    super(owner, args);
    this.createdDate = new Date(); // DON'T DO THIS
    this.isCompleted = false;      // DON'T DO THIS
  }
}
```

### **CRITICAL: NEVER Create JavaScript Objects in Templates**

**Templates are for simple display logic only.** Never call constructors, create objects, or perform complex operations in template expressions.

```hbs
<!-- ❌ WRONG: Creating objects in templates -->
<span>{{if @model.currentMonth @model.currentMonth (formatDateTime (new Date()) "MMMM YYYY")}}</span>
<div>{{someFunction(@model.data)}}</div>

<!-- ✅ CORRECT: Move logic to JavaScript computed properties -->
<span>{{if @model.currentMonth @model.currentMonth this.currentMonthDisplay}}</span>
<div>{{this.processedData}}</div>
```

```gts
// ✅ CORRECT: Define logic in JavaScript
export class MyCard extends CardDef {
  get currentMonthDisplay() {
    return new Intl.DateTimeFormat('en-US', { 
      month: 'long', 
      year: 'numeric' 
    }).format(new Date());
  }
  
  get processedData() {
    return this.args.model?.data ? this.processData(this.args.model.data) : 'No data';
  }
  
  private processData(data: any) {
    // Complex processing logic here
    return result;
  }
}
```


<div class="skill-divider skill-divider-clickable" id="skill-divider-6" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-template-patterns" role="button" tabindex="0" aria-label="Open Template Patterns">
  <div class="divider-number">7</div>
  <div class="divider-content">
    <div class="divider-topic">Template Patterns</div>
    <div class="divider-context">📖 Contains: Field access, compound fields, @fields delegation, array handling, fallback values, @model vs @fields</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## Template Essentials

**Field access patterns:**
```hbs
{{@model.title}}                    <!-- Raw data -->
<@fields.title />                   <!-- Field's template -->
<@fields.phone @format="atom" />    <!-- Compound field -->
<@fields.items @format="embedded" /> <!-- Auto-collection -->
```

For theming, CSS variables, spacing scales, and CSS safety rules, see Module 3: Theme-First Design System.

### ⚠️ CRITICAL: @model Iteration vs @fields Delegation

**Once you iterate with @model, you CANNOT delegate to @fields within that iteration.**

```hbs
<!-- ❌ BREAKS: Mixing @model iteration with @fields delegation -->
{{#each @model.teamMembers as |member|}}
  <@fields.member @format="embedded" />  <!-- NO ACCESS to @fields.member -->
{{/each}}

<!-- ✅ OPTION 1: Use delegated rendering for the whole collection -->
<@fields.teamMembers @format="embedded" />

<!-- ✅ OPTION 2: Commit to full @model control -->
{{#each @model.teamMembers as |member|}}
  <div class="custom-member">{{member.name}}</div>
{{/each}}

<!-- ✅ OPTION 3: If filtering needed, use query patterns -->
<!-- Use PrerenderedCardSearch or getCards for filtered collections -->
```

**Why this breaks:** @fields provides field-level components. Once you're iterating with @model, you're working with raw data, not field components.

**Decision Rule:** Before iterating, decide:
- Need composability? → Use delegated rendering
- Need filtering? → Use query patterns (PrerenderedCardSearch/getCards)
- Need custom control? → Use @model but handle ALL rendering yourself

## Accessing @fields by Index: The Bridge Pattern

**Use Case:** You need to use `@model` data to find specific items in a `containsMany` or `linksToMany` collection, then render those items using their field templates for proper delegated rendering.

**Key Concept:** The `get` helper allows you to access `@fields` array elements by index, creating a bridge between data-driven iteration and component-based rendering.

### When to Use This Pattern

- **Filtering:** Show only items matching certain criteria
- **Conditional rendering:** Display items based on model data
- **Custom ordering:** Reorder items based on computed logic
- **Highlighted selection:** Emphasize specific items in a collection

### Basic Pattern

```hbs
{{! Access a specific field by index }}
{{#let (get @fields.shoppingList 0) as |firstItem|}}
  {{#if firstItem}}
    <firstItem @format="embedded" />
  {{else}}
    <div class="no-item">No first item</div>
  {{/if}}
{{/let}}

{{! Access last item using subtract helper }}
{{#let (get @fields.items (subtract @model.items.length 1)) as |lastItem|}}
  {{#if lastItem}}
    <lastItem @format="fitted" />
  {{/if}}
{{/let}}
```

### Displaying Compound Fields

**CRITICAL:** When displaying compound fields (FieldDef types) like `PhoneNumberField`, `AddressField`, or custom field definitions, you must use their format templates, not raw model access:

```hbs
<!-- ❌ WRONG: Shows [object Object] -->
<p>Phone: {{@model.phone}}</p>

<!-- ✅ CORRECT: Uses the field's atom format -->
<p>Phone: <@fields.phone @format="atom" /></p>

<!-- ✅ CORRECT: For full field display -->
<div class="contact-info">
  <@fields.phone @format="embedded" />
</div>
```

**💡 Line-saving tip:** Keep self-closing tags compact:
```hbs
<!-- Good: Saves vertical space -->
<@fields.author @format="embedded" />
<@fields.phone @format="atom" />
```

### @fields Delegation Rule

**CRITICAL:** When delegating to embedded/fitted formats, you must iterate through `@fields`, not `@model`. Always use `@fields` for delegation, even for singular fields.

```hbs
<!-- ✅ CORRECT: Using @fields for both singular and collection fields -->
<@fields.author @format="embedded" />
<@fields.items @format="embedded" />
{{#each @fields.items as |item|}}
  <item @format="embedded" />
{{/each}}

<!-- ❌ WRONG: Can't iterate @model then try to delegate to @fields -->
{{#each @model.items as |item|}}
  <@fields.??? @format="embedded" /> <!-- This won't work -->
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

## Template Fallback Value Patterns

**CRITICAL:** Boxel cards boot with no data by default. Templates must gracefully handle null, undefined, and empty string values at ALL levels of data access to prevent runtime errors and provide meaningful visual fallbacks.

### Three Primary Patterns for Fallbacks

**1. Inline if/else (for simple display fallbacks):**
```hbs
<span>{{if @model.eventTime (formatDateTime @model.eventTime "MMM D, h:mm A") "Event time to be announced"}}</span>
<h2>{{if @model.title @model.title "Untitled Document"}}</h2>
<p>Status: {{if @model.status @model.status "Status pending"}}</p>
```

**2. Block-based if/else (for complex content):**
```hbs
<div class="event-time">
  {{#if @model.eventTime}}
    <strong>{{formatDateTime @model.eventTime "MMM D, h:mm A"}}</strong>
  {{else}}
    <em class="placeholder">Event time to be announced</em>
  {{/if}}
</div>

{{#if @model.description}}
  <div class="description">
    <@fields.description />
  </div>
{{else}}
  <div class="empty-description">
    <p>No description provided yet. Click to add one.</p>
  </div>
{{/if}}
```

**3. Unless for safety/validation checks (composed with other helpers):**
```hbs
{{unless (and @model.isValid @model.hasPermission) "⚠️ Cannot proceed - missing validation or permission"}}
{{unless (or @model.email @model.phone) "Contact information required"}}
{{unless (gt @model.items.length 0) "No items available"}}
{{unless (eq @model.status "active") "Service unavailable"}}
```

**Best Practices:** Use descriptive placeholder text rather than generic "N/A", style placeholder text differently (lighter color, italic), use `unless` for safety checks and `if` for display fallbacks.

**Icon Usage:** Avoid emoji in templates (unless the application specifically calls for it) due to OS/platform variations that cause legibility issues. Use Boxel icons only for static card/field type icons (`static icon` property). In templates, use inline SVG instead since we can't be sure which Boxel icons exist.

## Template Array Handling Patterns

**CRITICAL:** Templates must gracefully handle all array states to prevent errors. Arrays can be undefined, null, empty, or populated.

### The Three Array States

Your templates must handle:
1. **Completely undefined arrays** - Field doesn't exist or is null
2. **Empty arrays** - Field exists but has no items (`[]`)
3. **Arrays with actual data** - Field has one or more items

### Array Logic Pattern

**❌ WRONG - Only checks for existence:**
```hbs
{{#if @model.goals}}
  <ul class="goals-list">
    {{#each @model.goals as |goal|}}
      <li>{{goal}}</li>
    {{/each}}
  </ul>
{{/if}}
```

**✅ CORRECT - Checks for length and provides empty state:**
```hbs
{{#if @model.goals.length}}
  <div class="goals-section">
    <h4>
      <svg width='16' height='16' class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
      Daily Goals
    </h4>
    <ul class="goals-list">
      {{#each @model.goals as |goal|}}
        <li>{{goal}}</li>
      {{/each}}
    </ul>
  </div>
{{else}}
  <div class="goals-section">
    <h4>
      <svg width='16' height='16' class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
      Daily Goals
    </h4>
    <p class="empty-state">No goals set yet. What would you like to accomplish?</p>
  </div>
{{/if}}
```

**Remember:** When implementing templates via SEARCH/REPLACE, include tracking markers ⁿ for style blocks

## Real-World Example: Shopping List with Featured Items

```gts
import { CardDef, FieldDef, field, contains, containsMany, Component } from 'https://cardstack.com/base/card-api';
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
      <div class="fruit-item">
        <span>{{if @model.title @model.title "Unknown"}}</span>
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
        <h1>{{@model.title}}</h1>
        
        {{! Show first and last items using get helper }}
        <section class="featured">
          <h2>First Item</h2>
          {{#let (get @fields.items 0) as |item|}}
            {{#if item}}
              <item @format="embedded" />
            {{else}}
              <p>No items</p>
            {{/if}}
          {{/let}}
          
          <h2>Last Item</h2>
          {{#let (get @fields.items (subtract @model.items.length 1)) as |item|}}
            {{#if item}}
              <item @format="embedded" />
            {{/if}}
          {{/let}}
        </section>
        
        {{! Full list }}
        <section>
          <h2>All Items</h2>
          {{#if @model.items.length}}
            <@fields.items @format="embedded" class="items-container" />
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

### Important Notes

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


<div class="skill-divider skill-divider-clickable" id="skill-divider-7" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-styling-design" role="button" tabindex="0" aria-label="Open Styling & Design">
  <div class="divider-number">8</div>
  <div class="divider-content">
    <div class="divider-topic">Styling & Design</div>
    <div class="divider-context">📖 Contains: CSS safety, formatters, design tokens, typography, format dimensions comparison</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## CSS Safety Essentials

**Always scoped:**
```gts
<template>
  <div class="my-card">...</div>
  <style scoped>  /* MANDATORY */
    .my-card { }
  </style>
</template>
```

**CSS comments (NEVER use //):**
```css
/* ✅ CORRECT: Block comments */
.card { color: blue; }

// ❌ WRONG: Single-line breaks parsing
```

**Never use global selectors:**
```css
/* ❌ WRONG */
:root { --color: blue; }
body { margin: 0; }

/* ✅ CORRECT */
.my-component {
  --color: blue;
}
```

**Formatters for display:**
```hbs
{{formatCurrency @model.price currency="USD"}}
{{formatDateTime @model.date size="medium"}}
{{formatNumber @model.count size="tiny"}}
```

## Design Philosophy and Competitive Styling

Design and implement your stylesheet to fit the domain you are generating. Research the top 2 products/services in that area and design your card as if you are the 3rd competitor looking to one-up the market in terms of look and feel, functionality, and user-friendliness.

Approach: Study the leading players' design patterns, then create something that feels more modern, intuitive, and polished. Focus on micro-interactions, thoughtful spacing, superior visual hierarchy, and removing friction from user workflows.

Key Areas to Compete On:
- Visual polish: better typography, spacing, and color schemes
- Interaction design: smoother animations, better feedback, clearer affordances
- Information architecture: more logical organization, better progressive disclosure
- Accessibility: superior contrast, keyboard navigation, screen reader support
- Performance: faster loading, responsive design

Typography Guidance (detailed): Choose modern, readable fonts that match your domain. For body text, consider Inter, Roboto, Open Sans, Source Sans Pro, DM Sans, Work Sans, Manrope, or Plus Jakarta Sans. For headings, Poppins, Montserrat, Space Grotesk, Raleway, Archivo Black, Oswald, Anton, Playfair Display, Lora, or Merriweather. Balance readability with character; ensure sufficient contrast and legible sizes across formats.

## Design Token Foundation

Dense professional layouts with thoughtful scaling:

- Typography scale: start at 0.875rem base; headings 1rem–1.375rem; labels 0.75rem
- Spacing scale: 0.25rem increments; inline 0.25–0.5rem; sections 0.75–1rem; major 1.5–2rem
- Colors: define background, foreground, muted, muted-foreground, primary, primary-foreground, secondary, secondary-foreground, accent, accent-foreground, card, card-foreground, sidebar, sidebar-foreground, and border tokens
- Radius: match the aesthetic (sharp for technical, soft for friendly)
- Shadows: subtle elevation for interactive elements; keep z-index conservative (<10)

Implementation tip: Define CSS variables at component root and use fallbacks.

```css
.component {
  --card-padding: var(--boxel-sp, 1rem);
  --card-radius: var(--boxel-border-radius-sm, 0.5rem);
  --card-shadow: var(--boxel-box-shadow, 0 2px 4px rgba(0,0,0,0.1));
  padding: var(--card-padding);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
```

## Typography Guidance (Detailed)

- Base size: 14px (0.875rem) for dense UIs; increase in larger formats
- Hierarchy cascade: each level 80–87% of the previous; adjust weight 100–200 units per level
- Line-height: 1.2–1.5 depending on density; tighter for tiles, looser for isolated
- Clamping: use `clamp()` for responsive sizes across fitted/embedded/isolated
- Accessibility: aim for WCAG AA contrast; avoid ultra-light weights below 16px
- Numbers: tabular-nums for data tables and metrics when available

Example:
```css
.title { font-size: clamp(1rem, 2.5vw, 1.25rem); font-weight: 700; }
.subtle { font-size: 0.75rem; opacity: 0.8; }
```

## Format Dimensions Comparison

| Format   | Width            | Height           | Parent Sets | Key Behavior |
|----------|------------------|------------------|-------------|-------------|
| Isolated | Max-width, center| Natural + scroll | No          | Full detail, scrollable content |
| Embedded | Fills container  | Natural          | Width only  | Truncation/expand controls handled by parent |
| Fitted   | Fills exactly    | Fills exactly    | Both        | Must adapt to fixed grid slots |
| Atom     | Inline           | Inline           | No          | Minimal inline representation |
| Edit     | Fills container  | Natural form     | Width only  | Form layout, grows with fields |

Notes:
- Fitted requires internal subformats (badge, strip, tile, card) via container queries
- Embedded should be height-flexible; parents may clamp and offer "view more"
- Isolated should ensure comfortable reading with scrollable mat and generous padding


<div class="skill-divider skill-divider-clickable" id="skill-divider-8" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-defensive-programming" role="button" tabindex="0" aria-label="Open Defensive Programming">
  <div class="divider-number">9</div>
  <div class="divider-content">
    <div class="divider-topic">Defensive Programming</div>
    <div class="divider-context">📖 Contains: Optional chaining, default values, try-catch for cross-card access, array validation</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

**Always use optional chaining:**
```js
// ❌ UNSAFE
if (this.args.model.items.includes(x)) { }

// ✅ SAFE
if (this.args.model?.items?.includes?.(x)) { }
```

**Provide defaults:**
```js
return (this.args.model?.progress ?? 0) + 10;
```

**Wrap cross-card access in try-catch:**
```js
get authorName() {
  try {
    const author = this.args?.model?.author;
    return author?.name ?? 'Unknown Author';
  } catch (e) {
    console.error('Error accessing author', e);
    return 'Author Unavailable';
  }
}
```

## Defensive Programming in Boxel Components

**CRITICAL:** Prevent runtime errors by safely handling undefined/null values and malformed data. Cards boot with no data by default - every component must handle completely empty state gracefully.

### Essential Defensive Patterns

#### Always Use Optional Chaining (`?.`)
```js
// ❌ UNSAFE: Will throw if model is undefined
if (this.args.model.completedDays.includes(day)) { ... }

// ✅ SAFE: Optional chaining prevents errors
if (this.args.model?.completedDays?.includes?.(day)) { ... }
```

#### Provide Default Values (`??`)
```js
// ❌ UNSAFE: May result in NaN
return this.args.model.progress + 10;

// ✅ SAFE: Default value prevents NaN
return (this.args.model?.progress ?? 0) + 10;
```

#### Try-Catch for Network of Cards
When accessing data across card relationships, always wrap in try-catch to handle missing or malformed data:

```js
// ³⁷ In computed properties or methods
get authorDisplayName() {
  try {
    const author = this.args?.model?.author;
    if (!author) {
      console.warn('BlogPost: No author assigned');
      return 'Unknown Author';
    }
    
    const name = author.name || author.title;
    if (!name) {
      console.warn('BlogPost: Author exists but has no name', { authorId: author.id });
      return 'Unnamed Author';
    }
    
    return name;
  } catch (error) {
    console.error('BlogPost: Error accessing author data', {
      error,
      postId: this.args.model?.id,
      authorData: this.args.model?.author
    });
    return 'Author Unavailable';
  }
}

// ³⁸ In template getters
get relatedPostsSummary() {
  try {
    const posts = this.args.model?.relatedPosts;
    if (!Array.isArray(posts)) {
      return 'No related posts';
    }
    
    return posts
      .filter(post => post?.title) // Skip malformed entries
      .map(post => post.title)
      .join(', ') || 'No related posts';
      
  } catch (error) {
    console.error('BlogPost: Failed to process related posts', error);
    return 'Related posts unavailable';
  }
}
```

#### Validate Arrays Before Operations
```js
// ❌ UNSAFE: May throw if not an array
const sorted = this.completedDays.sort((a, b) => a - b);

// ✅ SAFE: Check existence and type first
if (!Array.isArray(this.completedDays) || !this.completedDays.length) {
  return [];
}
const sorted = [...this.completedDays].sort((a, b) => a - b);
```

**Key Principles:** 
- Assume data might be missing, null, or the wrong type
- Provide meaningful fallbacks for user display
- Log errors with context for debugging (include IDs, data state)
- Never let malformed data crash your UI


<div class="skill-divider skill-divider-clickable" id="skill-divider-9" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-query-systems" role="button" tabindex="0" aria-label="Open Query Systems">
  <div class="divider-number">10</div>
  <div class="divider-content">
    <div class="divider-topic">Query Systems</div>
    <div class="divider-context">📖 Contains: Query essentials, 'on' rule, path rules, filter types, basic query patterns</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## Query Essentials

**The 'on' Rule (MEMORIZE THIS!):**
```ts
// ❌ WRONG - Missing 'on'
{ range: { price: { lte: 100 } } }

// ✅ CORRECT - Include 'on' for filters
{
  on: { module: new URL('./product', import.meta.url).href, name: 'Product' },
  range: { price: { lte: 100 } }
}
```

**⚠️ CRITICAL Path Rule:**
- **In .gts files (queries):** Use `./` - you're in the same directory as the module
- **In JSON files (`adoptsFrom`):** Use `../` - instances live in folders, need to navigate up
- `./` means "same directory" when used with `import.meta.url`

**Filter types needing 'on':**
- `eq`, `contains`, `range` (except after type filter)
- Sort on type-specific fields

**Filter composition types:**
- `any`: allows an "OR" union of other filters
- `every`: allows an "AND" union of other filters
- `not`: allow negating another filter

**Basic query pattern:**
```ts
const query = {
  filter: {
    every: [
      { type: { module: new URL('./product', import.meta.url).href, name: 'Product' } },
      { on: { module: new URL('./product', import.meta.url).href, name: 'Product' }, eq: { status: 'active' } }
    ]
  }
};
```

**Defining query-backed fields:**
```ts
@field shirts = linksToMany(Shirt, {
  query: {
    filter: {
      // implicit clause merged during execution: on: { module: Shirt.module, name: 'Shirt' }
      eq: { size: '$this.profile.shirtSize' },
    },
    realm: '$thisRealm',
    sort: [
      {
        by: 'updatedAt',
        direction: 'desc',
      },
    ],
    page: { size: 12 },
  },
});

@field profile = linksTo(Profile, {
  query: {
    filter: {
      eq: { primary: true },
    },
    // `linksTo` takes the first matching card (post-sort) or null when no results.
  },
});
```

**When to use what to query cards:**
- Efficient display-only → `PrerenderedCardSearch`
- Need data manipulation → `getCards`
- Treat query result as a field → query-backed fields
```


<div class="skill-divider skill-divider-clickable" id="skill-divider-10" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-delegated-rendering" role="button" tabindex="0" aria-label="Open Delegated Rendering">
  <div class="divider-number">11</div>
  <div class="divider-content">
    <div class="divider-topic">Delegated Rendering</div>
    <div class="divider-context">📖 Contains: Delegated rendering, clickable cards, avoiding cycles, BoxelSelect, custom edit controls, viewCard API</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

**Delegated rendering:**
```hbs
<!-- Always use @fields, even for singular -->
<@fields.author @format="embedded" />
<@fields.items @format="embedded" />
```

**Make cards clickable:**
```hbs
<CardContainer
  {{@context.cardComponentModifier
    cardId=card.url
    format='data'
  }}
  @displayBoundaries={{true}}
>
  <card.component />
</CardContainer>
```

**Avoid cycles:**
```gts
// Canonical links only
@field supervisor = linksTo(() => Employee);

// Query for reverse
get directReportsQuery() {
  return {
    filter: {
      on: { module: './employee', name: 'Employee' },
      eq: { supervisor: this.args.model.id }
    }
  };
}
```

## BoxelSelect: Smart Dropdown Menus

Regular HTML selects are limited to plain text. BoxelSelect lets you create rich, searchable dropdowns with custom rendering.

### Pattern: Rich Select with Custom Options

```gts
export class OptionField extends FieldDef { // ⁴³ Option field for select
  static displayName = 'Option';
  
  @field key = contains(StringField);
  @field label = contains(StringField);
  @field description = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class="option-display">
        <strong>{{if @model.label @model.label "Unnamed Option"}}</strong>
        <span>{{if @model.description @model.description "No description"}}</span>
      </div>
    </template>
  };
}

export class ProductCategory extends CardDef { // ⁴⁴ Card using BoxelSelect
  @field selectedCategory = contains(OptionField);
  
  static edit = class Edit extends Component<typeof this> { // ⁴⁵ Edit format
    @tracked selectedOption = this.args.model?.selectedCategory;

    options = [
      { key: '1', label: 'Electronics', description: 'Phones, computers, and gadgets' },
      { key: '2', label: 'Clothing', description: 'Fashion and apparel' },
      { key: '3', label: 'Home & Garden', description: 'Furniture and decor' }
    ];

    updateSelection = (option: typeof this.options[0] | null) => {
      this.selectedOption = option;
      this.args.model.selectedCategory = option ? new OptionField(option) : null;
    }

    <template>
      <FieldContainer @label="Product Category">
        <BoxelSelect
          @selected={{this.selectedOption}}
          @options={{this.options}}
          @onChange={{this.updateSelection}}
          @searchEnabled={{true}}
          @placeholder="Select a category..."
          as |option|
        >
          <div class="option-item">
            <span>{{option.label}}</span>
            <span>{{option.description}}</span>
          </div>
        </BoxelSelect>
      </FieldContainer>
    </template>
  };
}
```

## Custom Edit Controls

Create user-friendly edit controls that accept natural input. Hide complexity in expandable sections while keeping ALL properties editable and inspectable.

```gts
// Example: Natural language time period input
static edit = class Edit extends Component<typeof this> {
  @tracked showDetails = false;
  
  parseInput = (value: string) => {
    // Parse "Q1 2025" → quarter: 1, year: 2025, startDate: Jan 1, endDate: Mar 31
    // Parse "April 2025" → month: 4, year: 2025, startDate: Apr 1, endDate: Apr 30
  }
  
  <template>
    <FieldContainer @label="Time Period" @tag="label">
      <input placeholder="e.g., Q1 2025 or April 2025" {{on 'blur' this.parseInput}} />
    </FieldContainer>
    
    <Button {{on 'click' (toggle 'showDetails' this)}}>
      {{if this.showDetails "Hide" "Show"}} Details
    </Button>
    
    {{#if this.showDetails}}
      <!-- Show all parsed values for verification -->
      <!-- Allow manual override of auto-parsed results -->
      <!-- Provide controls for each field property -->
    {{/if}}
  </template>
};
```

## Alternative: Using the viewCard API

Instead of making entire cards clickable, you can create custom buttons or links that use the `viewCard` API to open cards in specific formats.

### Basic Implementation

```javascript
viewOrder = (order: ProductOrder) => {
  // Open order in isolated view
  this.args.viewCard(order, 'isolated');
};

editOrder = (order: ProductOrder) => {
  // Open card in rightmost stack for side-by-side reference
  // Useful for: 1) reference lookup, 2) edit panel on right while previewing on left
  this.args.viewCard(order, 'edit', {
    openCardInRightMostStack: true
  });
};

viewReturnPolicy = () => {
  // Open card using URL
  const returnPolicyURL = new URL('https://app.boxel.ai/markinc/storefront/ReturnPolicy/return-policy-0525.json');
  this.args.viewCard(returnPolicyURL, 'isolated');
};
```

### Template Example

```hbs
<div class="order-card">
  <!-- Custom action buttons -->
  <div class="order-actions">
    <Button @kind="primary" {{on "click" (fn this.viewOrder order)}}>
      View Order
    </Button>
    
    <Button @kind="secondary-light" {{on "click" (fn this.editOrder order)}}>
      Edit Order
    </Button>
  </div>
  
  <Button @kind="text-only" {{on "click" (fn this.viewReturnPolicy)}}>
    Return Policy
  </Button>
</div>
```

### Available Formats

- `'isolated'` - Read-oriented mode, may have some editable forms or interactive widgets
- `'edit'` - Open card for full editing

### Use Cases
- Multiple direct call-to-actions per card (view, edit)
- More control over user interactions
- Link to any card via a card URL


<div class="skill-divider skill-divider-clickable" id="skill-divider-11" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-fitted-formats" role="button" tabindex="0" aria-label="Open Fitted Formats">
  <div class="divider-number">12</div>
  <div class="divider-content">
    <div class="divider-topic">Fitted Formats</div>
    <div class="divider-context">📖 Contains: Four sub-formats (badge, strip, tile, card), container query skeleton, content priority</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## Fitted Format Essentials

**Four sub-formats strategy:**
- **Badge** (≤150px width, <170px height) - Exportable graphics
- **Strip** (>150px width, <170px height) - Dropdown/chooser panels
- **Tile** (<400px width, ≥170px height) - Grid viewing
- **Card** (≥400px width, ≥170px height) - Full layout

**Container query skeleton:**
```css
.fitted-container {
  container-type: size;
  width: 100%;
  height: 100%;
}

/* Hide all by default */
.badge, .strip, .tile, .card {
  display: none;
  padding: clamp(0.25rem, 2%, 0.5rem);
}

/* Activate by size - NO GAPS! */
@container (max-width: 150px) and (max-height: 169px) {
  .badge { display: flex; }
}
```

**Content priority:**
1. Title/Name
2. Image
3. Short ID
4. Key info
5. Status badges


<div class="skill-divider skill-divider-clickable" id="skill-divider-12" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-external-libraries" role="button" tabindex="0" aria-label="Open External Libraries">
  <div class="divider-number">13</div>
  <div class="divider-content">
    <div class="divider-topic">External Libraries</div>
    <div class="divider-context">📖 Contains: Async loading, ember-concurrency tasks, modifiers for DOM access, external library integration</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

**Async loading pattern:**
```gts
import { task, restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

private loadLibrary = task(async () => {
  const script = document.createElement('script');
  script.src = 'https://cdn.../library.js';
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
});
```

**Key Rules:**
1. Use Modifiers for DOM access
2. Use ember-concurrency tasks for async
3. Bind external data to model fields
4. Provide loading states

**Task types:**
- `task` - Concurrent execution
- `restartableTask` - Cancel previous, start new
- `enqueueTask` - Sequential queue
- `dropTask` - Ignore new while running

## Async loading from within components

For fetching data from external APIs, use `ember-concurrency`. The core of this principle are "tasks", which are a cancelable alternative to promises. The most used ones are `task`, and `restartableTask`:

- task: Tasks run concurrently without any coordination, allowing multiple instances to execute simultaneously.
- restartableTask: Cancels any running task and immediately starts a new one when performed, ensuring only the latest task runs.
- enqueueTask: Queues tasks to run sequentially one after another, ensuring no overlap but preserving all tasks.
- dropTask: Ignores new task requests while one is already running, preventing any additional instances from starting.
- keepLatest: Drops intermediate queued tasks but keeps the most recent one to run after the current task completes.

Here is an example where we are:
- loading data when component is first rendered, 
- reloading it when user clicks on a button,
- adding some artificial delay using `await timeout(ms)` from `ember-concurrency`. Caution:  do not use `setTimeout`.

```
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import perform from 'ember-concurrency/helpers/perform';

export class CurrencyLoader extends CardDef {
  static displayName = 'Currency Loader';
  
  @field loadingStatus = contains(StringField);
  @field currencies = contains(StringField);
  
  static isolated = class Isolated extends Component<typeof this> {
    constructor(owner: any, args: any) {
      super(owner, args);
      this.loadCurrencies.perform();
    }
    
    private loadCurrencies = restartableTask(async () => {
      this.args.model.loadingStatus = 'Loading...';
      const response = await fetch('/api/currencies');
      await timeout(1000); // Visual feedback
      
      this.args.model.currencies = await response.json();
      this.args.model.loadingStatus = "";
    });
    
    <template>
      <div>
        <p>Status: {{@model.loadingStatus}}</p>
        <p>Data: {{@model.currencies}}</p>
        
        <Button {{on 'click' (perform this.loadCurrencies)}}>
          Reload Currencies
        </Button>
      </div>
    </template>
  };
}
```

## External Libraries: Bringing Third-Party Power to Boxel

**When to Use External Libraries:** Sometimes you need specialized functionality like 3D graphics (Three.js), data visualization (D3), or charts. Boxel plays well with external libraries when you follow the right patterns.

**Key Rules:**
1. **Always use Modifiers for DOM access** - Never manipulate DOM directly
2. **Use ember-concurrency tasks** for async operations like loading libraries
3. **Bind external data to model fields** for reactive updates
4. **Use proper loading states** while libraries initialize


<div class="skill-divider skill-divider-clickable" id="skill-divider-13" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-data-management" role="button" tabindex="0" aria-label="Open Data Management">
  <div class="divider-number">14</div>
  <div class="divider-content">
    <div class="divider-topic">Data Management</div>
    <div class="divider-context">📖 Contains: File organization, JSON instance format, field value patterns, relationship patterns, path conventions</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## File Organization

### Single App Structure
```
my-realm/
├── blog-post.gts          # Card definition (kebab-case)
├── author.gts             # Another card
├── address-field.gts      # Field definition (kebab-case-field)
├── BlogPost/              # Instance directory (PascalCase)
│   ├── hello-world.json   # Instance (any-name)
│   └── second-post.json   
└── Author/
    └── jane-doe.json
```

### Related Cards App Structure
**CRITICAL:** When creating apps with multiple related cards, organize them in common folders:

```
my-realm/
├── ecommerce/             # Common folder for related cards
│   ├── product.gts        # Card definitions
│   ├── order.gts
│   ├── customer.gts
│   ├── Product/           # Instance directories
│   │   └── laptop-pro.json
│   └── Order/
│       └── order-001.json
├── blog/                  # Another app's folder
│   ├── post.gts
│   ├── author.gts
│   └── Post/
│       └── welcome.json
└── shared/                # Shared components
    └── address-field.gts  # Common field definitions
```

**Directory Discipline:** When creating files within a specific directory structure (e.g., `ecommerce/`), keep ALL related files within that structure. Don't create files outside the intended directory organization.

**Relationship Path Tracking:** When creating related JSON instances, maintain a mental map of your file paths. Links between instances must use the exact relative paths you've created - consistency prevents broken relationships.

## JSON Instance Format Quick Reference

**When creating `.json` card instances via SEARCH/REPLACE, follow this structure:**

**Naming:** Use natural names for JSON files (e.g., `Author/jane-doe.json`, `Product/laptop-pro.json`) - don't append `-sample-data`

**Path Consistency:** When creating multiple related JSON instances, track the exact file paths you create. Relationship links must match these paths exactly - if you create `Author/dr-nakamura.json`, reference it as `"../Author/dr-nakamura"` from other instances.

### Root Structure
All data wrapped in a `data` object with:
* `type`: Always `"card"` for instances
* `attributes`: Field values go here
* `relationships`: Links to other cards
* `meta.adoptsFrom`: Connection to GTS definition

### Instance Template
```json
{
  "data": {
    "type": "card",
    "attributes": {
      // Field values here
    },
    "relationships": {
      // Card links here
    },
    "meta": {
      "adoptsFrom": {
        "module": "../path-to-gts-file",
        "name": "CardDefClassName"
      }
    }
  }
}
```

### Field Value Patterns

**Simple fields** (`contains(StringField)`, etc.):
```json
"attributes": {
  "title": "My Title",
  "price": 29.99,
  "isActive": true
}
```

**Compound fields** (`contains(AddressField)` - a FieldDef):
```json
"attributes": {
  "address": {
    "street": "4827 Riverside Terrace",
    "city": "Portland",
    "postalCode": "97205"
  }
}
```

**Array fields** (`containsMany`):
```json
"attributes": {
  "tags": ["urgent", "review", "frontend"],
  "phoneNumbers": [
    { "number": "+1-503-555-0134", "type": "work" },
    { "number": "+1-971-555-0198", "type": "mobile" }
  ]
}
```

### Relationship Patterns

**Single link** (`linksTo`):
```json
"relationships": {
  "author": {
    "links": {
      "self": "../Author/dr-nakamura"
    }
  }
}
```

**Multiple links** (`linksToMany`) - note the `.0`, `.1` pattern:
```json
"relationships": {
  "teamMembers.0": {
    "links": { "self": "../Person/kai-nakamura" }
  },
  "teamMembers.1": {
    "links": { "self": "../Person/esperanza-cruz" }
  }
}
```

**Empty linksToMany** - when no relationships exist:
```json
"relationships": {
  "nextLevels": {
    "links": {
      "self": null
    }
  }
}
```
Note: Use `null`, not an empty array `[]`

### Path Conventions
* **Module paths**: Relative to JSON location, no `.gts` extension
  * Local: `"../author"` or `"../../shared/address-field"`
  * Base: `"https://cardstack.com/base/string"`
* **Relationship paths**: Relative paths, no `.json` extension
  * `"../Author/jane-doe"` not `"../Author/jane-doe.json"`
* **Date formats**: 
  * DateField: `"2024-11-15"`
  * DatetimeField: `"2024-11-15T10:00:00Z"`


<div class="skill-divider skill-divider-clickable" id="skill-divider-14" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-command-development" role="button" tabindex="0" aria-label="Open Command Development">
  <div class="divider-number">15</div>
  <div class="divider-content">
    <div class="divider-topic">Command Development</div>
    <div class="divider-context">📖 Contains: Command structure, host commands, OpenRouter API, catalog delegation, query patterns, progress tracking</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

## Command Development Essentials

Commands extend `Command<InputCardDef, OutputCardDef | undefined>` and execute workflows through host APIs.

### Core Structure

```gts
import { Command } from '@cardstack/runtime-common';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

class MyInput extends CardDef {
  @field targetRealm = contains(StringField);
}

export class MyCommand extends Command<typeof MyInput, undefined> {
  static actionVerb = 'Process';
  async getInputType() { return MyInput; }
  
  protected async run(input: MyInput): Promise<undefined> {
    // Validation first
    if (!input.targetRealm) throw new Error('Target realm required');
    
    // Execute workflow
    // Return result or undefined
  }
}
```

### Host Commands (IO Operations)

**Never use `fetch` directly - always use host commands:**

```gts
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import SearchCardsByQueryCommand from '@cardstack/boxel-host/commands/search-cards-by-query';

// Save a card
await new SaveCardCommand(this.commandContext).execute({
  card: myCard,
  realm: 'https://realm-url/'
});

// Get a card
const card = await new GetCardCommand(this.commandContext).execute({
  cardId: 'https://realm/Card/id'
});

// External API call
const response = await new SendRequestViaProxyCommand(this.commandContext).execute({
  url: 'https://api.example.com/endpoint',
  method: 'POST',
  requestBody: JSON.stringify(data),
  headers: { 'Content-Type': 'application/json' }
});
```

### OpenRouter API Pattern

```gts
const headers = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://realms-staging.stack.cards',
  'X-Title': 'Your App Name'
};

const response = await new SendRequestViaProxyCommand(ctx).execute({
  url: 'https://openrouter.ai/api/v1/chat/completions',
  method: 'POST',
  requestBody: JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [{ role: 'user', content: 'Your prompt' }]
  }),
  headers
});

if (!response.response.ok) throw new Error('API call failed');
const data = await response.response.json();
const text = data.choices?.[0]?.message?.content ?? '';
```

### Catalog Command Delegation

**Reuse existing commands instead of reimplementing:**

```gts
import UploadImageCommand from 'https://realms-staging.stack.cards/catalog/commands/upload-image';

const result = await new UploadImageCommand(this.commandContext).execute({
  sourceImageUrl: dataUrl,
  targetRealmUrl: input.realm
});
```

### Query Pattern in Commands

```gts
import SearchCardsByQueryCommand from '@cardstack/boxel-host/commands/search-cards-by-query';

const results = await new SearchCardsByQueryCommand(this.commandContext).execute({
  query: {
    filter: {
      on: { module: new URL('./product', import.meta.url).href, name: 'Product' },
      eq: { status: 'active' }
    }
  },
  realmURLs: [input.realm]
});
```

### Progress Tracking

```gts
import { tracked } from '@glimmer/tracking';

export class MyCommand extends Command<typeof Input, undefined> {
  @tracked step: 'idle' | 'processing' | 'completed' | 'error' = 'idle';
  
  protected async run(input: Input): Promise<undefined> {
    this.step = 'processing';
    try {
      // Do work
      this.step = 'completed';
    } catch (e) {
      this.step = 'error';
      throw e;
    }
  }
}
```

### Menu Integration

```gts
import { getCardMenuItems } from '@cardstack/runtime-common';

[getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
  return [{
    label: 'My Action',
    icon: MyIcon,
    action: async () => {
      await new MyCommand(params.commandContext).execute({
        cardId: this.id,
        realm: params.realmURL
      });
      await params.saveCard(this);
    }
  }, ...super[getCardMenuItems](params)];
}
```

### Critical Rules

- ✅ **Validate inputs first** - fail early with clear errors
- ✅ **Use host commands for all IO** - never `fetch` directly
- ✅ **Include `on` in queries** - for eq/contains/range filters
- ✅ **Delegate to catalog commands** - don't reimplement uploads/services
- ✅ **Wrap JSON parsing in try-catch** - handle malformed responses
- ✅ **Track progress states** - use `@tracked` for UI feedback


<div class="skill-divider skill-divider-clickable" id="skill-divider-15" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-enumerations" role="button" tabindex="0" aria-label="Open Enumerations Skill">
  <div class="divider-number">16</div>
  <div class="divider-content">
    <div class="divider-topic">Enumerations Skill</div>
    <div class="divider-context">📖 Contains: Essentials, purpose, import syntax, quick start, rich options, dynamic options, helpers, limitations, usage examples</div>
    <div class="divider-mode divider-mode-full">Full</div>
  </div>
</div>

### Enum Field Essentials

**CRITICAL Import Syntax:**
```gts
import enumField from 'https://cardstack.com/base/enum'; // Default import, not { enumField }
```

**Quick Start:**
```gts
const StatusField = enumField(StringField, { options: ['Open', 'Closed'] });
@field status = contains(StatusField);
```

**Template:** `<@fields.status />` renders a BoxelSelect in edit mode.

**Rich options with labels/icons:**
```gts
enumField(StringField, { 
  options: [
    { value: 'high', label: 'High Priority', icon: ArrowUpIcon },
    { value: 'low', label: 'Low Priority', icon: ArrowDownIcon }
  ]
})
```

**Key helpers:**
- `enumValues(card, 'fieldName')` → array of primitive values
- `enumOptions(card, 'fieldName')` → normalized `{ value, label, icon? }`

<!--more-->

## Enum Fields

### Purpose

Use `enumField(BaseField, { options })` to create a `FieldDef` with constrained values and a default dropdown editor. Works with primitive bases (e.g., `StringField`, `NumberField`).

### Import Syntax

**CRITICAL:** Use default import, not destructured import:

```gts
// ✅ CORRECT
import enumField from 'https://cardstack.com/base/enum';

// ❌ WRONG
import { enumField } from 'https://cardstack.com/base/enum';
```

### Quick Start

**Define:**
```gts
const StatusField = enumField(StringField, { options: ['Open', 'Closed'] });
```

**Use:**
```gts
@field status = contains(StatusField);
```

**Template:**
```hbs
<@fields.status /> {{! Renders a BoxelSelect in edit mode }}
```

### Rich Options (Labels/Icons)

```gts
enumField(StringField, { 
  options: [
    { value: 'high', label: 'High', icon: ArrowUpIcon },
    { value: 'medium', label: 'Medium', icon: MinusIcon },
    { value: 'low', label: 'Low', icon: ArrowDownIcon }
  ]
})
```

Editor shows labels/icons; stored value is the primitive `value`.

### Dynamic Options

**Provide a function:**
```gts
enumField(StringField, { 
  options: function() { 
    return this.someList; 
  }
})
```

**Per-usage override:**
```gts
contains(Field, { 
  configuration: enumConfig(function() { 
    return { options: this.someList }; 
  })
})
```

**Note:** `this` is the containing card or field

### Helpers

**enumValues** - Get array of primitive values:
```gts
enumValues(card, 'enumFieldName') // → ['High', 'Medium', 'Low']
```

**enumOptions** - Get normalized option objects:
```gts
enumOptions(card, 'enumFieldName') // → [{ value, label, icon? }, ...]
```

### Null Handling

If current value is `null` and `null` isn't in options, placeholder uses `unsetLabel` or "Choose…".

To make `null` selectable:
```gts
{ value: null, label: 'None' }
```

### Limitations

- **Compound field values:** Not yet supported
- **Card values:** Not yet supported

### Validation and Behavior

- Duplicate values throw during option normalization
- Query and serialization follow the base field
- Enum wrapping does not change data shape

### Minimal Example

**Define:**
```gts
import enumField from 'https://cardstack.com/base/enum';
const Priority = enumField(StringField, { options: ['High', 'Medium', 'Low'] });
```

**Use:**
```gts
class Task extends CardDef { 
  @field priority = contains(Priority); 
}
```

**Template:**
```hbs
<@fields.priority />
{{enumValues @model 'priority'}} {{! ['High','Medium','Low'] }}
```

### Factory vs Usage (Clarity)

**Factory defaults:**
```gts
enumField(Base, { options }) // For simple/static defaults
```

**Usage overrides:**
```gts
contains(Field, { 
  configuration: enumConfig(function() { 
    return { options }; 
  })
}) // For per-instance behavior
```

Both resolve to `@configuration.enum.options` for templates/formats.

### Callback Context

`computeVia`, `enumField` options functions, and `enumConfig` usage callbacks all receive the containing instance as `this`.

**Prefer `function() { ... }` (not arrow)** to ensure `this` is bound to the parent instance.

**Guidance:** Keep callbacks side-effect free; derive options synchronously from `this`.

### Complete Example

```gts
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';

const PriorityField = enumField(StringField, {
  options: [
    { value: 'high', label: 'High Priority', icon: ArrowUpIcon },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority', icon: ArrowDownIcon }
  ]
});

export class Task extends CardDef {
  @field taskName = contains(StringField);
  @field priority = contains(PriorityField);

  @field cardTitle = contains(StringField, {
    computeVia: function(this: Task) {
      return this.taskName ?? 'Untitled Task';
    }
  });
}
```


<div class="skill-divider skill-divider-clickable" id="skill-divider-16" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-spec-usage" role="button" tabindex="0" aria-label="Open Spec Usage">
  <div class="divider-number">17</div>
  <div class="divider-content">
    <div class="divider-topic">Spec Usage</div>
    <div class="divider-context">📖 Contains: Card specs, field specs, component specs, app specs, command specs - usage examples</div>
    <div class="divider-mode divider-mode-link-only">Link Only</div>
  </div>
</div>


<div class="skill-divider skill-divider-clickable" id="skill-divider-17" data-card-url="https://realms-staging.stack.cards/skills/Skill/dev-replicate-ai" role="button" tabindex="0" aria-label="Open Replicate AI Integration">
  <div class="divider-number">18</div>
  <div class="divider-content">
    <div class="divider-topic">Replicate AI Integration</div>
    <div class="divider-context">📖 Contains: Replicate API essentials, enum fields, API call patterns, response parsing, finding model schemas</div>
    <div class="divider-mode divider-mode-link-only">Link Only</div>
  </div>
</div>

## One-Shot Enhancement (vague requests)

**Triggers:** "Create a …", "Build …", ≤3 sentences, aspirational ideas.

### Pre-Flight
- [ ] Cardinal rule understood
- [ ] 1 primary CardDef (max 3 for navigation)
- [ ] Other entities as FieldDefs
- [ ] Tracking markers ready

### 500-Word Sprint
1. **Architecture** — Primary CardDef, 3–5 supporting FieldDefs, relationship map.
2. **Distinction** — Unique angle, 2–3 clever fields, smart computations, interaction hooks.
3. **Design** — Mood, color tokens, typography (Google Fonts), one visual signature.
4. **Scenario** — 3–4 personas, believable org, specific data, pain point, success metric.

Then generate code per all rules. **Success order:** Runnable → Correct → Attractive → Evolvable.

---

## Critical Rules (canonical)

### 🔴 Fatal Errors
| # | Rule |
|---|------|
| 1 | `contains(CardDef)` or `containsMany(CardDef)` → use `linksTo`/`linksToMany` |
| 2 | JS in templates (`{{@model.price * 1.2}}`) → use helpers (`{{multiply …}}`) or getters |
| 3 | Missing `export` on CardDef/FieldDef |
| 4 | Missing line-1 tracking banner or markers in SEARCH/REPLACE |

### ⛔ Common Mistakes
- `<@fields.items />` without `.container > .containsMany-field { gap }`.
- Empty `linksToMany` as `[]` → use `"self": null`.
- Unstyled Boxel buttons.

### ✅ Always
- Icons assigned to all CardDef and FieldDef
- Embedded templates for all FieldDefs
- Compute `title` from primary identifier.
- Provide empty states for arrays.
- Use theme variables only; link default theme for instances.
- Use inline SVG in templates (not emoji/Boxel icons).

---

## Micro-Checklist (pre-emit)
- [ ] Code mode + Sonnet 4.5
- [ ] File read (if missing)
- [ ] Tracked SEARCH/REPLACE block
- [ ] Theme linked; variables only
- [ ] Arrays length-checked; containsMany spacing applied

---

## Failure Recovery
| Problem | Fix |
|---------|-----|
| SEARCH didn't match | `read-file` → include unique nearby marker → retry smaller window |
| Schema break | Propose instance updates or migration; batch ≤10; confirm before more |

---
*Source: https://realms-staging.stack.cards/skills/*
*Skill ID: https://realms-staging.stack.cards/skills/Skill/boxel-development*
