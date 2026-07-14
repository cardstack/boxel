---
validated: source-proven
---

# format-morph-shared-component — One Glimmer component, multiple formats, CSS-driven morphing

**What this gives you:** A single Glimmer Component assigned to _both_ `static isolated` and `static edit` (and, when it makes sense, `embedded` too) — so the component stays _mounted_ when the user flips formats. CSS transitions on `.card--{{@format}}` class hooks then morph the layout smoothly instead of remounting it. Side benefit: massive file-size savings — one set of CSS, one template, one component.

**When to use:**

- A CardDef whose isolated + edit views show _the same content_ in different layouts — the editorial preview vs. the editing form. Common case: any document-style card.
- You want the format-flip to feel smooth (animated container, no flicker), not "the whole card rerender'd".
- You want one source of CSS, not three near-duplicate scoped blocks.

When NOT to use:

- Isolated and edit are genuinely different surfaces (a chess game vs. a settings form) — keep them separate.
- The card has heavy interactivity that's edit-only (drag-and-drop reordering) and would clutter the read-only view.

**The insight:** `lookupComponents` in the host short-circuits when two format slots resolve to the _same component reference_. Same reference → same mounted instance → DOM stays put → CSS transitions on a `class="card card--{{@format}}"` hook morph the visual without a tear-down.

**Recipe shape:**

```gts
import GlimmerComponent from '@glimmer/component';
import {
  CardDef,
  field,
  contains,
  StringField,
  type FieldsTypeFor,
  type EditCardFn,
  type Format,
} from 'https://cardstack.com/base/card-api';
import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';

class MorphTemplate extends GlimmerComponent<{
  Args: {
    model: Article;
    fields: FieldsTypeFor<Article>;
    format: Format;
    editCard?: EditCardFn;
  };
}> {
  enterEdit = () => {
    if (this.args.model.id) {
      this.args.editCard?.(this.args.model);
    }
  };

  <template>
    <article class='card card--{{@format}}'>
      <h1 class='card__title'><@fields.title /></h1>
      <p class='card__tagline'><@fields.tagline /></p>
      <section class='card__body'><@fields.body /></section>
      {{#if (eq @format 'isolated')}}
        <Button {{on 'click' this.enterEdit}}>Edit</Button>
      {{/if}}
    </article>
    <style scoped>
      .card {
        /* Tokens default to "isolated" sizing */
        --pad: 56px;
        --title-size: 56px;
        --body-size: 18px;
        display: grid;
        gap: 32px;
        padding: var(--pad);
        background: var(--card);
        border-radius: var(--radius);
        transition:
          padding 360ms cubic-bezier(0.2, 0.7, 0, 1),
          gap 360ms cubic-bezier(0.2, 0.7, 0, 1);
      }
      .card__title {
        font-size: var(--title-size);
        transition: font-size 360ms;
      }
      .card__body {
        font-size: var(--body-size);
        transition: font-size 360ms;
      }

      .card--edit {
        --pad: 24px;
        --title-size: 22px;
        --body-size: 14px;
      }
      .card--embedded {
        --pad: 20px;
        --title-size: 20px;
        --body-size: 13px;
      }
    </style>
  </template>
}

export class Article extends CardDef {
  static displayName = 'Article';
  @field title = contains(StringField);
  @field tagline = contains(StringField);
  @field body = contains(StringField);

  // The same reference for both slots — that identity is what keeps the
  // component mounted across format flips.
  static isolated = MorphTemplate;
  static edit = MorphTemplate;
}
```

**Why this saves tokens:** In the 10-card benchmark, every card had three separate `static isolated`/`static embedded`/`static fitted` definitions, each with its own `<style scoped>` block. Many shared 80% of the same CSS. For cards where isolated and edit are layout-variants of the same content, this pattern halves (or better) the CSS surface.

**The same trick works for FieldDef:**

```gts
const VibeTemplate = class extends GlimmerComponent<...> { /* ... */ };

export class Vibe extends FieldDef {
  static [primitive]: string;
  static embedded = VibeTemplate;
  static edit     = VibeTemplate;
}
```

When the parent card flips formats and re-renders, the Vibe field component stays mounted — letting the field morph alongside (see `format-morph.gts` `Vibe` field).

**Gotchas:**

- The shared component receives `@format` as an arg — use it to branch in the template (`{{#if (eq @format 'edit')}}`) and as a CSS class hook.
- If you also need a `fitted` format, that one usually IS different enough to deserve a separate class — fitted is for grid/gallery contexts, not edit-mode preview.
- Type the args correctly: `FieldsTypeFor<MyCard>` for the `@fields` slot, `Format` for `@format`, `EditCardFn` for the optional `@editCard` invocation.
- Apply CSS transitions to the morphable properties (`padding`, `gap`, `font-size`, `border-radius`), not to layout-changing ones (`display`, `grid-template-*` — those snap).

**Source:** `~/Projects/boxel/packages/experiments-realm/format-morph.gts`. The `Vibe` field there also illustrates how `static [primitive]: string` makes a primitive-backed FieldDef.

**See also:** `containsmany-sorted-render` (component-side rendering tricks).
