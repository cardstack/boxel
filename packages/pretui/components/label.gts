// Pretui — Label: the field eyebrow, as label, span or legend.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// Fresh, tiny. Ported semantics from boxel-ui label/index.gts (tag
// polymorphism + default block), re-voiced as the Pretui field eyebrow:
// small-caps mono, the same voice as PropRow labels and table headers.
// boxel-ui's `(element @tag)` helper becomes simple if branches over the
// three tags a form label actually takes.

export type PretuiLabelTag = 'label' | 'span' | 'legend';

function isTag(tag: string | undefined, t: string): boolean {
  return tag === t;
}

export interface LabelSignature {
  Args: {
    tag?: PretuiLabelTag;
    /** id of the control this label points at (label tag only) */
    for?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export const Label: TemplateOnlyComponent<LabelSignature> = <template>
  {{#if (isTag @tag 'legend')}}
    <legend class='pretui-label' data-test-pretui-label ...attributes>
      {{yield}}
    </legend>
  {{else if (isTag @tag 'span')}}
    <span class='pretui-label' data-test-pretui-label ...attributes>
      {{yield}}
    </span>
  {{else}}
    <label
      class='pretui-label'
      for={{@for}}
      data-test-pretui-label
      ...attributes
    >
      {{yield}}
    </label>
  {{/if}}
  <style scoped>
    .pretui-label {
      display: inline-block;
      padding: 0;
      font-family: var(--font-mono);
      font-size: var(--text-ui-xs, 11px);
      font-weight: 500;
      line-height: 16px;
      letter-spacing: var(--track-eyebrow, 0.08em);
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
  </style>
</template>;
