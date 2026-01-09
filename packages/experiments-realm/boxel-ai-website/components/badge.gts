import GlimmerComponent from '@glimmer/component';

import { Pill } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Element: HTMLSpanElement;
  Args: {
    label: string;
    icon?: string;
    accentColor?: string;
    variant?:
      | 'default-inverse'
      | 'primary-inverse'
      | 'secondary-inverse'
      | 'accent-inverse'
      | string;
  };
}

export class Badge extends GlimmerComponent<Signature> {
  <template>
    <Pill
      class='card-badge {{if @variant @variant "default-inverse"}}'
      style={{cssVar accent-color=@accentColor}}
      ...attributes
    >{{@label}}</Pill>

    <style scoped>
      .card-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.75rem;
        border-radius: var(--boxel-border-radius-xs);
        border: none;
        background-color: var(
          --brand-dark,
          var(--primary-foreground, var(--boxel-dark))
        );
        color: var(--accent-color, var(--primary, var(--boxel-highlight)));
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .default-inverse {
        color: var(--background, var(--boxel-dark));
        background-color: var(--foreground, var(--boxel-light));
      }
      .primary-inverse {
        color: var(--primary, var(--boxel-highlight));
        background-color: var(--primary-foreground, var(--boxel-dark));
      }
      .secondary-inverse {
        color: var(--secondary, var(--boxel-light));
        background-color: var(--secondary-foreground, var(--boxel-dark));
      }
      .accent-inverse {
        color: var(--accent, var(--boxel-100));
        background-color: var(--accent-foreground, var(--boxel-dark));
      }
    </style>
  </template>
}
