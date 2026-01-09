import GlimmerComponent from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';

interface Signature {
  Element: HTMLSpanElement;
  Args: {
    variant?: 'primary';
    size?: 'small';
    href?: string;
    text?: string;
  };
  Blocks: { default: [] };
}

export class Cta extends GlimmerComponent<Signature> {
  <template>
    <Button
      class='cta cta--{{if @variant @variant "secondary"}}'
      @as='anchor'
      @href={{@href}}
      @kind={{if @variant @variant 'muted'}}
      @size={{if @size @size 'touch'}}
      ...attributes
    >{{yield}}</Button>

    <style scoped>
      .cta.size-touch {
        padding-inline: 2.5rem;
      }
      .cta--primary {
        transition:
          color var(--boxel-transition),
          background-color var(--boxel-transition),
          transform var(--boxel-transition),
          opacity var(--boxel-transition);
      }
      .cta--primary:hover {
        background-color: var(--accent);
        color: var(--accent-foreground);
        opacity: 0.9;
        transform: translateY(-2px);
      }
      .cta--primary.size-small:hover {
        transform: translateY(-1px);
      }
      .cta--secondary {
        background: none;
        transition: color var(--boxel-transition);
      }
      .cta--secondary:hover {
        color: var(--secondary);
      }
    </style>
  </template>
}
