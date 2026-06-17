import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Pill } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    color?: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLSpanElement;
}

const StatusPill: TemplateOnlyComponent<Signature> = <template>
  <Pill
    class='status-pill'
    @size='extra-small'
    @pillFontColor={{@color}}
    ...attributes
  >
    {{yield}}
  </Pill>

  <style scoped>
    .status-pill {
      --boxel-pill-background-color: color-mix(
        in oklch,
        currentColor 12%,
        transparent
      );
      min-height: var(--boxel-button-mini);
      height: unset;
      border: none;
      font-weight: 600;
      text-transform: uppercase;
    }
  </style>
</template>;

export { StatusPill };
