import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, cssVar, eq } from '../../helpers.ts';

interface Signature {
  Args: {
    color?: string | null;
    hideLabel?: boolean;
    label?: string | null;
    style?: 'round' | 'default';
  };
  Element: HTMLElement;
}

const Swatch: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn 'boxel-swatch' boxel-swatch--small=(eq @style 'round')}}
    data-test-swatch={{@color}}
    ...attributes
  >
    {{#unless @hideLabel}}
      <div class='boxel-swatch-label'>
        {{#if @label}}
          <div class='boxel-swatch-name'>{{@label}}</div>
        {{/if}}
        <code class='boxel-swatch-value'>{{@color}}</code>
      </div>
    {{/unless}}
    <div
      class={{cn
        'boxel-swatch-preview'
        boxel-swatch-preview--round=(eq @style 'round')
      }}
      style={{cssVar swatch-background=@color}}
    />
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-swatch {
        --swatch-width: 7rem;
        --swatch-height: 3.375rem;
        --_swatch-border: color-mix(
          in oklab,
          var(--border, var(--boxel-border-color)),
          var(--foreground, var(--boxel-dark)) 10%
        );
        display: inline-flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .boxel-swatch--small {
        --swatch-width: 1.4rem;
        --swatch-height: 1.4rem;
        flex-direction: row;
        align-items: center;
      }
      .boxel-swatch-preview {
        width: var(--swatch-width);
        height: var(--swatch-height);
        max-width: 100%;
        padding: 0;
        background-color: var(--swatch-background, transparent);
        border: 1px solid
          var(--boxel-swatch-border-color, var(--_swatch-border));
        border-radius: var(--boxel-border-radius);
      }
      .boxel-swatch-preview--round {
        flex-shrink: 0;
        aspect-ratio: 1;
        border-radius: 50%;
        order: -1;
      }
      .boxel-swatch-value {
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        text-transform: uppercase;
      }
    }
  </style>
</template>;

export default Swatch;
