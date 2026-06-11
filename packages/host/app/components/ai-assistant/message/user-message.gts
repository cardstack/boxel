import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn } from '@cardstack/boxel-ui/helpers';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

import Message from './text-content';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    html?: string;
    isPending?: boolean;
  };
  Blocks: { default: [] };
}

const UserMessage: TemplateOnlyComponent<Signature> = <template>
  <Message
    class={{cn 'user-message-bubble' is-pending=@isPending}}
    data-test-user-message
    ...attributes
  >
    {{yield}}

    {{#if @html}}
      {{sanitizedHtml @html}}
    {{/if}}
  </Message>

  <style scoped>
    .user-message-bubble {
      padding: var(--boxel-sp-sm);
      background-color: var(--boxel-light);
      color: var(--boxel-dark);
      border-radius: var(--boxel-border-radius-xxl);
      border-top-left-radius: var(--boxel-border-radius-xs);
    }
    .is-pending {
      /* `--boxel-pill-*` overrides win over the variant-class `--pill-*`
         declarations on the Pill element itself; setting the inner
         `--pill-*` vars here would be shadowed by `.variant-default` /
         `.variant-muted` further down the tree. */
      --boxel-pill-background-color: var(--boxel-200);
      --boxel-pill-font-color: var(--boxel-500);
      background-color: var(--boxel-200);
      color: var(--boxel-500);
    }
    :deep(a:hover) {
      /* use this highlight text color on light-background */
      color: var(--boxel-highlight-hover);
    }
  </style>
</template>;

export default UserMessage;
