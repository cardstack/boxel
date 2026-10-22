import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../helpers/cn.ts';
import { eq } from '../helpers/truth-helpers.ts';

// boxel-ui's Label, drawn as a `div`. boxel-ui's can't ship on the secure
// origin (ADR 008 §1.3), so its template and styles are brought here, kept as
// they are there.
export type LabelFontSize = 'small' | 'default';

interface Signature {
  Args: {
    size?: LabelFontSize;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const Label: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'boxel-label'
      boxel-label--small=(eq @size 'small')
      boxel-label--default=(eq @size 'default')
    }}
    ...attributes
  >
    {{yield}}
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-label {
        color: var(--boxel-label-color);
        font-size: var(--boxel-label-font-size, var(--boxel-body-font-size));
        font-weight: var(--boxel-label-font-weight, 500);
        line-height: var(--boxel-label-line-height, 1.1);
        font-family: inherit;
        letter-spacing: var(--boxel-label-letter-spacing, var(--boxel-lsp-sm));
      }
      .boxel-label--small {
        font-size: var(
          --boxel-label-font-size-small,
          var(--boxel-caption-font-size)
        );
        line-height: var(
          --boxel-label-line-height-small,
          var(--boxel-caption-line-height)
        );
      }
      .boxel-label--default {
        font-size: var(--boxel-label-font-size, var(--boxel-body-font-size));
        line-height: var(
          --boxel-label-line-height,
          var(--boxel-body-line-height)
        );
      }
    }
  </style>
</template>;

export default Label;
