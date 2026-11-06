// What a page shows while it works for the user ("Signing you in…",
// "Loading…"): the title, with Pret UI's Spinner below it. The app and the secure
// origin both draw it with this component, so a redirect between their pages
// keeps the same indicator in the same place.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Spinner } from '@cardstack/pretui/components/spinner';

interface Signature {
  Args: { title: string };
  Element: HTMLDivElement;
}

const BusyMessage: TemplateOnlyComponent<Signature> = <template>
  <div class='busy-message' role='status' ...attributes>
    <span class='busy-title'>{{@title}}</span>
    <Spinner @size={{20}} class='busy-spinner' />
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
      color: var(--boxel-highlight);
    }
  </style>
</template>;

export default BusyMessage;
