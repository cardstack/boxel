// Pretui — Divider: a semantic separator rule, optionally labelled.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// Transcribed from wa-divider: a semantic role='separator' rule for
// grouping adjacent content, horizontal or vertical, one hairline token
// (--border). Adds the centered-label variant WA doesn't ship (the
// 'OR' rule between form alternatives) — horizontal only; a vertical
// divider ignores @label. WA's --color/--width/--spacing knobs collapse
// to --pretui-divider-spacing; the hairline color IS the token.

export interface DividerSignature {
  Args: {
    orientation?: 'horizontal' | 'vertical';
    /** centered label — horizontal orientation only */
    label?: string;
  };
  Element: HTMLDivElement;
}

function orientationOf(o: string | undefined): 'horizontal' | 'vertical' {
  return o === 'vertical' ? 'vertical' : 'horizontal';
}

export const Divider: TemplateOnlyComponent<DividerSignature> = <template>
  <div
    class='pretui-divider'
    role='separator'
    aria-orientation={{orientationOf @orientation}}
    aria-label={{@label}}
    data-orientation={{orientationOf @orientation}}
    data-test-pretui-divider
    ...attributes
  >
    {{#if @label}}
      <span class='pretui-divider-label'>{{@label}}</span>
    {{/if}}
  </div>
  <style scoped>
    .pretui-divider {
      --pretui-divider-spacing: var(--space-4, 11px);
    }
    .pretui-divider[data-orientation='horizontal'] {
      display: flex;
      align-items: center;
      margin: var(--pretui-divider-spacing) 0;
    }
    .pretui-divider[data-orientation='horizontal']::before,
    .pretui-divider[data-orientation='horizontal']::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .pretui-divider-label {
      padding: 0 8px;
      font-size: var(--text-ui-sm, 11.5px);
      letter-spacing: var(--track-ui, 0.01em);
      color: var(--muted-foreground);
      white-space: nowrap;
    }
    .pretui-divider[data-orientation='vertical'] {
      display: inline-block;
      width: 1px;
      align-self: stretch;
      min-height: 1lh;
      background: var(--border);
      margin: 0 var(--pretui-divider-spacing);
    }
    .pretui-divider[data-orientation='vertical'] .pretui-divider-label {
      display: none;
    }
  </style>
</template>;
