---
validated: source-proven
---

# link-element-tag-helper — Dynamic HTML tag via the `element` helper

**What this gives you:** A typography or wrapper component that picks its semantic HTML tag at render time (`h1` vs `h2` vs `div`) instead of forking the template per tag.

**When to use:** Heading components, container components, anywhere you'd want to write `<Tag class='title'>` where `Tag` varies by usage context.

**The insight:** `@cardstack/boxel-ui/helpers` exports an `element` helper that turns a tag-name string into a usable Glimmer component reference. Combined with `{{#let (element @tag) as |Tag|}}` you bind it to a local name and use it like any component.

**Recipe shape:**

```ts
import { element } from '@cardstack/boxel-ui/helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface TitleSignature {
  Args: { element?: keyof HTMLElementTagNameMap };
  Element: HTMLElement;
  Blocks: { default: [] };
}

export const Title: TemplateOnlyComponent<TitleSignature> = <template>
  {{#let (element @element) as |Tag|}}
    <Tag class='title' ...attributes>{{yield}}</Tag>
  {{/let}}
</template>;
```

Usage:
```hbs
<Title @element='h1'>Hero</Title>
<Title @element='h3'>Subhead</Title>
<Title>Default (inferred as div if @element omitted)</Title>
```

**Gotchas:**
- The tag-name string is *not* sanitized — only pass values you control (typically a constrained type like `keyof HTMLElementTagNameMap`).
- Behaves differently than a string-interpolated tag in HTML — Glimmer compiles it as a component invocation.
- For pure-render reusable bits, prefer `TemplateOnlyComponent<Sig>` (smaller bundle than a Component class).

**Source:** `boxel-catalog/components/layout.gts:42-60` (the `TitleGroup` pattern).

**See also:** `boxel/references/template-syntax.md`, `boxel-ui-guidelines`.
