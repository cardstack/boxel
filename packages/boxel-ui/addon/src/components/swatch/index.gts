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
  <div class={{cn 'swatch' small=(eq @style 'round')}} ...attributes>
    {{#unless @hideLabel}}
      <div class='label'>
        {{#if @label}}
          <div>{{@label}}</div>
        {{/if}}
        {{@color}}
      </div>
    {{/unless}}
    <div
      class={{cn 'preview' round=(eq @style 'round')}}
      style={{cssVar swatch-background=@color}}
    />
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .swatch {
        --swatch-width: 7rem;
        --swatch-height: 3.375rem;
        display: inline-flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        line-height: calc(15 / 11);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .small {
        --swatch-width: 1.4rem;
        --swatch-height: 1.4rem;
        flex-direction: row;
        align-items: center;
      }
      .label {
        font-weight: 600;
      }
      .preview {
        width: var(--swatch-width);
        height: var(--swatch-height);
        max-width: 100%;
        padding: 0;
        background-color: var(--swatch-background, transparent);
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
      }
      .preview.round {
        flex-shrink: 0;
        border-radius: 50%;
        order: -1;
      }
    }
  </style>
</template>;

export default Swatch;
