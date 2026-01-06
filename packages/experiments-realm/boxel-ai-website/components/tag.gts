import GlimmerComponent from '@glimmer/component';
import { cssVar } from '@cardstack/boxel-ui/helpers';

interface TagSignature {
  Element: HTMLSpanElement;
  Args: {
    label: string;
    icon?: string;
    accentColor?: string;
    variant?: 'default' | 'primary' | 'secondary' | 'accent' | string;
  };
}

export class Tag extends GlimmerComponent<TagSignature> {
  <template>
    <span
      class='tag tag--{{if @variant @variant "default"}}'
      style={{cssVar accent-color=@accentColor}}
      ...attributes
    >
      {{#if @icon}}
        <span aria-hidden='true'>{{@icon}}</span>
      {{/if}}
      {{@label}}
    </span>

    <style scoped>
      .tag {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.75rem;
        border-radius: var(--boxel-border-radius-xs);
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
      }
      .tag--default {
        color: var(--foreground, var(--boxel-dark));
        background-color: color-mix(
          in oklab,
          var(--accent-color, currentColor) 15%,
          transparent
        );
      }
      .tag--primary {
        color: var(--primary-foreground, var(--boxel-dark));
        background-color: color-mix(
          in oklab,
          var(--primary, var(--boxel-highlight)) 15%,
          transparent
        );
      }
      .tag--secondary {
        color: var(--secondary-foreground, var(--boxel-dark));
        background-color: color-mix(
          in oklab,
          var(--secondary, var(--boxel-light)) 15%,
          transparent
        );
      }
      .tag--accent {
        color: var(--accent-foreground, var(--boxel-dark));
        background-color: color-mix(
          in oklab,
          var(--accent-foreground, var(--boxel-dark)) 15%,
          transparent
        );
      }
    </style>
  </template>
}
