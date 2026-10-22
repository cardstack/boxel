import type { TemplateOnlyComponent } from '@ember/component/template-only';

import CheckMark from './icons/check-mark.gts';

// The check-marked line the host's registration page shows under a field
// whose value is valid ("password is valid", "passwords match").
interface Signature {
  Element: HTMLParagraphElement;
  Blocks: { default: [] };
}

const ValidationHint: TemplateOnlyComponent<Signature> = <template>
  <p class='validation-hint' ...attributes><CheckMark
      class='validation-hint-icon'
    />{{yield}}</p>
  <style scoped>
    .validation-hint {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-3xs);
      margin: var(--boxel-sp-2xs) 0 0;
      color: var(--muted-foreground);
      font: 500 var(--boxel-font-xs);
    }
    .validation-hint-icon {
      --icon-color: var(--boxel-highlight);
      width: 0.875rem;
      height: 0.875rem;
      flex-shrink: 0;
    }
  </style>
</template>;

export default ValidationHint;
