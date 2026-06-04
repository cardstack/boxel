import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { IconX, Warning } from '@cardstack/boxel-ui/icons';

export const FALLBACK_BANNER_MESSAGE =
  "Custom system card couldn't be loaded — using built-in defaults. Some models may have reduced capabilities.";

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onDismiss?: () => void;
  };
}

const FallbackBanner: TemplateOnlyComponent<Signature> = <template>
  <div
    class='fallback-banner'
    role='status'
    data-test-fallback-banner
    ...attributes
  >
    <Warning class='icon' />
    <p class='banner-message'>{{FALLBACK_BANNER_MESSAGE}}</p>
    {{#if @onDismiss}}
      <button
        type='button'
        class='dismiss'
        aria-label='Dismiss'
        data-test-fallback-banner-dismiss
        {{on 'click' @onDismiss}}
      >
        <IconX class='dismiss-icon' width='10' height='10' />
      </button>
    {{/if}}
  </div>
  <style scoped>
    .fallback-banner {
      display: grid;
      grid-template-columns: 20px 1fr auto;
      align-items: center;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      background-color: var(--boxel-warning-200);
      color: var(--boxel-dark);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-sm);
    }
    .icon {
      width: 20px;
      height: 20px;
    }
    .banner-message {
      margin: 0;
    }
    .dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      border-radius: 50%;
    }
    .dismiss:hover {
      background-color: rgba(0, 0, 0, 0.08);
    }
    .dismiss:focus-visible {
      outline: 2px solid var(--boxel-dark);
      outline-offset: 1px;
    }
    .dismiss-icon {
      display: block;
    }
  </style>
</template>;

export default FallbackBanner;
