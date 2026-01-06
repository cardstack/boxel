import GlimmerComponent from '@glimmer/component';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    accentColor?: string;
    highlightOnHover?: boolean;
  };
  Element: HTMLDivElement;
  Blocks: { default: [] };
}

export class DiagramBox extends GlimmerComponent<Signature> {
  <template>
    <div
      class={{cn
        'diagram-box'
        diagram-box--highlight=@highlightOnHover
        diagram-box--accent=@accentColor
      }}
      style={{cssVar accent-color=@accentColor}}
      ...attributes
    >
      {{yield}}
    </div>

    <style scoped>
      .diagram-box {
        --diagram-accent: var(--primary, var(--boxel-highlight));

        background: var(--diagram-background, var(--muted, var(--boxel-100)));
        color: var(--diagram-foreground, var(--foreground, var(--boxel-dark)));
        padding: 1.25rem;
        border: 1px dashed var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius-sm);
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.85rem;
        text-align: center;
        margin-bottom: 0.75rem;
        transition: var(--boxel-transition-properties);
      }
      .diagram-box--accent {
        border-color: var(--accent-color, var(--diagram-accent));
      }
      .diagram-box--highlight:hover {
        border-color: var(--diagram-accent);
        background: color-mix(in oklab, var(--diagram-accent) 5%, transparent);
      }
    </style>
  </template>
}
