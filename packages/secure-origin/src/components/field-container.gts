import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { uniqueId } from '@ember/helper';

import cn from '../helpers/cn.ts';
import { eq, not } from '../helpers/truth-helpers.ts';
import Label from './label.gts';

// boxel-ui's FieldContainer, drawn as a `label` or a `div`. boxel-ui's can't
// ship on the secure origin (ADR 008 §1.3), so its template and styles are
// brought here, kept as they are there, but for the variants the secure
// origin's pages don't draw (inline, centered, with an icon, a small or
// differently sized label, a field nested in another).
//
// Its block is given the id of its label, when it has one, for the field's
// control to name itself by (`aria-labelledby`). A field drawn as a `label`
// otherwise takes all the text inside it as its name, an error message
// shown under the control included.
export interface Signature {
  Args: {
    fieldId?: string;
    label?: string;
    tag?: 'label' | 'div';
    vertical?: boolean;
  };
  Blocks: {
    default: [labelId: string | undefined];
    label: [];
  };
  Element: HTMLElement;
}

const FieldContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (uniqueId) as |labelId|}}
    {{#if (eq @tag 'label')}}
      <label
        class={{cn 'boxel-field' vertical=@vertical horizontal=(not @vertical)}}
        data-test-boxel-field
        data-test-boxel-field-id={{@fieldId}}
        ...attributes
      >
        <div class='label-container'>
          {{#if @label}}
            <Label id={{labelId}} class='label' data-test-boxel-field-label>
              {{@label}}
            </Label>
          {{/if}}
          {{yield to='label'}}
        </div>
        <div class='content'>
          {{yield (if @label labelId)}}
        </div>
      </label>
    {{else}}
      <div
        class={{cn 'boxel-field' vertical=@vertical horizontal=(not @vertical)}}
        data-test-boxel-field
        data-test-boxel-field-id={{@fieldId}}
        ...attributes
      >
        <div class='label-container'>
          {{#if @label}}
            <Label id={{labelId}} class='label' data-test-boxel-field-label>
              {{@label}}
            </Label>
          {{/if}}
          {{yield to='label'}}
        </div>
        <div class='content'>
          {{yield (if @label labelId)}}
        </div>
      </div>
    {{/if}}
  {{/let}}
  <style scoped>
    @layer boxelComponentL2 {
      .boxel-field {
        --boxel-field-label-align: normal;
        --boxel-field-label-padding-top: 0;

        display: grid;
        width: 100%;
        max-width: 100%;
        overflow-wrap: break-word;
      }
      .label-container {
        align-items: start;
      }

      .label {
        --boxel-label-letter-spacing: var(--boxel-lsp-xs);

        display: flex;
        align-items: var(--boxel-field-label-align);
        padding-top: var(--boxel-field-label-padding-top);
      }

      .content {
        max-width: 100%;
        padding: var(
          --boxel-field-content-padding,
          var(--boxel-outline-width)
        ); /* necessary for our various overlays utilizing box-shadow */
        word-break: break-word;
      }

      .horizontal {
        grid-template-columns:
          var(--boxel-field-label-size, minmax(8rem, 25%))
          1fr;
        min-height: var(--boxel-form-control-height);
      }

      .horizontal > .label-container {
        padding-top: var(--boxel-sp-sm);
      }

      .horizontal > .content {
        align-self: center;
      }

      .vertical {
        grid-template-rows: auto 1fr;
        gap: var(--boxel-sp-4xs);
      }

      .vertical .label {
        grid-column: 2;
      }
    }
  </style>
</template>;

export default FieldContainer;
