// What a page shows while it works for the user ("Signing you in…",
// "Loading…"): the title, with the spinner below it. The app and the secure
// origin both draw it with this component, so a redirect between their pages
// keeps the same indicator in the same place.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import LoadingIndicator from './loading-indicator.gts';

interface Signature {
  Args: { title: string };
  Element: HTMLDivElement;
}

const BusyMessage: TemplateOnlyComponent<Signature> = <template>
  <div class='busy-message' role='status' ...attributes>
    <span class='busy-title'>{{@title}}</span>
    <LoadingIndicator class='busy-spinner' />
  </div>

  <style scoped>
    .busy-message {
      align-self: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--boxel-sp);
      text-align: center;
    }
    .busy-title {
      font: 500 var(--boxel-font-sm);
      color: var(--foreground, var(--boxel-light));
    }
    .busy-spinner {
      --boxel-loading-indicator-size: var(--boxel-icon-md);
      --loading-indicator-color: var(--boxel-highlight);
    }
  </style>
</template>;

export default BusyMessage;
