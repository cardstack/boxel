// Pretui — SkipLink usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { SkipLink } from './skip-link';

const SOURCE = "<SkipLink @href='#main' />\n<header>…</header>\n<main id='main' tabindex='-1'>…</main>";

const SkipLinkUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='SkipLink'
    @description='The first focusable control in a pane: a way past the header and navigation to the main content (WCAG 2.4.1). It is off screen until it has focus. Tab into the demo frame to see it.'
    @source={{SOURCE}}
  >
    <:example>
      <div class='sk-demo'>
        <SkipLink @href='#sk-demo-main' />
        <nav class='sk-demo-nav'><a href='#sk-demo-main'>Lots</a> <a href='#sk-demo-main'>Roasts</a> <a href='#sk-demo-main'>Orders</a></nav>
        <main id='sk-demo-main' class='sk-demo-main' tabindex='-1'>Main content</main>
      </div>
    </:example>
    <:api as |Args|>
      <Args.String @name='href' @defaultValue='#main' @description='The in-page target. Give it the matching id and tabindex=-1.' />
      <Args.String @name='label' @defaultValue='Skip to content' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .sk-demo {
      position: relative;
      padding: var(--space-6, 1.25rem) var(--space-4, 0.6875rem) var(--space-4, 0.6875rem);
      border-radius: var(--radius-surface, 10px);
      box-shadow: 0 0 0 1px var(--border);
    }
    .sk-demo-nav {
      display: flex;
      gap: var(--space-4, 0.6875rem);
      font-size: var(--text-ui-md, 0.78rem);
    }
    .sk-demo-main {
      margin-block-start: var(--space-4, 0.6875rem);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export const DEMOS_SKIP_LINK: Record<string, unknown> = {
  SkipLink: SkipLinkUsage,
};
