import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { element } from '@cardstack/boxel-ui/helpers';

// 🧩 PATTERN: Dynamic HTML tag via `element` helper.

interface TitleGroupSignature {
  Args: {
    title?: string;
    tagline?: string;
    element?: keyof HTMLElementTagNameMap;
  };
  Element: HTMLElement;
}

export const TitleGroup: TemplateOnlyComponent<TitleGroupSignature> = <template>
  {{#let (element @element) as |Tag|}}
    <Tag class='title-group' ...attributes>
      {{#if @title}}
        <h1 class='title-group__title'>{{@title}}</h1>
      {{/if}}
      {{#if @tagline}}
        <p class='title-group__tagline'>{{@tagline}}</p>
      {{/if}}
    </Tag>
  {{/let}}

  <style scoped>
    .title-group { display: flex; flex-direction: column; gap: 0.5rem; }
    .title-group__title   { margin: 0; font-weight: 800; }
    .title-group__tagline { margin: 0; color: var(--muted-foreground, #666); }
  </style>
</template>;

// === Usage ============================================================
//
//   <TitleGroup @title='Boxel Catalog' @tagline='Things to install' @element='header' />
//   ↳ <header class='title-group'>…</header>
//
//   <TitleGroup @title='Section heading' @element='section' />
//   ↳ <section class='title-group'>…</section>
//
//   <TitleGroup @title='Just a div' />
//   ↳ <div class='title-group'>…</div>
